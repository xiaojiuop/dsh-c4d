/**
 * dsh-c4d 模型工具 —— 五个工具：c4d_view / c4d_info / c4d_model / c4d_export / c4d_panel。
 *
 * 与 dsh-cad 的对应：c4d_view ≈ cad_view（渲染预览 → 聊天图像卡片）、
 * c4d_info ≈ cad_info（文件/场景信息）。C4D 特色：对象管理器 JSON 场景、
 * MoGraph 克隆、四视图渲染、常驻 HTML CAD 面板。
 *
 * 图像输出：attachments 服务在场时走 saveImages → 聊天图像卡片；
 * 服务缺失时降级为把 PNG 写入 outputDir 并返回文件路径，绝不失败。
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, extname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

import { buildScene, sceneStats, demoScene } from './scene.js';
import { meshStats, compactMesh, mergeMeshes } from './kernel/mesh.js';
import { exportMesh, EXPORT_FORMATS } from './kernel/exporters.js';
import { importMesh, IMPORT_FORMATS } from './kernel/importers.js';
import { renderImages } from './render/raster.js';
import { probeOcct } from './occt.js';
import { buildPanelHtml } from './panel.js';

/** 品牌化附件 ID（宿主 @deepseek-ai/dsh-attachment 的本地等价物；纯字符串身份）。 */
const AttachmentId = (value) => value;

/** 会话工作目录（与 dsh-ppt 同款解析）。 */
function sessionCwd(exec) {
  return exec?.agent?.session?.header?.cwd ?? process.cwd();
}

/** 解析输出目录（缺省 = 会话工作目录/.c4d）。 */
function resolveOutputDir(exec, config, outputDir) {
  const cwd = sessionCwd(exec);
  const requested = typeof outputDir === 'string' && outputDir.trim() !== '' ? outputDir.trim() : config.outputDir ?? '.c4d';
  return resolve(cwd, requested);
}

/** 场景输入解析：inline scene / 场景 JSON 文件 / 模型文件 / 缺省演示场景。 */
async function resolveEntries(exec, config, { scene, input }) {
  if (scene !== undefined && scene !== null) {
    return buildScene(scene);
  }
  if (typeof input === 'string' && input.trim() !== '') {
    const path = resolve(sessionCwd(exec), input.trim());
    if (!existsSync(path)) throw new Error(`c4d: 找不到文件 "${path}"`);
    const ext = extname(path).slice(1).toLowerCase();
    if (ext === 'json') {
      const text = await readFile(path, 'utf8');
      return buildScene(JSON.parse(text));
    }
    if (IMPORT_FORMATS.includes(ext)) {
      const mesh = importMesh(await readFile(path), ext);
      return [{ mesh, color: undefined, name: basename(path) }];
    }
    if (['step', 'iges', 'igs', 'stp'].includes(ext)) {
      throw new Error(`c4d: "${ext}" 导入需要 OCCT 引擎（opencascade.js）；当前网格内核始终支持 STL / OBJ / JSON 场景`);
    }
    throw new Error(`c4d: 不支持的输入格式 "${ext}"（支持 json 场景 / stl / obj）`);
  }
  return buildScene(demoScene());
}

