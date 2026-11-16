/**
 * dsh-c4d 导入器 —— STL / OBJ 读取（纯 JS）。
 *
 * STEP/IGES 导入需要 OCCT 引擎（见 occt.js），缺失时给出明确指引。
 */

import { emptyMesh } from './mesh.js';

/** STL 导入（自动识别二进制/ASCII）。 */
export function importSTL(buffer) {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  // 二进制判定：80 字节头 + 4 字节面数 + 50*面数 = 文件大小
  if (bytes.length >= 84) {
    const triCount = bytes.readUInt32LE(80);
    if (84 + triCount * 50 === bytes.length) return importSTLBinary(bytes);
  }
  return importSTLAscii(bytes.toString('utf8'));
}

function importSTLBinary(bytes) {
  const out = emptyMesh();
  const triCount = bytes.readUInt32LE(80);
  let off = 84;
  for (let i = 0; i < triCount; i++) {
    off += 12; // 法线
    const base = out.verts.length;
    for (let k = 0; k < 3; k++) {
      out.verts.push([bytes.readFloatLE(off), bytes.readFloatLE(off + 4), bytes.readFloatLE(off + 8)]);
      off += 12;
    }
    out.faces.push([base, base + 1, base + 2]);
    off += 2; // 属性
  }
  return out;
}

function importSTLAscii(text) {
  const out = emptyMesh();
  const verts = [];
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const m = /^\s*vertex\s+(\S+)\s+(\S+)\s+(\S+)/.exec(line);
    if (m) verts.push([Number(m[1]), Number(m[2]), Number(m[3])]);
  }
  for (let i = 0; i + 2 < verts.length; i += 3) {
    const base = out.verts.length;
    out.verts.push(verts[i], verts[i + 1], verts[i + 2]);
    out.faces.push([base, base + 1, base + 2]);
  }
  return out;
}

/** OBJ 导入（v / f 行，忽略法线与 UV）。 */
export function importOBJ(text) {
  const out = emptyMesh();
  const index = [];
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (line.startsWith('v ')) {
      const m = line.trim().split(/\s+/);
      index.push(out.verts.length);
      out.verts.push([Number(m[1]), Number(m[2]), Number(m[3])]);
    } else if (line.startsWith('f ')) {
      const m = line.trim().split(/\s+/).slice(1).map((tok) => {
        const slash = tok.indexOf('/');
        return (slash === -1 ? tok : tok.slice(0, slash)).trim();
      });
      if (m.length < 3) continue;
      const face = m.map((tok) => {
        let i = Number(tok);
        if (i < 0) i = out.verts.length + i;
        else i = i - 1;
        return i;
      });
      for (let k = 1; k + 1 < face.length; k++) {
        out.faces.push([face[0], face[k], face[k + 1]]);
      }
    }
  }
  return out;
}

/** 按扩展名导入。 */
export const IMPORT_FORMATS = ['stl', 'obj'];

export function importMesh(buffer, format) {
  switch (format) {
    case 'stl': return importSTL(buffer);
    case 'obj': return importOBJ(buffer.toString('utf8'));
    default: throw new Error(`c4d: 网格内核不支持导入 "${format}"；STEP/IGES 需要 OCCT 引擎（opencascade.js），STL/OBJ 始终可用`);
  }
}
