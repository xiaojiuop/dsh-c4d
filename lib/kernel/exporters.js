/**
 * dsh-c4d 导出器 —— STL（二进制/ASCII）、OBJ、DXF、SVG。
 *
 * 网格内核直出；STEP/IGES 需要 OCCT 引擎（见 occt.js），缺失时给出明确指引。
 */

import { faceNormal, bounds } from './mesh.js';

/** 单位换算：内部无单位，导出按毫米换算。 */
const UNIT_SCALES = {
  mm: 1, cm: 0.1, m: 0.001, inch: 1 / 25.4,
};

function unitScale(unit) {
  return UNIT_SCALES[unit] ?? 1;
}

/** 三角面去重线段集合（供 DXF/SVG 线框与特征边）。 */
function featureEdges(mesh, angleDeg = 30) {
  const edgeMap = new Map();
  const key = (a, b) => (a < b ? `${a}_${b}` : `${b}_${a}`);
  const acc = new Map();
  for (let i = 0; i < mesh.faces.length; i++) {
    const f = mesh.faces[i];
    const n = faceNormal(mesh.verts, f);
    for (let k = 0; k < 3; k++) {
      const a = f[k], b = f[(k + 1) % 3];
      const k2 = key(a, b);
      if (!acc.has(k2)) acc.set(k2, []);
      acc.get(k2).push({ face: i, normal: n });
    }
  }
  const cosThreshold = Math.cos(angleDeg * Math.PI / 180);
  const lines = [];
  for (const [k2, list] of acc) {
    if (list.length === 1) {
      // 边界边（开口网格）：始终输出
      const [a, b] = k2.split('_').map(Number);
      lines.push([a, b]);
    } else if (list.length === 2) {
      const dot = list[0].normal[0] * list[1].normal[0] + list[0].normal[1] * list[1].normal[1] + list[0].normal[2] * list[1].normal[2];
      if (dot < cosThreshold) {
        const [a, b] = k2.split('_').map(Number);
        lines.push([a, b]);
      }
    }
  }
  return lines;
}

/** STL 二进制导出（默认，体积小）。 */
export function exportSTL(mesh, { unit = 'mm', ascii = false, name = 'c4d-model' } = {}) {
  const s = unitScale(unit);
  if (ascii) {
    const lines = [`solid ${name}`];
    for (const f of mesh.faces) {
      const n = faceNormal(mesh.verts, f);
      lines.push(`  facet normal ${n.map((x) => x.toExponential(6)).join(' ')}`);
      lines.push('    outer loop');
      for (const i of f) {
        const [x, y, z] = mesh.verts[i].map((c) => c * s);
        lines.push(`      vertex ${x.toExponential(6)} ${y.toExponential(6)} ${z.toExponential(6)}`);
      }
      lines.push('    endloop');
      lines.push('  endfacet');
    }
    lines.push(`endsolid ${name}`);
    return Buffer.from(lines.join('\n') + '\n', 'utf8');
  }
  const triCount = mesh.faces.length;
  const buf = Buffer.alloc(84 + triCount * 50);
  buf.write(name.slice(0, 79).padEnd(80, ' '), 0, 80, 'utf8');
  buf.writeUInt32LE(triCount, 80);
  let off = 84;
  for (const f of mesh.faces) {
    const n = faceNormal(mesh.verts, f);
    buf.writeFloatLE(n[0], off); buf.writeFloatLE(n[1], off + 4); buf.writeFloatLE(n[2], off + 8); off += 12;
    for (const i of f) {
      const [x, y, z] = mesh.verts[i].map((c) => c * s);
      buf.writeFloatLE(x, off); buf.writeFloatLE(y, off + 4); buf.writeFloatLE(z, off + 8); off += 12;
    }
    buf.writeUInt16LE(0, off); off += 2;
  }
  return buf;
}

