/**
 * dsh-c4d 参数化图元 —— C4D 对象管理器同款图元（全部返回 Mesh）。
 *
 * 单位约定：内部无单位（渲染器按包围盒取景）；导出 STL/OBJ/DXF/SVG 时按 scale 参数换算。
 */

import { emptyMesh, mergeMeshes } from './mesh.js';

/** 2D/3D 便捷构造。 */
const v3 = (x, y, z) => [x, y, z];

/** 添加一个三角面。 */
function tri(out, a, b, c) {
  const base = out.verts.length;
  out.verts.push(v3(...a), v3(...b), v3(...c));
  out.faces.push([base, base + 1, base + 2]);
}

/** 添加一个四边形（拆两个三角：a-b-c + a-c-d）。 */
function quad(out, a, b, c, d) {
  tri(out, a, b, c);
  tri(out, a, c, d);
}

/**
 * 立方体 box（C4D 立方体）：w/h/d 为整边长。
 */
export function box({ w = 200, h = 200, d = 200 } = {}) {
  const out = emptyMesh();
  const x = w / 2, y = h / 2, z = d / 2;
  // -Z 面（front，法线朝 -Z）
  quad(out, [-x, -y, -z], [x, -y, -z], [x, y, -z], [-x, y, -z]);
  // +Z 面（back）
  quad(out, [x, -y, z], [-x, -y, z], [-x, y, z], [x, y, z]);
  // -X 面（left）
  quad(out, [-x, -y, z], [-x, -y, -z], [-x, y, -z], [-x, y, z]);
  // +X 面（right）
  quad(out, [x, -y, -z], [x, -y, z], [x, y, z], [x, y, -z]);
  // -Y 面（bottom）
  quad(out, [-x, -y, z], [x, -y, z], [x, -y, -z], [-x, -y, -z]);
  // +Y 面（top）
  quad(out, [-x, y, -z], [x, y, -z], [x, y, z], [-x, y, z]);
  return out;
}

/** UV 球体 sphere（C4D 球体）：分段经度 seg、纬度 rings。 */
export function sphere({ r = 100, seg = 32, rings = 16 } = {}) {
  const out = emptyMesh();
  const rows = Math.max(2, rings);
  const cols = Math.max(3, seg);
  // 顶点：rings-1 圈 + 两极
  const grid = [];
  for (let i = 1; i < rows; i++) {
    const phi = Math.PI * i / rows;
    const row = [];
    for (let j = 0; j < cols; j++) {
      const theta = 2 * Math.PI * j / cols;
      row.push(v3(r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(theta)));
    }
    grid.push(row);
  }
  const south = out.verts.length; out.verts.push(v3(0, -r, 0));
  for (const row of grid) for (const p of row) out.verts.push(p);
  const north = out.verts.length; out.verts.push(v3(0, r, 0));
  const rowAt = (i) => Array.from({ length: cols }, (_, j) => south + 1 + i * cols + j);
  // 底部扇形（南极限，绕向使法线朝外）
  for (let j = 0; j < cols; j++) {
    const a = rowAt(0)[j], b = rowAt(0)[(j + 1) % cols];
    out.faces.push([south, a, b]);
  }
  // 中间四边形
  for (let i = 0; i + 1 < grid.length; i++) {
    for (let j = 0; j < cols; j++) {
      const a = rowAt(i)[j], b = rowAt(i)[(j + 1) % cols];
      const c = rowAt(i + 1)[(j + 1) % cols], d = rowAt(i + 1)[j];
      out.faces.push([a, b, c], [a, c, d]);
    }
  }
  // 顶部扇形
  const top = grid.length - 1;
  for (let j = 0; j < cols; j++) {
    const a = rowAt(top)[j], b = rowAt(top)[(j + 1) % cols];
    out.faces.push([north, b, a]);
  }
  return out;
}

