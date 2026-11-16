/**
 * dsh-c4d 网格布尔 —— BSP 树三角网格 CSG（csg.js 算法移植，纯 JS）。
 *
 * 支持 union / difference / intersection，输入输出均为本内核 Mesh。
 * 适用于流形实体（本内核全部图元与剖面操作均为流形输出）。
 */

import { flipMesh, bounds as meshBounds } from './mesh.js';

/** 包围盒包含判定（带 1e-6 容差）：outer ⊇ inner。 */
function bbContains(outer, inner) {
  if (!outer || !inner) return false;
  for (let k = 0; k < 3; k++) {
    if (inner[0][k] < outer[0][k] - 1e-6 || inner[1][k] > outer[1][k] + 1e-6) return false;
  }
  return true;
}

/** 网格质心（顶点均值）。 */
function centroid(mesh) {
  const c = [0, 0, 0];
  for (const v of mesh.verts) {
    c[0] += v[0]; c[1] += v[1]; c[2] += v[2];
  }
  const n = Math.max(1, mesh.verts.length);
  return [c[0] / n, c[1] / n, c[2] / n];
}

/** 射线法点在网格内判定（Möller–Trumbore 交点计数，三条射线多数表决）。 */
export function pointInMesh(p, mesh) {
  const dirs = [
    [0.5773503, 0.5735764, 0.5828384],
    [0.3244771, 0.8111613, 0.4867219],
    [0.7557887, 0.4534722, 0.4741396],
  ];
  let inside = 0;
  for (const dir of dirs) {
    let crossings = 0;
    for (const face of mesh.faces) {
      const [a, b, c] = face.map((i) => mesh.verts[i]);
      const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const pv = [dir[1] * e2[2] - dir[2] * e2[1], dir[2] * e2[0] - dir[0] * e2[2], dir[0] * e2[1] - dir[1] * e2[0]];
      const det = e1[0] * pv[0] + e1[1] * pv[1] + e1[2] * pv[2];
      if (Math.abs(det) < 1e-12) continue;
      const inv = 1 / det;
      const tv = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
      const u = (tv[0] * pv[0] + tv[1] * pv[1] + tv[2] * pv[2]) * inv;
      if (u < 0 || u > 1) continue;
      const qv = [tv[1] * e1[2] - tv[2] * e1[1], tv[2] * e1[0] - tv[0] * e1[2], tv[0] * e1[1] - tv[1] * e1[0]];
      const v = (dir[0] * qv[0] + dir[1] * qv[1] + dir[2] * qv[2]) * inv;
      if (v < 0 || u + v > 1) continue;
      const t = (e2[0] * qv[0] + e2[1] * qv[1] + e2[2] * qv[2]) * inv;
      if (t > 1e-9) crossings++;
    }
    if (crossings % 2 === 1) inside++;
  }
  return inside >= 2;
}

/** BSP 平面：normal + w（平面方程 n·p = w）。 */
class Plane {
  constructor(normal, w) {
    this.normal = normal;
    this.w = w;
  }
  static fromPoints(a, b, c) {
    const n = [
      (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]),
      (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]),
      (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]),
    ];
    const len = Math.hypot(...n);
    const u = n.map((x) => x / len);
    return new Plane(u, u[0] * a[0] + u[1] * a[1] + u[2] * a[2]);
  }
  flip() {
    return new Plane(this.normal.map((x) => -x), -this.w);
  }
  clone() {
    return new Plane([...this.normal], this.w);
  }
}