/** OBJ 导出（带组名）。 */
export function exportOBJ(mesh, { unit = 'mm', name = 'c4d-model' } = {}) {
  const s = unitScale(unit);
  const lines = [`# dsh-c4d export — ${name}`, `o ${name}`];
  for (const [x, y, z] of mesh.verts) {
    lines.push(`v ${(x * s).toFixed(6)} ${(y * s).toFixed(6)} ${(z * s).toFixed(6)}`);
  }
  for (const f of mesh.faces) {
    lines.push(`f ${f.map((i) => i + 1).join(' ')}`);
  }
  return Buffer.from(lines.join('\n') + '\n', 'utf8');
}

/** DXF 导出（R12 ASCII，线框 = 特征边 + 开口边）。 */
export function exportDXF(mesh, { unit = 'mm', angle = 30 } = {}) {
  const s = unitScale(unit);
  const lines = [];
  lines.push('0', 'SECTION', '2', 'ENTITIES');
  for (const [a, b] of featureEdges(mesh, angle)) {
    const [x1, y1, z1] = mesh.verts[a].map((c) => c * s);
    const [x2, y2, z2] = mesh.verts[b].map((c) => c * s);
    lines.push('0', 'LINE', '8', 'C4D_EDGES');
    lines.push('10', x1.toFixed(4), '20', y1.toFixed(4), '30', z1.toFixed(4));
    lines.push('11', x2.toFixed(4), '21', y2.toFixed(4), '31', z2.toFixed(4));
  }
  lines.push('0', 'ENDSEC', '0', 'EOF');
  return Buffer.from(lines.join('\n') + '\n', 'utf8');
}

/** 平行投影（供 SVG 线框）。axis = front(z) / top(y) / right(x)。 */
function project(mesh, axis) {
  const pick = axis === 'x' ? [1, 2] : axis === 'y' ? [0, 2] : [0, 1];
  return mesh.verts.map((v) => [v[pick[0]], v[pick[1]]]);
}

/** SVG 导出（三视图线框，自包含可缩放）。 */
export function exportSVG(mesh, { unit = 'mm', angle = 30, padding = 20 } = {}) {
  const s = unitScale(unit);
  const views = [
    { name: 'front', axis: 'z' }, { name: 'top', axis: 'y' }, { name: 'right', axis: 'x' },
  ];
  const parts = [];
  const gap = 60;
  const width = 480;
  const height = 320;
  let offX = 0;
  for (const view of views) {
    const pts = project(mesh, view.axis);
    const lines = featureEdges(mesh, angle);
    // 取景
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [px, py] of pts) {
      if (px < minX) minX = px; if (px > maxX) maxX = px;
      if (py < minY) minY = py; if (py > maxY) maxY = py;
    }
    const w = Math.max(1, (maxX - minX) * s), h = Math.max(1, (maxY - minY) * s);
    const scale = Math.min((width - padding * 2) / w, (height - padding * 2) / h);
    const tx = offX + (width - w * scale) / 2, ty = (height - h * scale) / 2;
    const paths = lines.map(([a, b]) => {
      const [ax, ay] = pts[a], [bx, by] = pts[b];
      const x1 = tx + (ax - minX) * s * scale, y1 = ty + (maxY - ay) * s * scale;
      const x2 = tx + (bx - minX) * s * scale, y2 = ty + (maxY - by) * s * scale;
      return `<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}"/>`;
    }).join('');
    parts.push(`<g id="${view.name}">${paths}</g>`);
    offX += width + gap;
  }
  const totalW = width * 3 + gap * 2;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${height}" viewBox="0 0 ${totalW} ${height}">`
    + `<rect width="${totalW}" height="${height}" fill="#ffffff"/>`
    + parts.join('')
    + '</svg>\n';
  return Buffer.from(svg, 'utf8');
}

/** 导出格式分发表。 */
export const EXPORT_FORMATS = ['stl', 'obj', 'dxf', 'svg'];

export function exportMesh(mesh, format, options = {}) {
  switch (format) {
    case 'stl': return exportSTL(mesh, options);
    case 'obj': return exportOBJ(mesh, options);
    case 'dxf': return exportDXF(mesh, options);
    case 'svg': return exportSVG(mesh, options);
    default: throw new Error(`c4d: 网格内核不支持导出 "${format}"；STEP/IGES 需要 OCCT 引擎（opencascade.js），STL/OBJ/DXF/SVG 始终可用`);
  }
}

export { featureEdges, bounds };
