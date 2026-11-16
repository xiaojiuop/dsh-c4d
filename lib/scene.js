/**
 * dsh-c4d 参数化场景 —— C4D 对象管理器同款 JSON 场景构建。
 *
 * 场景 JSON：{ objects: [...], world: {...} }
 * 对象类型（type）：
 *   图元：box / sphere / cylinder / cone / torus / capsule / tube / plane / pyramid /
 *         knot / tetra / octa / icosa / dodeca
 *   剖面：extrude / lathe / sweep / loft（profile / profiles + 参数）
 *   运算：boolean（op + a + b）、mirror（axis + child）
 *   克隆：clone（mode = linear | radial | grid + child + 参数）
 * 公共变换：position / rotation / scale（度 / 无单位）
 * 公共外观：color（#RRGGBB，缺省按对象索引自动分配 C4D 风格蓝灰色系）
 */

import {
  box, sphere, cylinder, cone, torus, torusKnot, capsule, platonic, plane, tube, pyramid,
} from './kernel/primitives.js';
import { extrude, lathe, sweep, loft, clone, mirror, circleProfile, starProfile } from './kernel/ops.js';
import { boolean } from './kernel/csg.js';
import { emptyMesh, mergeMeshes, transformMesh, matCompose, compactMesh } from './kernel/mesh.js';

/** C4D 风格对象色系（蓝灰主色 + MoGraph 多彩辅色）。 */
const OBJECT_COLORS = [
  '#8798ad', '#7fa3b8', '#93a8c4', '#8f9db3', '#a3b4c9',
  '#b8a3c4', '#c4a3a3', '#a3c4b0', '#c4bfa3', '#a3b4c9',
];

function hexToRgb(hex) {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex ?? '');
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => c / 255);
}

/** 图元构造分发表。 */
const PRIMITIVES = {
  box, sphere, cylinder, cone, torus, capsule, tube, plane, pyramid,
  knot: torusKnot,
  tetra: (p) => platonic({ kind: 'tetra', ...p }),
  octa: (p) => platonic({ kind: 'octa', ...p }),
  icosa: (p) => platonic({ kind: 'icosa', ...p }),
  dodeca: (p) => platonic({ kind: 'dodeca', ...p }),
};

/** 便捷截面别名（profile 可写字符串名）。 */
function resolveProfile(profile) {
  if (Array.isArray(profile)) return profile;
  if (profile === 'circle') return circleProfile({ r: 100 });
  if (profile === 'star') return starProfile({});
  if (profile === 'square') return [[-100, -100], [100, -100], [100, 100], [-100, 100]];
  throw new Error(`c4d: 未知截面 "${profile}"（支持点数组 / "circle" / "square" / "star"）`);
}

/** 构造单个对象（不含公共变换）。 */
function buildObject(obj, depth = 0) {
  if (depth > 8) throw new Error('c4d: 场景嵌套超过 8 层');
  const type = obj?.type;
  if (typeof type !== 'string') throw new Error('c4d: 对象缺少 type 字段');
  const params = obj.params ?? {};
  if (PRIMITIVES[type]) return PRIMITIVES[type](params);
  if (type === 'extrude') {
    return extrude({ profile: resolveProfile(params.profile ?? params.shape), depth: params.depth, cap: params.cap });
  }
  if (type === 'lathe') {
    return lathe({ profile: resolveProfile(params.profile ?? params.shape), angle: params.angle, seg: params.seg });
  }
  if (type === 'sweep') {
    return sweep({ profile: resolveProfile(params.profile ?? params.shape), path: params.path, closed: params.closed });
  }
  if (type === 'loft') {
    return loft({ profiles: (params.profiles ?? []).map(resolveProfile), height: params.height });
  }
  if (type === 'boolean') {
    const a = buildObject(obj.a ?? obj.children?.[0], depth + 1);
    const b = buildObject(obj.b ?? obj.children?.[1], depth + 1);
    return compactMesh(boolean(a, b, params.op ?? obj.op ?? 'union'));
  }
  if (type === 'mirror') {
    const child = buildObject(obj.child ?? obj.children?.[0], depth + 1);
    return mirror(child, { axis: params.axis ?? obj.axis ?? 'x', weld: params.weld });
  }
  if (type === 'clone') {
    const child = buildObject(obj.child ?? obj.children?.[0], depth + 1);
    return clone(child, { ...params, mode: params.mode ?? obj.mode ?? 'linear' });
  }
  throw new Error(`c4d: 未知对象类型 "${type}"`);
}

/** 构建整个场景，返回渲染入口 [{ mesh, color, name }]。 */
export function buildScene(scene) {
  const objects = scene?.objects;
  if (!Array.isArray(objects) || objects.length === 0) {
    throw new Error('c4d: 场景 objects 不能为空（C4D 对象管理器至少要有一个对象）');
  }
  const entries = [];
  objects.forEach((obj, i) => {
    let mesh = buildObject(obj);
    if (obj.position !== undefined || obj.rotation !== undefined || obj.scale !== undefined) {
      mesh = transformMesh(mesh, matCompose(obj));
    }
    const color = hexToRgb(obj.color) ?? hexToRgb(OBJECT_COLORS[i % OBJECT_COLORS.length]);
    entries.push({ mesh, color, name: obj.name ?? obj.type });
  });
  return entries;
}

/** 场景统计（对象数 / 总面数 / 包围盒）。 */
export function sceneStats(entries) {
  const verts = entries.reduce((n, e) => n + e.mesh.verts.length, 0);
  const faces = entries.reduce((n, e) => n + e.mesh.faces.length, 0);
  const merged = mergeMeshes(...entries.map((e) => e.mesh));
  return { objects: entries.length, vertices: verts, faces, names: entries.map((e) => e.name) };
}

/** 默认演示场景（C4D MoGraph 风格：径向克隆圆环 + 中心球体布尔 + 挤出底座）。 */
export function demoScene() {
  return {
    objects: [
      { type: 'cylinder', name: '底座', params: { r: 320, h: 40, seg: 48 }, position: [0, -260, 0], color: '#8f9db3' },
      {
        type: 'clone', name: '径向克隆圆环', mode: 'radial', count: 8, radius: 240, axis: 'y',
        child: { type: 'torus', params: { R: 80, r: 28, seg: 32, side: 16 } }, color: '#8798ad',
      },
      { type: 'sphere', name: '中心球体', params: { r: 110, seg: 48, rings: 24 }, color: '#7fa3b8' },
      {
        type: 'boolean', name: '球体开槽', op: 'difference', color: '#8798ad',
        a: { type: 'sphere', params: { r: 110, seg: 48, rings: 24 } },
        b: { type: 'box', params: { w: 60, h: 320, d: 60 }, rotation: [0, 0, 0] },
      },
      {
        type: 'extrude', name: '星形挤出', params: { profile: 'star', depth: 120 }, position: [0, 320, 0],
        color: '#b8a3c4',
      },
    ],
  };
}