/** BSP 多边形：顶点 + 平面 + 共享标志。 */
class BspPolygon {
  constructor(vertices, plane, shared) {
    this.vertices = vertices.map((v) => ({ pos: [...v] }));
    this.plane = plane;
    this.shared = shared;
  }
  clone() {
    const p = new BspPolygon(this.vertices.map((v) => ({ pos: [...v.pos] })), this.plane.clone(), this.shared);
    return p;
  }
  flip() {
    this.vertices.reverse();
    for (const v of this.vertices) v.pos = v.pos;
    this.plane = this.plane.flip();
  }
  /** 转为本内核 Mesh 的三角面（扇形三角化）。 */
  toTriangles(out) {
    const base = out.verts.length;
    for (const v of this.vertices) out.verts.push([...v.pos]);
    for (let i = 1; i + 1 < this.vertices.length; i++) {
      out.faces.push([base, base + i, base + i + 1]);
    }
  }
  /** 平面多边形顶点是否所有位置共享同一平面（供退化检测）。 */
  get isDegenerate() {
    return this.vertices.length < 3;
  }
}

const PLANE_EPSILON = 1e-5;

/** 按平面分割多边形：返回 coplanarFront, coplanarBack, front, back 四组。 */
function splitPolygon(plane, polygon) {
  const result = { front: [], back: [], coplanarFront: [], coplanarBack: [] };
  const polygonType = { COPLANAR: 0, FRONT: 1, BACK: 2, SPANNING: 3 };
  let types = [];
  for (const v of polygon.vertices) {
    const t = plane.normal[0] * v.pos[0] + plane.normal[1] * v.pos[1] + plane.normal[2] * v.pos[2] - plane.w;
    types.push(t > PLANE_EPSILON ? 1 : t < -PLANE_EPSILON ? 2 : 0);
  }
  const unique = [...new Set(types)];
  const type = unique.length === 1 ? (unique[0] === 0 ? 0 : unique[0]) : 3;
  if (type === 0) {
    (polygon.plane.normal[0] * plane.normal[0] + polygon.plane.normal[1] * plane.normal[1] + polygon.plane.normal[2] * plane.normal[2] > 0
      ? result.coplanarFront : result.coplanarBack).push(polygon);
    return result;
  }
  if (type === 1) { result.front.push(polygon); return result; }
  if (type === 2) { result.back.push(polygon); return result; }
  const f = [], b = [];
  for (let i = 0; i < polygon.vertices.length; i++) {
    const j = (i + 1) % polygon.vertices.length;
    const ti = types[i], vi = polygon.vertices[i];
    const tj = types[j], vj = polygon.vertices[j];
    if (ti === 0) f.push(vi), b.push(vi);
    if (ti === 1) f.push(vi);
    if (ti === 2) b.push(vi);
    if ((ti | tj) !== ti && (ti | tj) !== tj && (ti & tj) === 0) {
      const t = (plane.w - (plane.normal[0] * vi.pos[0] + plane.normal[1] * vi.pos[1] + plane.normal[2] * vi.pos[2]))
        / (plane.normal[0] * (vj.pos[0] - vi.pos[0]) + plane.normal[1] * (vj.pos[1] - vi.pos[1]) + plane.normal[2] * (vj.pos[2] - vi.pos[2]));
      const v = {
        pos: [
          vi.pos[0] + t * (vj.pos[0] - vi.pos[0]),
          vi.pos[1] + t * (vj.pos[1] - vi.pos[1]),
          vi.pos[2] + t * (vj.pos[2] - vi.pos[2]),
        ],
      };
      f.push(v); b.push(v);
    }
  }
  if (f.length >= 3) result.front.push(new BspPolygon(f.map((v) => v.pos), polygon.plane, polygon.shared));
  if (b.length >= 3) result.back.push(new BspPolygon(b.map((v) => v.pos), polygon.plane, polygon.shared));
  return result;
}