/** 圆柱 cylinder（C4D 圆柱）：带上下盖。 */
export function cylinder({ r = 100, h = 200, seg = 32, cap = true } = {}) {
  const out = emptyMesh();
  const cols = Math.max(3, seg);
  const y0 = -h / 2, y1 = h / 2;
  const ring = (y) => {
    const idx = [];
    for (let j = 0; j < cols; j++) {
      const theta = 2 * Math.PI * j / cols;
      out.verts.push(v3(r * Math.cos(theta), y, r * Math.sin(theta)));
      idx.push(out.verts.length - 1);
    }
    return idx;
  };
  const bottom = ring(y0), top = ring(y1);
  for (let j = 0; j < cols; j++) {
    const a = bottom[j], b = bottom[(j + 1) % cols];
    const c = top[(j + 1) % cols], d = top[j];
    out.faces.push([a, b, c], [a, c, d]);
  }
  if (cap) {
    const b0 = out.verts.length; out.verts.push(v3(0, y0, 0));
    const t0 = out.verts.length; out.verts.push(v3(0, y1, 0));
    for (let j = 0; j < cols; j++) {
      out.faces.push([b0, bottom[(j + 1) % cols], bottom[j]]);
      out.faces.push([t0, top[j], top[(j + 1) % cols]]);
    }
  }
  return out;
}

/** 圆锥 cone（C4D 圆锥）：底面半径 r、高 h，带底盖。 */
export function cone({ r = 100, h = 200, seg = 32 } = {}) {
  const out = emptyMesh();
  const cols = Math.max(3, seg);
  const y0 = -h / 2;
  const bottom = [];
  for (let j = 0; j < cols; j++) {
    const theta = 2 * Math.PI * j / cols;
    out.verts.push(v3(r * Math.cos(theta), y0, r * Math.sin(theta)));
    bottom.push(out.verts.length - 1);
  }
  const apex = out.verts.length; out.verts.push(v3(0, h / 2, 0));
  const center = out.verts.length; out.verts.push(v3(0, y0, 0));
  for (let j = 0; j < cols; j++) {
    out.faces.push([bottom[j], bottom[(j + 1) % cols], apex]);
    out.faces.push([center, bottom[(j + 1) % cols], bottom[j]]);
  }
  return out;
}

/** 圆环 torus（C4D 圆环）：主半径 R、管半径 r。 */
export function torus({ R = 150, r = 40, seg = 32, side = 16 } = {}) {
  const out = emptyMesh();
  const cols = Math.max(3, seg), sides = Math.max(3, side);
  for (let i = 0; i < cols; i++) {
    const u = 2 * Math.PI * i / cols;
    const cu = Math.cos(u), su = Math.sin(u);
    for (let j = 0; j < sides; j++) {
      const w = 2 * Math.PI * j / sides;
      out.verts.push(v3((R + r * Math.cos(w)) * cu, r * Math.sin(w), (R + r * Math.cos(w)) * su));
    }
  }
  const at = (i, j) => (i % cols) * sides + (j % sides);
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < sides; j++) {
      const a = at(i, j), b = at(i, j + 1), c = at(i + 1, j + 1), d = at(i + 1, j);
      out.faces.push([a, b, c], [a, c, d]);
    }
  }
  return out;
}

/** 圆环结 torusKnot（C4D 结状圆环）。 */
export function torusKnot({ p = 2, q = 3, R = 130, r = 30, seg = 96, side = 12 } = {}) {
  const out = emptyMesh();
  const cols = Math.max(8, seg), sides = Math.max(3, side);
  const curve = (t) => {
    const u = t * 2 * Math.PI;
    const cu = Math.cos(p * u), su = Math.sin(p * u);
    const qu = p / q * u;
    const rad = R + r * 2 * cu;
    return v3(rad * Math.cos(qu), r * 2 * su, rad * Math.sin(qu));
  };
  const frames = [];
  let prev = null;
  for (let i = 0; i < cols; i++) {
    const pos = curve(i / cols);
    const next = curve((i + 1) / cols);
    const tangent = [next[0] - pos[0], next[1] - pos[1], next[2] - pos[2]];
    const tl = Math.hypot(...tangent) || 1;
    const T = tangent.map((c) => c / tl);
    let N = prev === null ? [0, 1, 0] : prev.N;
    const dot = N[0] * T[0] + N[1] * T[1] + N[2] * T[2];
    N = [N[0] - dot * T[0], N[1] - dot * T[1], N[2] - dot * T[2]];
    const nl = Math.hypot(...N) || 1;
    N = N.map((c) => c / nl);
    const B = [
      T[1] * N[2] - T[2] * N[1],
      T[2] * N[0] - T[0] * N[2],
      T[0] * N[1] - T[1] * N[0],
    ];
    frames.push({ pos, N, B });
    prev = frames[frames.length - 1];
  }
  for (let i = 0; i < cols; i++) {
    const { pos, N, B } = frames[i];
    for (let j = 0; j < sides; j++) {
      const w = 2 * Math.PI * j / sides;
      const cw = Math.cos(w), sw = Math.sin(w);
      out.verts.push(v3(
        pos[0] + r * (cw * N[0] + sw * B[0]),
        pos[1] + r * (cw * N[1] + sw * B[1]),
        pos[2] + r * (cw * N[2] + sw * B[2]),
      ));
    }
  }
  const at = (i, j) => (i % cols) * sides + (j % sides);
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < sides; j++) {
      const a = at(i, j), b = at(i, j + 1), c = at(i + 1, j + 1), d = at(i + 1, j);
      out.faces.push([a, b, c], [a, c, d]);
    }
  }
  return out;
}

