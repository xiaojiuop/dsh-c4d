/**
 * dsh-c4d 网格内核 —— 基础网格类型与几何运算。
 *
 * Mesh = { verts: [[x,y,z],...], faces: [[i,j,k],...] }（三角面片，顶点按右手定则逆时针 = 面法线朝外）。
 * 零依赖：所有计算纯 JS，不依赖任何第三方包。
 */

/** 新建空网格。 */
export function emptyMesh() {
  return { verts: [], faces: [] };
}

/** 深拷贝网格。 */
export function cloneMesh(mesh) {
  return {
    verts: mesh.verts.map((v) => [v[0], v[1], v[2]]),
    faces: mesh.faces.map((f) => [f[0], f[1], f[2]]),
  };
}

/** 追加网格（合并），返回新网格。 */
export function mergeMeshes(...meshes) {
  const out = emptyMesh();
  for (const mesh of meshes) {
    const base = out.verts.length;
    for (const v of mesh.verts) out.verts.push([v[0], v[1], v[2]]);
    for (const f of mesh.faces) out.faces.push([f[0] + base, f[1] + base, f[2] + base]);
  }
  return out;
}

/** 包围盒 [[minX,minY,minZ],[maxX,maxY,maxZ]]；空网格返回 null。 */
export function bounds(mesh) {
  if (mesh.verts.length === 0) return null;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const [x, y, z] of mesh.verts) {
    if (x < minX) minX = x; if (y < minY) minY = y; if (z < minZ) minZ = z;
    if (x > maxX) maxX = x; if (y > maxY) maxY = y; if (z > maxZ) maxZ = z;
  }
  return [[minX, minY, minZ], [maxX, maxY, maxZ]];
}

/** 面法线（未归一化面积向量）。 */
export function faceNormal(verts, face) {
  const [a, b, c] = face.map((i) => verts[i]);
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz);
  if (len === 0) return [0, 0, 0];
  return [nx / len, ny / len, nz / len];
}

/** 统计信息：顶点 / 面 / 边界框 / 尺寸。 */
export function meshStats(mesh) {
  const bb = bounds(mesh);
  const size = bb ? [bb[1][0] - bb[0][0], bb[1][1] - bb[0][1], bb[1][2] - bb[0][2]] : [0, 0, 0];
  return {
    vertices: mesh.verts.length,
    faces: mesh.faces.length,
    bounds: bb,
    size,
  };
}

/** 4x4 行主序矩阵：[xx,xy,xz,xw, yx,yy,yz,yw, zx,zy,zz,zw, tx,ty,tz,1]。 */
export function matIdentity() {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

export function matMul(a, b) {
  const out = new Array(16).fill(0);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[r * 4 + k] * b[k * 4 + c];
      out[r * 4 + c] = sum;
    }
  }
  return out;
}

/** 平移矩阵（行主序：平移在 m03/m07/m11）。 */
export function matTranslate([x, y, z]) {
  return [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z, 0, 0, 0, 1];
}

/** 缩放矩阵。 */
export function matScale([x, y, z]) {
  return [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1];
}

/** 欧拉角旋转矩阵（度，XYZ 顺序，先 X 后 Y 后 Z；弧度内部换算）。 */
export function matRotateEuler([rx, ry, rz]) {
  const rad = Math.PI / 180;
  const ax = rx * rad, ay = ry * rad, az = rz * rad;
  const cx = Math.cos(ax), sx = Math.sin(ax);
  const cy = Math.cos(ay), sy = Math.sin(ay);
  const cz = Math.cos(az), sz = Math.sin(az);
  // Rz * Ry * Rx（先绕 X，再绕 Y，再绕 Z —— C4D 欧拉顺序）
  const Rx = [1, 0, 0, 0, 0, cx, sx, 0, 0, -sx, cx, 0, 0, 0, 0, 1];
  const Ry = [cy, 0, -sy, 0, 0, 1, 0, 0, sy, 0, cy, 0, 0, 0, 0, 1];
  const Rz = [cz, sz, 0, 0, -sz, cz, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  return matMul(Rz, matMul(Ry, Rx));
}

/** 组合平移/旋转/缩放为世界矩阵（C4D 约定：P * S，先缩放后平移；旋转作用于缩放后的局部轴）。 */
export function matCompose({ position, rotation, scale }) {
  let m = matIdentity();
  if (scale !== undefined) m = matMul(matScale(scale), m);
  if (rotation !== undefined) m = matMul(matRotateEuler(rotation), m);
  if (position !== undefined) m = matMul(matTranslate(position), m);
  return m;
}

/** 行主序 4x4 矩阵取行列。 */
function mGet(m, r, c) { return m[r * 4 + c]; }

/** 变换网格（点变换；行列式为负时翻转面绕向以保持法线朝外）。 */
export function transformMesh(mesh, m) {
  const det = mGet(m, 0, 0) * (mGet(m, 1, 1) * mGet(m, 2, 2) - mGet(m, 1, 2) * mGet(m, 2, 1))
    - mGet(m, 0, 1) * (mGet(m, 1, 0) * mGet(m, 2, 2) - mGet(m, 1, 2) * mGet(m, 2, 0))
    + mGet(m, 0, 2) * (mGet(m, 1, 0) * mGet(m, 2, 1) - mGet(m, 1, 1) * mGet(m, 2, 0));
  const flip = det < 0;
  const out = {
    verts: mesh.verts.map((v) => {
      const x = v[0], y = v[1], z = v[2];
      return [
        mGet(m, 0, 0) * x + mGet(m, 0, 1) * y + mGet(m, 0, 2) * z + mGet(m, 0, 3),
        mGet(m, 1, 0) * x + mGet(m, 1, 1) * y + mGet(m, 1, 2) * z + mGet(m, 1, 3),
        mGet(m, 2, 0) * x + mGet(m, 2, 1) * y + mGet(m, 2, 2) * z + mGet(m, 2, 3),
      ];
    }),
    faces: mesh.faces.map((f) => (flip ? [f[0], f[2], f[1]] : [f[0], f[1], f[2]])),
  };
  return out;
}

/** 包围盒中心与半径（供相机取景）。 */
export function boundingSphere(mesh) {
  const bb = bounds(mesh);
  if (!bb) return { center: [0, 0, 0], radius: 1 };
  const center = [(bb[0][0] + bb[1][0]) / 2, (bb[0][1] + bb[1][1]) / 2, (bb[0][2] + bb[1][2]) / 2];
  let radius = 0;
  for (const v of mesh.verts) {
    const d = Math.hypot(v[0] - center[0], v[1] - center[1], v[2] - center[2]);
    if (d > radius) radius = d;
  }
  if (radius <= 0) radius = 1;
  return { center, radius };
}

/** 去除孤立顶点（CSG 或布尔后清理），返回新网格。 */
export function compactMesh(mesh) {
  const used = new Array(mesh.verts.length).fill(false);
  for (const f of mesh.faces) for (const i of f) used[i] = true;
  const remap = new Array(mesh.verts.length).fill(-1);
  const verts = [];
  for (let i = 0; i < mesh.verts.length; i++) {
    if (used[i]) { remap[i] = verts.length; verts.push(mesh.verts[i]); }
  }
  const faces = mesh.faces.map((f) => [remap[f[0]], remap[f[1]], remap[f[2]]]).filter((f) => f.every((i) => i >= 0));
  return { verts, faces };
}

/** 翻转全部面绕向。 */
export function flipMesh(mesh) {
  return { verts: mesh.verts, faces: mesh.faces.map((f) => [f[0], f[2], f[1]]) };
}