/** BSP 节点。 */
class Node {
  constructor(polygons) {
    this.plane = null;
    this.front = null;
    this.back = null;
    this.polygons = [];
    if (polygons) this.build(polygons);
  }
  invert() {
    for (const p of this.polygons) p.flip();
    if (this.plane) this.plane = this.plane.flip();
    if (this.front) this.front.invert();
    if (this.back) this.back.invert();
    const t = this.front;
    this.front = this.back;
    this.back = t;
  }
  clipPolygons(polygons) {
    if (this.plane === null) return polygons.slice();
    let front = [], back = [];
    for (const p of polygons) {
      const s = splitPolygon(this.plane, p);
      front.push(...s.front);
      back.push(...s.back);
      front.push(...s.coplanarFront);
      back.push(...s.coplanarBack);
    }
    if (this.front) front = this.front.clipPolygons(front);
    back = this.back ? this.back.clipPolygons(back) : [];
    return [...front, ...back];
  }
  clipTo(bsp) {
    this.polygons = bsp.clipPolygons(this.polygons);
    if (this.front) this.front.clipTo(bsp);
    if (this.back) this.back.clipTo(bsp);
  }
  allPolygons() {
    const out = [...this.polygons];
    if (this.front) out.push(...this.front.allPolygons());
    if (this.back) out.push(...this.back.allPolygons());
    return out;
  }
  build(polygons) {
    if (polygons.length === 0) return;
    if (this.plane === null) this.plane = polygons[0].plane.clone();
    const front = [], back = [];
    for (const p of polygons) {
      const s = splitPolygon(this.plane, p);
      this.polygons.push(...s.coplanarFront);
      front.push(...s.front);
      back.push(...s.back, ...s.coplanarBack);
    }
    if (front.length) (this.front ??= new Node()).build(front);
    if (back.length) (this.back ??= new Node()).build(back);
  }
}

/** 本内核 Mesh → BSP 多边形列表。 */
function meshToPolygons(mesh) {
  const polygons = [];
  for (const face of mesh.faces) {
    const [a, b, c] = face.map((i) => mesh.verts[i]);
    const plane = Plane.fromPoints(a, b, c);
    polygons.push(new BspPolygon([a, b, c], plane, null));
  }
  return polygons;
}

/** BSP 多边形列表 → 本内核 Mesh。 */
function polygonsToMesh(polygons) {
  const out = { verts: [], faces: [] };
  for (const p of polygons) p.toTriangles(out);
  return out;
}

/** 布尔运算。op = union | difference | intersection（csg.js 标准算法）。 */
export function boolean(a, b, op) {
  const A = new Node(meshToPolygons(a));
  const B = new Node(meshToPolygons(b));
  if (op === 'union') {
    A.clipTo(B);
    B.clipTo(A);
    B.invert();
    B.clipTo(A);
    B.invert();
    A.build(B.allPolygons());
    return polygonsToMesh(A.allPolygons());
  }
  if (op === 'difference') {
    A.invert();
    A.clipTo(B);
    B.clipTo(A);
    B.invert();
    B.clipTo(A);
    B.invert();
    A.build(B.allPolygons());
    return polygonsToMesh(A.allPolygons());
  }
  if (op === 'intersection') {
    // 主路径：csg.js 标准相交（适用于部分重叠的两个实体）。
    const primary = (() => {
      const A2 = new Node(meshToPolygons(a));
      const B2 = new Node(meshToPolygons(b));
      A2.invert();
      B2.clipTo(A2);
      B2.invert();
      A2.clipTo(B2);
      A2.clipTo(B2);
      A2.build(B2.allPolygons());
      return polygonsToMesh(A2.allPolygons());
    })();
    if (primary.faces.length > 0) return primary;
    // 嵌套回退：主算法对「一实体完全位于另一实体内部」会退化为空。
    // 用包围盒包含 + 质心射线判定：交集 = 内部实体。
    const bbA = meshBounds(a), bbB = meshBounds(b);
    if (bbContains(bbB, bbA) && pointInMesh(centroid(a), b)) return a;
    if (bbContains(bbA, bbB) && pointInMesh(centroid(b), a)) return b;
    return primary;
  }
  throw new Error(`c4d: 未知布尔运算 "${op}"（支持 union / difference / intersection）`);
}

/** 默认导出（供其它模块 re-export）。 */
export const csg = { boolean, Plane, Node };
