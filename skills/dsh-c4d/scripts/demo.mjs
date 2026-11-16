/**
 * dsh-c4d 演示脚本 —— 不经过 cordis 直接驱动内核：构建演示场景 → 渲染 → 导出 → 生成面板。
 *
 * 用法：node skills/dsh-c4d/scripts/demo.mjs [--out 目录] [--scene 场景JSON路径]
 */

import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const { buildScene, demoScene, sceneStats } = await import(pathToFileURL(resolve(pluginRoot, 'lib/scene.js')).href);
const { renderImages } = await import(pathToFileURL(resolve(pluginRoot, 'lib/render/raster.js')).href);
const { exportMesh } = await import(pathToFileURL(resolve(pluginRoot, 'lib/kernel/exporters.js')).href);
const { buildPanelHtml } = await import(pathToFileURL(resolve(pluginRoot, 'lib/panel.js')).href);

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
};
const outDir = resolve(process.cwd(), flag('--out') ?? '.c4d-demo');
await mkdir(outDir, { recursive: true });

const scenePath = flag('--scene');
const scene = scenePath ? JSON.parse(await readFile(resolve(process.cwd(), scenePath), 'utf8')) : demoScene();
const entries = buildScene(scene);
const stats = sceneStats(entries);
console.log(`场景：${stats.objects} 个对象 / ${stats.vertices} 顶点 / ${stats.faces} 面`);
console.log(`对象：${stats.names.join('、')}`);

// 渲染：四视图 + 单透视
for (const mode of ['quad', 'perspective']) {
  const images = renderImages(entries, { mode, size: 720 });
  for (const img of images) {
    const path = resolve(outDir, `demo-${mode}.png`);
    await writeFile(path, img.png);
    console.log(`渲染：${path}（${img.width}x${img.height}，${img.png.byteLength} 字节）`);
  }
}

// 导出四格式
const merged = { verts: entries.flatMap((e) => e.mesh.verts), faces: [] };
{
  let base = 0;
  const faces = [];
  for (const e of entries) {
    for (const f of e.mesh.faces) faces.push(f.map((i) => i + base));
    base += e.mesh.verts.length;
  }
  merged.faces = faces;
}
for (const format of ['stl', 'obj', 'dxf', 'svg']) {
  const buf = exportMesh(merged, format, { unit: 'mm' });
  const path = resolve(outDir, `demo.${format}`);
  await writeFile(path, buf);
  console.log(`导出：${path}（${buf.byteLength} 字节）`);
}

// 常驻面板
const panel = resolve(outDir, 'c4d-panel.html');
await writeFile(panel, buildPanelHtml(entries, { title: 'dsh-c4d 演示面板' }));
console.log(`面板：${panel}`);
console.log('完成。');