/** 图像输出：attachments 在场 → 聊天卡片；否则写盘降级。 */
async function emitImages(ctx, exec, config, entries, { mode, size, outputDir, stem }) {
  const rendered = renderImages(entries, { mode, size });
  const attachments = typeof ctx?.get === 'function' ? ctx.get('attachments') : undefined;
  const limit = attachments?.imageLimits;
  const images = [];
  for (const r of rendered) {
    if (limit && r.png.byteLength > limit.maxImageBytes) {
      throw new Error(`c4d: 渲染图像超过 ${limit.maxImageBytes} 字节上限；请降低 size（当前 ${size}）`);
    }
    images.push({ name: r.name, png: r.png, width: r.width, height: r.height });
  }
  if (attachments && typeof attachments.saveImages === 'function') {
    try {
      const refs = await attachments.saveImages(images.map((img, i) => ({
        data: img.png,
        mediaType: 'image/png',
        name: `${stem}-${img.name}-${i + 1}.png`,
      })));
      return {
        images: images.map((img, i) => ({
          view: img.name, attachmentId: refs[i].attachmentId, mediaType: refs[i].mediaType,
          bytes: refs[i].bytes, width: refs[i].width, height: refs[i].height,
        })),
        files: [],
        stored: 'attachment',
      };
    } catch (error) {
      // 附件服务拒绝（如无图像路由）→ 降级写盘
    }
  }
  await mkdir(outputDir, { recursive: true });
  const files = [];
  for (const [i, img] of images.entries()) {
    const path = join(outputDir, `${stem}-${img.name}-${i + 1}.png`);
    await writeFile(path, img.png);
    files.push(path);
  }
  return { images: [], files, stored: 'file' };
}

/** 图像内容块（聊天卡片）。 */
function imageBlocks(result) {
  const blocks = [];
  if (result.images?.length) {
    for (const img of result.images) {
      blocks.push({ type: 'text', text: `${img.view} 视图：${img.width}x${img.height} px` });
      blocks.push({
        type: 'image',
        attachment: {
          attachmentId: AttachmentId(img.attachmentId), mediaType: img.mediaType, bytes: img.bytes,
          width: img.width, height: img.height,
        },
      });
    }
  }
  return blocks;
}

/** 参数编译（与 dsh-ppt 同款：type 数组 → oneOf，required 上提）。 */
function compileParameters(spec) {
  const properties = {};
  const required = [];
  for (const [key, prop] of Object.entries(spec)) {
    if (prop?.required === true) required.push(key);
    const node = {};
    if (typeof prop?.type === 'string' || Array.isArray(prop?.type)) node.type = prop.type;
    if (typeof prop?.description === 'string') node.description = prop.description;
    if (Array.isArray(prop?.enum)) node.enum = prop.enum;
    if (prop?.type === 'array' && prop.items !== null && typeof prop.items === 'object') node.items = prop.items;
    if (prop.properties) node.properties = prop.properties;
    if (prop.additionalProperties !== undefined) node.additionalProperties = prop.additionalProperties;
    properties[key] = node;
  }
  return { type: 'object', properties, ...(required.length > 0 ? { required } : {}) };
}

const oneText = (text) => [{ type: 'text', text }];

/** 对象类型清单（技能与工具描述共用）。 */
export const OBJECT_TYPES = Object.freeze([
  'box', 'sphere', 'cylinder', 'cone', 'torus', 'capsule', 'tube', 'plane', 'pyramid',
  'knot', 'tetra', 'octa', 'icosa', 'dodeca',
  'extrude', 'lathe', 'sweep', 'loft', 'boolean', 'mirror', 'clone',
]);

const RENDER_MODES = ['perspective', 'quad', 'views', 'front', 'top', 'right'];

