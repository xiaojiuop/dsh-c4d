/**
 * dsh-c4d 内核单元测试。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { box, sphere, cylinder, torus, platonic, torusKnot, capsule, tube, pyramid, plane, cone } from '../lib/kernel/primitives.js';
import { extrude, lathe, sweep, loft, clone, mirror, starProfile, circleProfile } from '../lib/kernel/ops.js';
import { boolean } from '../lib/kernel/csg.js';
import { mergeMeshes, bounds, transformMesh, matCompose, compactMesh } from '../lib/kernel/mesh.js';
import { exportSTL, exportOBJ, exportDXF, exportSVG, exportMesh } from '../lib/kernel/exporters.js';
import { importMesh } from '../lib/kernel/importers.js';
import { buildScene, demoScene, sceneStats } from '../lib/scene.js';
import { renderImages, renderView } from '../lib/render/raster.js';
import { encodePNG } from '../lib/render/png.js';
import { buildPanelHtml } from '../lib/panel.js';

function assertValidMesh(mesh, label = 'mesh') {
  assert.ok(mesh.verts.length > 0, `${label} 应有顶点`);
  assert.ok(mesh.faces.length > 0, `${label} 应有面`);
  for (const f of mesh.faces) {
    for (const i of f) {
      assert.ok(Number.isInteger(i) && i >= 0 && i < mesh.verts.length, `${label} 面索引越界: ${JSON.stringify(f)}`);
    }
  }
}

test('全部图元输出流形网格', () => {
  const cases = {
    box: box({}), sphere: sphere({}), cylinder: cylinder({}), cone: cone({}),
    torus: torus({}), capsule: capsule({}), tube: tube({}), pyramid: pyramid({}),
    plane: plane({}), knot: torusKnot({}),
    tetra: platonic({ kind: 'tetra' }), octa: platonic({ kind: 'octa' }),
    icosa: platonic({ kind: 'icosa' }), dodeca: platonic({ kind: 'dodeca' }),
  };
  for (const [name, mesh] of Object.entries(cases)) assertValidMesh(mesh, name);
});

test('剖面操作（挤出/旋转/扫描/放样）支持凹截面', () => {
  assertValidMesh(extrude({ profile: starProfile({}), depth: 100 }), 'extrude-star');
  assertValidMesh(extrude({ profile: circleProfile({}), depth: 100 }), 'extrude-circle');
  assertValidMesh(lathe({ profile: [[40, -60], [90, 0], [40, 60]] }), 'lathe');
  assertValidMesh(sweep({ profile: circleProfile({ r: 30, seg: 12 }), path: [[0, 0, 0], [0, 100, 0], [60, 180, 0]] }), 'sweep');
  assertValidMesh(loft({ profiles: [circleProfile({ r: 80 }), circleProfile({ r: 40 })], height: 120 }), 'loft');
});

test('MoGraph 克隆与镜像', () => {
  const child = torus({ R: 60, r: 20 });
  assertValidMesh(clone(child, { mode: 'linear', count: 5, step: [0, 120, 0] }), 'clone-linear');
  assertValidMesh(clone(child, { mode: 'radial', count: 8, radius: 200, axis: 'y' }), 'clone-radial');
  assertValidMesh(clone(child, { mode: 'grid', grid: [2, 2, 2], step: [150, 150, 150] }), 'clone-grid');
  assertValidMesh(mirror(box({ w: 100, h: 50, d: 200 }), { axis: 'x' }), 'mirror');
});

test('布尔运算（差/并/交）', () => {
  const a = sphere({ r: 100, seg: 24, rings: 12 });
  const b = box({ w: 80, h: 300, d: 80 });
  const diff = boolean(a, b, 'difference');
  assertValidMesh(compactMesh(diff), 'difference');
  assert.ok(diff.faces.length < a.faces.length * 1.5 + 100, '差集面数不应爆炸');
  const uni = boolean(box({}), sphere({ r: 80 }), 'union');
  assertValidMesh(compactMesh(uni), 'union');
  const inter = boolean(box({}), sphere({ r: 80 }), 'intersection');
  assertValidMesh(compactMesh(inter), 'intersection');
});

test('变换矩阵组合', () => {
  const m = transformMesh(box({ w: 100, h: 100, d: 100 }), matCompose({ position: [10, 20, 30] }));
  const bb = bounds(m);
  assert.deepEqual(bb[0].map((v) => Math.round(v)), [-40, -30, -20]);
  assert.deepEqual(bb[1].map((v) => Math.round(v)), [60, 70, 80]);
});

test('场景构建与统计', () => {
  const entries = buildScene(demoScene());
  const stats = sceneStats(entries);
  assert.equal(stats.objects, 5);
  assert.ok(stats.faces > 5000);
  assert.equal(entries.length, 5);
  assert.ok(entries.every((e) => Array.isArray(e.color)));
});

test('导出与导入往返（STL 二进制 → 重新导入）', async () => {
  const mesh = torus({ R: 100, r: 30, seg: 24, side: 12 });
  const stl = exportSTL(mesh, { unit: 'mm' });
  assert.equal(stl.readUInt32LE(80), mesh.faces.length);
  assert.equal(84 + mesh.faces.length * 50, stl.length);
  const back = importMesh(stl, 'stl');
  assert.equal(back.faces.length, mesh.faces.length);
  const bb1 = bounds(mesh), bb2 = bounds(back);
  for (let k = 0; k < 3; k++) {
    assert.ok(Math.abs(bb1[0][k] - bb2[0][k]) < 1e-3);
    assert.ok(Math.abs(bb1[1][k] - bb2[1][k]) < 1e-3);
  }
});

test('全部导出格式产生非空产物', () => {
  const mesh = mergeMeshes(box({}), sphere({ r: 60 }));
  for (const [format, buf] of [
    ['stl', exportMesh(mesh, 'stl')], ['obj', exportMesh(mesh, 'obj')],
    ['dxf', exportMesh(mesh, 'dxf')], ['svg', exportMesh(mesh, 'svg')],
  ]) {
    assert.ok(buf.byteLength > 100, `${format} 应有内容`);
  }
  // OBJ 文本结构
  const obj = exportOBJ(mesh, {}).toString('utf8');
  assert.ok(obj.includes('v ') && obj.includes('f '));
  // DXF 结构
  const dxf = exportDXF(mesh, {}).toString('utf8');
  assert.ok(dxf.includes('ENTITIES') && dxf.includes('LINE') && dxf.includes('EOF'));
  // SVG 结构
  const svg = exportSVG(mesh, {}).toString('utf8');
  assert.ok(svg.startsWith('<svg') && svg.includes('</svg>'));
});

test('渲染：四视图/单视图/超采样输出 PNG', () => {
  const entries = buildScene(demoScene());
  for (const mode of ['perspective', 'quad', 'views']) {
    const images = renderImages(entries, { mode, size: 360 });
    assert.ok(images.length >= 1, `${mode} 应至少一张图`);
    for (const img of images) {
      assert.equal(img.png.readUInt32BE(0), 0x89504E47, 'PNG 魔数');
      assert.ok(img.png.byteLength > 1000);
    }
  }
  const single = renderView([{ mesh: box({}), color: [0.5, 0.6, 0.7] }], { view: 'front', size: 200, samples: 1 });
  assert.equal(single.width, 200);
});

test('PNG 编码器（RGBA → 合法 PNG）', () => {
  const w = 8, h = 8;
  const rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    rgba[i * 4] = i * 8; rgba[i * 4 + 1] = 64; rgba[i * 4 + 2] = 128; rgba[i * 4 + 3] = 255;
  }
  const png = encodePNG(rgba, w, h);
  assert.equal(png.readUInt32BE(0), 0x89504E47);
  assert.equal(png.readUInt32BE(16), w);
  assert.equal(png.readUInt32BE(20), h);
});

test('常驻面板 HTML 自包含', () => {
  const entries = buildScene(demoScene());
  const html = buildPanelHtml(entries);
  assert.ok(html.startsWith('<!doctype html>'));
  assert.ok(html.includes('__C4D_SCENE__'));
  assert.ok(html.includes('对象管理器'));
  assert.ok(!/<script\s+src=/.test(html), '面板不得引用外部脚本');
});

test('tools 层：c4d_view / c4d_model / c4d_export / c4d_panel 全链路', async () => {
  const { buildC4dTools } = await import('../lib/tools.js');
  const dir = await mkdtemp(join(tmpdir(), 'c4d-test-'));
  const config = { outputDir: dir };
  const mockCtx = { get: () => undefined, logger: { warn: () => {} } };
  const tools = buildC4dTools(config, mockCtx);
  const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
  const exec = { signal: { throwIfAborted() {} }, agent: undefined };
  const cwd = process.cwd();

  // c4d_view（缺省演示场景，附件缺失 → 降级写盘）
  const view = await byName.c4d_view.execute({ outputDir: dir }, exec);
  assert.equal(view.ok, true);
  assert.equal(view.stored, 'file');
  assert.ok(view.files.length >= 1);

  // c4d_model（构建 + 导出 + 渲染）
  const scene = { objects: [{ type: 'torus', params: { R: 100, r: 30 } }, { type: 'sphere', params: { r: 50 }, position: [0, 180, 0] }] };
  const model = await byName.c4d_model.execute({ scene, outputDir: dir, export: ['stl', 'obj'], view: 'perspective' }, exec);
  assert.equal(model.ok, true);
  assert.ok(model.scenePath.endsWith('c4d-scene.json'));
  assert.equal(model.exports.length, 2);

  // c4d_info
  const info = await byName.c4d_info.execute({ scene }, exec);
  assert.equal(info.objects, 2);
  assert.ok(info.engine.kernel.includes('始终可用'));

  // c4d_export（从场景文件导出 dxf）
  const exportResult = await byName.c4d_export.execute({ input: model.scenePath, format: 'dxf', outputDir: dir }, exec);
  assert.equal(exportResult.format, 'dxf');
  assert.ok(exportResult.bytes > 100);

  // c4d_panel
  const panel = await byName.c4d_panel.execute({ scene, outputDir: dir }, exec);
  assert.ok(panel.panel.endsWith('c4d-panel.html'));

  // 场景 JSON 文件读取（input 路径）
  const fromFile = await byName.c4d_info.execute({ input: model.scenePath }, exec);
  assert.equal(fromFile.objects, 2);

  await rm(dir, { recursive: true, force: true });
});

test('tools 层：错误路径给出可读信息', async () => {
  const { buildC4dTools } = await import('../lib/tools.js');
  const tools = buildC4dTools({}, { get: () => undefined });
  const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
  const exec = { signal: { throwIfAborted() {} } };
  await assert.rejects(() => byName.c4d_model.execute({}, exec), /scene 参数不能为空/);
  await assert.rejects(() => byName.c4d_export.execute({ scene: { objects: [{ type: 'box' }] }, format: 'step' }, exec), /OCCT|opencascade/i);
  await assert.rejects(() => byName.c4d_view.execute({ input: '不存在的文件.stl' }, exec), /找不到文件/);
  await assert.rejects(() => byName.c4d_model.execute({ scene: { objects: [{ type: '不存在的类型' }] } }, exec), /未知对象类型/);
});