/** 胶囊 capsule（C4D 胶囊体）。 */
export function capsule({ r = 60, h = 200, seg = 24, rings = 8 } = {}) {
  const out = emptyMesh();
  const cols = Math.max(3, seg);
  const rows = Math.max(2, rings);
  const y0 = h / 2 - r, y1 = -h / 2 + r;
  const addRing = (y, radius) => {
    const idx = [];
    for (let j = 0; j < cols; j++) {
      const theta = 2 * Math.PI * j / cols;
      out.verts.push(v3(radius * Math.cos(theta), y, radius * Math.sin(theta)));
      idx.push(out.verts.length - 1);
    }
    return idx;
  };
  const bands = [];
  for (let i = 1; i < rows; i++) {
    const phi = Math.PI / 2 * i / rows;
    bands.push(addRing(y0 + r * Math.cos(phi), r * Math.sin(phi)));
  }
  bands.push(addRing(y1, r));
  for (let i = 1; i < rows; i++) {
    const phi = Math.PI / 2 * i / rows;
    bands.push(addRing(y1 - r * Math.cos(phi), r * Math.sin(phi)));
  }
  const south = out.verts.length; out.verts.push(v3(0, y1 - r, 0));
  const north = out.verts.length; out.verts.push(v3(0, y0 + r, 0));
  for (let b = 0; b + 1 < bands.length; b++) {
    for (let j = 0; j < cols; j++) {
      const a = bands[b][j], c = bands[b][(j + 1) % cols];
      const d = bands[b + 1][(j + 1) % cols], e = bands[b + 1][j];
      out.faces.push([a, c, d], [a, d, e]);
    }
  }
  for (let j = 0; j < cols; j++) {
    out.faces.push([south, bands[0][(j + 1) % cols], bands[0][j]]);
    const last = bands[bands.length - 1];
    out.faces.push([north, last[j], last[(j + 1) % cols]]);
  }
  return out;
}