/** 组装全部工具定义。 */
export function buildC4dTools(config, ctx) {
  const sceneSchema = {
    type: 'object',
    properties: {
      objects: {
        type: 'array',
        items: { type: 'object', properties: { type: { type: 'string' }, name: { type: 'string' }, params: { type: 'object', additionalProperties: true }, position: { type: 'array', items: { type: 'number' } }, rotation: { type: 'array', items: { type: 'number' } }, scale: { type: 'array', items: { type: 'number' } }, color: { type: 'string' }, child: { type: 'object', additionalProperties: true }, a: { type: 'object', additionalProperties: true }, b: { type: 'object', additionalProperties: true }, op: { type: 'string' }, mode: { type: 'string' } }, additionalProperties: true },
        description: 'C4D 对象管理器同款对象列表。type 图元：box/sphere/cylinder/cone/torus/capsule/tube/plane/pyramid/knot/tetra/octa/icosa/dodeca；剖面：extrude/lathe/sweep/loft；运算：boolean(op+a+b)/mirror；克隆：clone(mode=linear|radial|grid+child)。公共：position/rotation(度)/scale/color(#RRGGBB)/name。',
      },
      world: { type: 'object', additionalProperties: true, description: '可选世界设置（预留）。' },
    },
    required: ['objects'],
    additionalProperties: true,
  };

  const entryParameters = {
    scene: { type: 'object', properties: sceneSchema.properties, required: ['objects'], additionalProperties: true, description: '内联场景 JSON（与 input 二选一；都缺省时渲染演示场景）。' },
    input: { type: 'string', description: '模型或场景文件路径：.json 场景 / .stl / .obj（相对会话工作目录或绝对）。' },
  };

  return [
    {
      name: 'c4d_view',
      description: 'Render a C4D-style model or parametric scene to shaded preview images you can view — perspective or C4D quad view (perspective + front/top/right). Input: inline scene JSON, a .json scene file, or an .stl/.obj model; omit everything for the demo scene. Rendered by a built-in pure-JS rasterizer; no Cinema 4D installation or connection is involved. Images return as chat cards when the attachment service is available, otherwise as PNG files. 中文：把 C4D 风格模型或参数化场景渲染为着色预览图（透视或 C4D 四视图），输入为内联场景 JSON、.json 场景文件或 .stl/.obj 模型，全部缺省时渲染演示场景；由内置纯 JS 光栅化器绘制，无需安装或连接 Cinema 4D。图像以聊天卡片或 PNG 文件返回。',
      parameters: compileParameters({
        ...entryParameters,
        mode: { type: 'string', enum: RENDER_MODES, description: 'perspective（默认单透视）/ quad（四视图拼合）/ views（四张分图）/ front / top / right（单标准视图）。' },
        size: { type: 'integer', description: '视图边长像素 240–2048，默认 720（quad 输出约 2×size）。' },
        edges: { type: 'boolean', description: '特征边线框叠加，默认 true。' },
        edgeAngle: { type: 'integer', description: '特征边角度阈值（度），默认 30。' },
        outputDir: { type: 'string', description: '附件服务缺失时的 PNG 输出目录，默认 .c4d。' },
      }),
      output: {
        schema: {
          type: 'object', additionalProperties: true,
          properties: {
            ok: { type: 'boolean' }, mode: { type: 'string' }, stored: { type: 'string' },
            images: { type: 'array', items: { type: 'object', additionalProperties: true } },
            files: { type: 'array', items: { type: 'string' } },
            objects: { type: 'integer' }, faces: { type: 'integer' },
          },
        },
        render: (_args, value) => {
          const blocks = [{ type: 'text', text: `c4d_view：${value.objects} 个对象 / ${value.faces} 面，模式 ${value.mode}，${value.stored === 'attachment' ? '图像已作为聊天卡片输出' : `PNG 已写入 ${value.files.join('、')}`}` }];
          return [...blocks, ...imageBlocks(value)];
        },
      },
      presentCall: (args) => ({ card: 'generic', title: `C4D 渲染 ${args?.input ?? args?.scene ? '(场景)' : '(演示场景)'}`, kind: 'read' }),
      async execute(args, exec) {
        exec?.signal?.throwIfAborted();
        const entries = await resolveEntries(exec, config, args);
        const outputDir = resolveOutputDir(exec, config, args.outputDir);
        const size = Math.min(2048, Math.max(240, Number(args.size) || 720));
        const out = await emitImages(ctx, exec, config, entries, {
          mode: RENDER_MODES.includes(args.mode) ? args.mode : 'perspective',
          size,
          outputDir,
          stem: 'c4d-view',
        });
        const stats = sceneStats(entries);
        return { ok: true, mode: RENDER_MODES.includes(args.mode) ? args.mode : 'perspective', ...out, objects: stats.objects, faces: stats.faces };
      },
    },
    {
      name: 'c4d_info',
      description: 'Inspect a C4D-style model or scene without building artifacts: object list, vertices, faces, bounding box, size, and engine capabilities (mesh kernel always; STEP/IGES not implemented yet; no Cinema 4D connection). 中文：检查 C4D 风格模型或场景（对象列表/顶点/面/包围盒/尺寸/引擎能力），不产生渲染产物；STEP/IGES 尚未接入，全程不连接 Cinema 4D。',
      parameters: compileParameters({
        ...entryParameters,
      }),
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => oneText(JSON.stringify(value, null, 2)),
      },
      presentCall: (args) => ({ card: 'generic', title: `C4D 信息 ${args?.input ?? ''}`.trim(), kind: 'read' }),
      async execute(args, exec) {
        exec?.signal?.throwIfAborted();
        const entries = await resolveEntries(exec, config, args);
        const stats = sceneStats(entries);
        const occt = await probeOcct();
        return {
          ok: true,
          objects: stats.objects,
          objectNames: stats.names,
          vertices: stats.vertices,
          faces: stats.faces,
          bounds: meshStats(mergeMeshes(...entries.map((e) => e.mesh))).bounds,
          size: meshStats(mergeMeshes(...entries.map((e) => e.mesh))).size,
          engine: {
            kernel: 'mesh 网格内核（图元/剖面/克隆/布尔/STL/OBJ/DXF/SVG，始终可用，零依赖）',
            occt: occt
              ? 'opencascade.js 已安装，但 STEP/IGES 读写管线在当前版本尚未接入——请改用 STL（二进制）作为交换格式'
              : 'opencascade.js 未安装，且 STEP/IGES 管线当前版本尚未接入——请改用 STL / OBJ',
            cadSoftware: '不连接、不驱动 Cinema 4D 主程序，也不读写 .c4d 工程文件；模型由本插件内置网格内核独立生成',
          },
        };
      },
    },
    {
      name: 'c4d_model',
      description: 'Build a C4D-style parametric scene: the Object-Manager JSON is compiled to meshes by the built-in mesh kernel, written as a persistent .c4d/c4d-scene.json workspace artifact, optionally exported (stl/obj/dxf/svg) and rendered. Does not drive Cinema 4D and does not write .c4d project files. 中文：构建 C4D 风格参数化场景（对象管理器 JSON → 内置网格内核编译为网格），写入常驻 .c4d/c4d-scene.json 工作区产物，可选导出 STL/OBJ/DXF/SVG 并渲染预览；不驱动 Cinema 4D，不写 .c4d 工程文件。',
      parameters: compileParameters({
        scene: { type: 'object', properties: sceneSchema.properties, required: ['objects'], additionalProperties: true, description: '场景 JSON（objects 必填）。' },
        outputDir: { type: 'string', description: '产物目录，默认 .c4d（含 c4d-scene.json 常驻场景）。' },
        fileName: { type: 'string', description: '场景文件名（不含扩展名），默认 c4d-scene。' },
        export: { type: 'array', items: { type: 'string', enum: EXPORT_FORMATS }, description: '同时导出的格式列表，如 ["stl","obj","dxf","svg"]。' },
        unit: { type: 'string', enum: ['mm', 'cm', 'm', 'inch'], description: '导出单位，默认 mm。' },
        render: { type: 'boolean', description: '构建后同时渲染预览（默认 true；mode 用 view 参数）。' },
        view: { type: 'string', enum: RENDER_MODES, description: '预览视图模式，默认 quad（四视图）。' },
        size: { type: 'integer', description: '预览边长像素，默认 720。' },
      }),
      output: {
        schema: { type: 'object', additionalProperties: true, properties: { ok: { type: 'boolean' }, scenePath: { type: 'string' }, objects: { type: 'integer' }, faces: { type: 'integer' }, exports: { type: 'array', items: { type: 'string' } } } },
        render: (_args, value) => {
          const blocks = [{ type: 'text', text: `c4d_model：${value.objects} 个对象 / ${value.faces} 面。\n常驻场景：${value.scenePath}\n${(value.exports ?? []).length ? '导出：' + value.exports.join('、') + '\n' : ''}${value.stored === 'attachment' ? '预览已作为聊天卡片输出' : value.files?.length ? '预览 PNG：' + value.files.join('、') : ''}` }];
          return [...blocks, ...imageBlocks(value)];
        },
      },
      presentCall: (args) => ({ card: 'generic', title: 'C4D 构建参数化场景', kind: 'other' }),
      async execute(args, exec) {
        exec?.signal?.throwIfAborted();
        if (args.scene === undefined && args.input === undefined) {
          throw new Error('c4d_model：scene 参数不能为空（C4D 对象管理器至少要有一个对象）；想先看效果请用 c4d_view（缺省渲染演示场景）');
        }
        const entries = await resolveEntries(exec, config, { scene: args.scene });
        const outputDir = resolveOutputDir(exec, config, args.outputDir);
        await mkdir(outputDir, { recursive: true });
        const stem = typeof args.fileName === 'string' && args.fileName.trim() !== '' ? args.fileName.trim() : 'c4d-scene';
        const scenePath = join(outputDir, `${stem}.json`);
        await writeFile(scenePath, JSON.stringify(args.scene, null, 2) + '\n', 'utf8');
        const stats = sceneStats(entries);
        const exports = [];
        const formats = Array.isArray(args.export) ? args.export : [];
        for (const format of formats) {
          if (!EXPORT_FORMATS.includes(format)) throw new Error(`c4d_model: 不支持的导出格式 "${format}"（支持 ${EXPORT_FORMATS.join('/')}）`);
          const merged = mergeMeshes(...entries.map((e) => e.mesh));
          const buf = exportMesh(merged, format, { unit: args.unit ?? 'mm' });
          const path = join(outputDir, `${stem}.${format}`);
          await writeFile(path, buf);
          exports.push(path);
        }
        const wantRender = args.render !== false;
        let preview = null;
        if (wantRender) {
          preview = await emitImages(ctx, exec, config, entries, {
            mode: RENDER_MODES.includes(args.view) ? args.view : 'quad',
            size: Math.min(2048, Math.max(240, Number(args.size) || 720)),
            outputDir,
            stem: 'c4d-model',
          });
        }
        return {
          ok: true, scenePath, objects: stats.objects, faces: stats.faces, vertices: stats.vertices,
          exports, ...preview,
        };
      },
    },
    {
      name: 'c4d_export',
      description: 'Export a C4D-style model or scene to a file: stl (binary/ascii), obj, dxf (R12 wireframe), svg (three-view wireframe). Currently available formats are stl/obj/dxf/svg only; step/iges are not implemented yet and return a clear message pointing to STL. 中文：导出 C4D 风格模型或场景到文件：stl（二进制/ASCII）、obj、dxf（R12 线框）、svg（三视图线框）。当前仅 stl/obj/dxf/svg 可用；step/iges 尚未接入，调用会返回明确提示并建议改用 STL。',
      parameters: compileParameters({
        ...entryParameters,
        format: { type: 'string', enum: [...EXPORT_FORMATS, 'step', 'iges'], required: true, description: '导出格式。' },
        unit: { type: 'string', enum: ['mm', 'cm', 'm', 'inch'], description: '导出单位，默认 mm。' },
        ascii: { type: 'boolean', description: 'STL 用 ASCII（默认二进制）。' },
        output: { type: 'string', description: '输出文件路径（缺省 outputDir/<stem>.<format>）。' },
        outputDir: { type: 'string', description: '输出目录，默认 .c4d。' },
        fileName: { type: 'string', description: '输出文件名（不含扩展名），默认 c4d-export。' },
      }),
      output: {
        schema: { type: 'object', additionalProperties: true, properties: { ok: { type: 'boolean' }, file: { type: 'string' }, format: { type: 'string' }, bytes: { type: 'integer' } } },
        render: (_args, value) => oneText(`c4d_export：已写入 ${value.file}（${value.format}，${value.bytes} 字节）。`),
      },
      presentCall: (args) => ({ card: 'generic', title: `C4D 导出 ${args?.format ?? ''}`.trim(), kind: 'other' }),
      async execute(args, exec) {
        exec?.signal?.throwIfAborted();
        const format = String(args.format ?? '').toLowerCase();
        if (['step', 'iges', 'igs', 'stp'].includes(format)) {
          const { exportSTEP, exportIGES } = await import('./occt.js');
          if (format === 'step') await exportSTEP(null, {});
          await exportIGES(null, {});
        }
        if (!EXPORT_FORMATS.includes(format)) {
          throw new Error(`c4d_export：不支持的格式 "${format}"（网格内核支持 ${EXPORT_FORMATS.join('/')}；step/iges 需要 OCCT 引擎）`);
        }
        const entries = await resolveEntries(exec, config, args);
        const merged = mergeMeshes(...entries.map((e) => e.mesh));
        const buf = exportMesh(merged, format, { unit: args.unit ?? 'mm', ascii: args.ascii === true });
        const outputDir = resolveOutputDir(exec, config, args.outputDir);
        await mkdir(outputDir, { recursive: true });
        const stem = typeof args.fileName === 'string' && args.fileName.trim() !== '' ? args.fileName.trim() : 'c4d-export';
        const file = typeof args.output === 'string' && args.output.trim() !== '' ? resolve(sessionCwd(exec), args.output.trim()) : join(outputDir, `${stem}.${format}`);
        await writeFile(file, buf);
        return { ok: true, file, format, bytes: buf.byteLength };
      },
    },
    {
      name: 'c4d_panel',
      description: 'Generate the persistent C4D-style CAD panel: a self-contained offline c4d-panel.html with an interactive orbit viewer (drag to rotate, scroll to zoom, quad/single view switch) and the object manager list. Pure offline HTML, no Cinema 4D needed; open it in any browser and it stays in the workspace. 中文：生成常驻 C4D 风格 CAD 面板：自包含离线 c4d-panel.html，含交互轨道查看器（拖拽旋转/滚轮缩放/四视图切换）与对象管理器列表；纯离线 HTML，无需 Cinema 4D，浏览器直接打开，常驻工作区。',
      parameters: compileParameters({
        ...entryParameters,
        outputDir: { type: 'string', description: '面板输出目录，默认 .c4d。' },
        fileName: { type: 'string', description: '面板文件名（不含扩展名），默认 c4d-panel。' },
      }),
      output: {
        schema: { type: 'object', additionalProperties: true, properties: { ok: { type: 'boolean' }, panel: { type: 'string' } } },
        render: (_args, value) => oneText(`c4d_panel：常驻 CAD 面板已生成 ${value.panel}。\n浏览器直接打开即可：拖拽旋转、滚轮缩放、数字键 1-5 切换透视/四视图；左侧对象管理器列出全部对象与面数。`),
      },
      presentCall: (args) => ({ card: 'generic', title: 'C4D 生成常驻面板', kind: 'other' }),
      async execute(args, exec) {
        exec?.signal?.throwIfAborted();
        const entries = await resolveEntries(exec, config, args);
        const outputDir = resolveOutputDir(exec, config, args.outputDir);
        await mkdir(outputDir, { recursive: true });
        const stem = typeof args.fileName === 'string' && args.fileName.trim() !== '' ? args.fileName.trim() : 'c4d-panel';
        const panel = join(outputDir, `${stem}.html`);
        const html = buildPanelHtml(entries, { title: 'dsh-c4d 常驻面板' });
        await writeFile(panel, html, 'utf8');
        const stats = sceneStats(entries);
        return { ok: true, panel, objects: stats.objects, faces: stats.faces };
      },
    },
  ];
}