/** 柏拉图多面体 platonic（C4D 柏拉图多面体）：tetra/octa/icosa/dodeca。 */
export function platonic({ kind = 'icosa', r = 100 } = {}) {
  const out = emptyMesh();
  const addFromFaces = (verts, faces) => {
    for (const p of verts) out.verts.push(v3(p[0] * r, p[1] * r, p[2] * r));
    for (const f of faces) out.faces.push([...f]);
  };
  const t = (1 + Math.sqrt(5)) / 2;
  if (kind === 'tetra') {
    addFromFaces([[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]], [[0, 1, 2], [0, 3, 1], [0, 2, 3], [1, 3, 2]]);
  } else if (kind === 'octa') {
    addFromFaces(
      [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]],
      [[0, 2, 4], [2, 1, 4], [1, 3, 4], [3, 0, 4], [2, 0, 5], [1, 2, 5], [3, 1, 5], [0, 3, 5]],
    );
  } else if (kind === 'dodeca') {
    const verts = [
      [-1, -1, -1], [-1, -1, 1], [-1, 1, -1], [-1, 1, 1], [1, -1, -1], [1, -1, 1], [1, 1, -1], [1, 1, 1],
      [0, -1 / t, -t], [0, -1 / t, t], [0, 1 / t, -t], [0, 1 / t, t],
      [-1 / t, -t, 0], [-1 / t, t, 0], [1 / t, -t, 0], [1 / t, t, 0],
      [-t, 0, -1 / t], [-t, 0, 1 / t], [t, 0, -1 / t], [t, 0, 1 / t],
    ];
    const faces = [
      [0, 8, 10, 2, 16], [0, 16, 18, 4, 12], [0, 12, 14, 6, 8], [2, 10, 11, 3, 13], [2, 13, 17, 16, 10],
      [3, 11, 19, 7, 15], [3, 15, 13, 17, 11], [4, 18, 19, 5, 14], [4, 14, 12, 0, 8], [5, 19, 18, 16, 17],
      [5, 17, 1, 9, 14], [6, 10, 8, 7, 11], [6, 11, 7, 19, 18], [7, 9, 1, 17, 15], [8, 6, 14, 9, 7],
      [9, 1, 5, 4, 12], [10, 2, 3, 15, 13], [11, 3, 19, 18, 6], [14, 9, 7, 8, 6], [1, 17, 16, 0, 12],
    ];
    // 五边形拆三角：f-0-1-2-3-4 → (0,1,2)(0,2,3)(0,3,4)
    const triFaces = [];
    for (const f of faces) for (let i = 1; i + 1 < f.length; i++) triFaces.push([f[0], f[i], f[i + 1]]);
    addFromFaces(verts, triFaces);
  } else {
    // icosahedron（默认）
    const verts = [
      [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
      [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
      [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
    ];
    const faces = [
      [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
      [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
      [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
      [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
    ];
    addFromFaces(verts, faces);
  }
  return out;
}

/** 平面 plane（C4D 平面）：分段网格面片。 */
export function plane({ w = 400, d = 400, seg = 8 } = {}) {
  const out = emptyMesh();
  const n = Math.max(1, seg);
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= n; j++) {
      out.verts.push(v3(-w / 2 + w * i / n, 0, -d / 2 + d * j / n));
    }
  }
  const at = (i, j) => i * (n + 1) + j;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const a = at(i, j), b = at(i + 1, j), c = at(i + 1, j + 1), d = at(i, j + 1);
      out.faces.push([a, b, c], [a, c, d]);
    }
  }
  return out;
}

/** 管状体 tube（C4D 管状）：内半径 r1、外半径 r2、高 h。 */
export function tube({ r1 = 60, r2 = 100, h = 200, seg = 32 } = {}) {
  const out = emptyMesh();
  const cols = Math.max(3, seg);
  const ring = (y, radius) => {
    const idx = [];
    for (let j = 0; j < cols; j++) {
      const theta = 2 * Math.PI * j / cols;
      out.verts.push(v3(radius * Math.cos(theta), y, radius * Math.sin(theta)));
      idx.push(out.verts.length - 1);
    }
    return idx;
  };
  const bIn = ring(-h / 2, r1), bOut = ring(-h / 2, r2);
  const tIn = ring(h / 2, r1), tOut = ring(h / 2, r2);
  for (let j = 0; j < cols; j++) {
    const k = (j + 1) % cols;
    out.faces.push([bOut[j], bOut[k], tOut[k]], [bOut[j], tOut[k], tOut[j]]);
    out.faces.push([bIn[k], bIn[j], tIn[j]], [bIn[j], tIn[k], tIn[j]]);
    out.faces.push([bIn[j], bOut[j], tOut[j]], [bIn[j], tOut[j], tIn[j]]);
    out.faces.push([bOut[k], bIn[k], tIn[k]], [bOut[k], tIn[k], tOut[k]]);
  }
  return out;
}

/** 角锥 pyramid（C4D 角锥）：四棱锥。 */
export function pyramid({ w = 200, h = 200 } = {}) {
  const out = emptyMesh();
  const x = w / 2, y0 = -h / 2, y1 = h / 2;
  const a = [-x, y0, -x], b = [x, y0, -x], c = [x, y0, x], d = [-x, y0, x];
  const apex = [0, y1, 0];
  tri(out, a, b, apex); tri(out, b, c, apex); tri(out, c, d, apex); tri(out, d, a, apex);
  const ia = 0, ib = 1, ic = 2, id = 3;
  const base = out.verts.length; out.verts.push([0, y0, 0]);
  out.faces.push([base, ib, ia], [base, ic, ib], [base, id, ic], [base, ia, id]);
  return out;
}

/** 圆环阵列的便捷组合（内部测试用）。 */
export function demoCluster() {
  return mergeMeshes(
    torus({ R: 150, r: 40 }),
    sphere({ r: 60 }),
  );
}
