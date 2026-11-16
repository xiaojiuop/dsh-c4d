/**
 * dsh-c4d 软件渲染器 —— 纯 JS 光栅化（z-buffer + 平面着色 + 特征边 + 2x 超采样）。
 *
 * C4D 视图感：浅灰渐变背景、地面网格、标准三视图（前/顶/右，正交）+ 透视视图。
 * 零依赖：不依赖任何图形库，输出 RGBA → PNG（png.js）。
 */

import { bounds, faceNormal, boundingSphere } from '../kernel/mesh.js';
import { featureEdges } from '../kernel/exporters.js';
import { encodePNG } from './png.js';

const MATERIAL_DEFAULT = [0.55, 0.62, 0.72]; // C4D 默认材质的蓝灰

/** 视图定义：透视 + 三视图（正交）。 */
export const VIEW_PRESETS = {
  perspective: { kind: 'perspective', azimuth: 45, elevation: 28 },
  front: { kind: 'ortho', axis: 'z', sign: -1 },
  top: { kind: 'ortho', axis: 'y', sign: 1 },
  right: { kind: 'ortho', axis: 'x', sign: 1 },
};

/** 背景渐变（上浅下深，C4D 视口感）。 */
function paintBackground(rgba, w, h) {
  const top = [0.878, 0.898, 0.918];
  const bottom = [0.780, 0.800, 0.827];
  for (let y = 0; y < h; y++) {
    const t = y / (h - 1);
    const r = (top[0] + (bottom[0] - top[0]) * t) * 255;
    const g = (top[1] + (bottom[1] - top[1]) * t) * 255;
    const b = (top[2] + (bottom[2] - top[2]) * t) * 255;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      rgba[i] = r; rgba[i + 1] = g; rgba[i + 2] = b; rgba[i + 3] = 255;
    }
  }
}

/** 世界 → 相机矩阵（lookAt）。相机空间约定：z = 沿视线方向的深度（可见为正）。 */
function lookAt(eye, target, up) {
  const zAxis = normalize([eye[0] - target[0], eye[1] - target[1], eye[2] - target[2]]);
  let xAxis = cross(up, zAxis);
  const xl = Math.hypot(...xAxis);
  if (xl < 1e-9) xAxis = [1, 0, 0];
  else xAxis = xAxis.map((c) => c / xl);
  const yAxis = cross(zAxis, xAxis);
  return {
    xAxis, yAxis, zAxis,
    eye,
    toCam(p) {
      const d = [p[0] - eye[0], p[1] - eye[1], p[2] - eye[2]];
      return [dot(xAxis, d), dot(yAxis, d), -dot(zAxis, d)];
    },
  };
}

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
function normalize(v) {
  const l = Math.hypot(...v) || 1;
  return v.map((c) => c / l);
}

/** 渲染单个视图，返回 { width, height, rgba }。 */
export function renderView(entries, options) {
  const {
    view = 'perspective',
    size = 720,
    edges = true,
    edgeAngle = 30,
    samples = 2,
    background = true,
    grid = true,
    meshTransforms = null,
  } = options;

  const w = size * samples, h = size * samples;
  const rgba = new Uint8Array(w * h * 4);
  if (background) paintBackground(rgba, w, h);

  // 合并包围盒
  const all = entries.map((e) => e.mesh);
  const bb = bounds({ verts: all.flatMap((m) => m.verts), faces: [] });
  if (!bb) return { width: size, height: size, rgba: new Uint8Array(size * size * 4).fill(255) };
  const { center, radius } = (() => {
    const c = [(bb[0][0] + bb[1][0]) / 2, (bb[0][1] + bb[1][1]) / 2, (bb[0][2] + bb[1][2]) / 2];
    let r = 0;
    for (const m of all) for (const v of m.verts) {
      const d = Math.hypot(v[0] - c[0], v[1] - c[1], v[2] - c[2]);
      if (d > r) r = d;
    }
    return { center: c, radius: Math.max(r, 1) };
  })();

  const preset = VIEW_PRESETS[view] ?? VIEW_PRESETS.perspective;
  let cam, scale;
  const margin = 1.28;
  if (preset.kind === 'perspective') {
    const az = preset.azimuth * Math.PI / 180;
    const el = preset.elevation * Math.PI / 180;
    const dist = radius * 3.2;
    const eye = [
      center[0] + dist * Math.cos(el) * Math.cos(az),
      center[1] + dist * Math.sin(el),
      center[2] + dist * Math.cos(el) * Math.sin(az),
    ];
    cam = lookAt(eye, center, [0, 1, 0]);
    const fov = 30 * Math.PI / 180;
    const fit = radius * margin;
    scale = (w / 2) / (Math.tan(fov / 2) * dist) * dist; // 焦距像素
    scale = (w / 2) / (fit / dist) / Math.tan(fov / 2) * (fit / dist); // 化简后与 (w/2)/tan(fov/2) 同阶
    scale = (w / 2) / Math.tan(fov / 2) * (fit / dist);
  } else {
    // 正交三视图
    const axisIdx = preset.axis === 'x' ? 0 : preset.axis === 'y' ? 1 : 2;
    const eyeDir = [0, 0, 0];
    eyeDir[axisIdx] = preset.sign;
    // up：top 视图朝 -Z；front/right 朝 +Y
    const up = preset.axis === 'y' ? [0, 0, -1] : [0, 1, 0];
    const eye = [center[0] + eyeDir[0] * radius * 4, center[1] + eyeDir[1] * radius * 4, center[2] + eyeDir[2] * radius * 4];
    cam = lookAt(eye, center, up);
    scale = (w / 2) / (radius * margin);
  }

  const zbuf = new Float32Array(w * h).fill(Infinity);

  const project = (p) => {
    const c = cam.toCam(p);
    const z = c[2];
    let sx, sy;
    if (preset.kind === 'perspective') {
      const f = scale / Math.max(z, 1e-6);
      sx = w / 2 + c[0] * f;
      sy = h / 2 - c[1] * f;
    } else {
      sx = w / 2 + c[0] * scale;
      sy = h / 2 - c[1] * scale;
    }
    return { sx, sy, z };
  };

  // 地面网格（透视视图 + 顶视图；取包围盒范围外的规整网格）
  if (grid && preset.kind === 'perspective') {
    const step = niceStep(radius);
    const extent = Math.ceil(radius * 1.6 / step) * step;
    const gy = bb[0][1];
    const lines = [];
    for (let i = -Math.round(extent / step); i <= Math.round(extent / step); i++) {
      lines.push([[i * step, gy, -extent], [i * step, gy, extent]]);
      lines.push([[-extent, gy, i * step], [extent, gy, i * step]]);
    }
    drawLines(rgba, zbuf, w, h, lines, project, [0.62, 0.65, 0.70], 0.55);
  }

  // 光照：主光 + 补光 + 环境
  const keyDir = normalize([0.45, 0.8, 0.35]);
  const fillDir = normalize([-0.5, 0.2, -0.6]);
  const ambient = 0.34;
  const keyI = 0.52, fillI = 0.20;

  const shade = (n, base) => {
    const kd = Math.max(0, dot(n, keyDir)) * keyI;
    const kf = Math.max(0, dot(n, fillDir)) * fillI;
    const k = ambient + kd + kf;
    return [
      Math.min(255, base[0] * k * 255),
      Math.min(255, base[1] * k * 255),
      Math.min(255, base[2] * k * 255),
    ];
  };

  // 光栅化
  for (const entry of entries) {
    const { mesh, color = MATERIAL_DEFAULT } = entry;
    const projected = mesh.verts.map(project);
    for (const f of mesh.faces) {
      const a = projected[f[0]], b = projected[f[1]], c = projected[f[2]];
      if (a === undefined || b === undefined || c === undefined) continue;
      const n = faceNormal(mesh.verts, f);
      // 背面剔除（相机空间 z 朝屏幕内为正：正面三角形叉积 z 分量为负）
      const ca = cam.toCam(mesh.verts[f[0]]);
      const cb = cam.toCam(mesh.verts[f[1]]);
      const cc = cam.toCam(mesh.verts[f[2]]);
      const e1 = [cb[0] - ca[0], cb[1] - ca[1], cb[2] - ca[2]];
      const e2 = [cc[0] - ca[0], cc[1] - ca[1], cc[2] - ca[2]];
      const nCam = cross(e1, e2);
      if (dot(nCam, [0, 0, 1]) >= 0) continue;
      const rgb = shade(n, color);
      rasterTri(rgba, zbuf, w, h, a, b, c, rgb);
    }
  }

  // 特征边（线框叠加）
  if (edges) {
    for (const entry of entries) {
      const lines = featureEdges(entry.mesh, edgeAngle);
      const segments = lines.map(([a, b]) => [entry.mesh.verts[a], entry.mesh.verts[b]]);
      drawLines(rgba, zbuf, w, h, segments, project, [0.16, 0.19, 0.24], 1.0, 4);
    }
  }

  return { width: w, height: h, rgba };
}

/** 取整步长（1-2-5 系列）。 */
function niceStep(radius) {
  const raw = radius / 5;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / pow;
  const step = n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10;
  return step * pow;
}

/** 三角形光栅化（屏幕空间包围盒 + 重心坐标 + z-buffer）。 */
function rasterTri(rgba, zbuf, w, h, a, b, c, rgb) {
  const minX = Math.max(0, Math.floor(Math.min(a.sx, b.sx, c.sx)));
  const maxX = Math.min(w - 1, Math.ceil(Math.max(a.sx, b.sx, c.sx)));
  const minY = Math.max(0, Math.floor(Math.min(a.sy, b.sy, c.sy)));
  const maxY = Math.min(h - 1, Math.ceil(Math.max(a.sy, b.sy, c.sy)));
  if (maxX < minX || maxY < minY) return;
  const area = (b.sx - a.sx) * (c.sy - a.sy) - (b.sy - a.sy) * (c.sx - a.sx);
  if (Math.abs(area) < 1e-12) return;
  const invArea = 1 / area;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5, py = y + 0.5;
      const l1 = ((b.sx - a.sx) * (py - a.sy) - (b.sy - a.sy) * (px - a.sx)) * invArea;
      const l2 = ((c.sx - b.sx) * (py - b.sy) - (c.sy - b.sy) * (px - b.sx)) * invArea;
      const l3 = ((a.sx - c.sx) * (py - c.sy) - (a.sy - c.sy) * (px - c.sx)) * invArea;
      if (l1 < 0 || l2 < 0 || l3 < 0) continue;
      const z = a.z * l1 + b.z * l2 + c.z * l3;
      const i = y * w + x;
      if (z < zbuf[i]) {
        zbuf[i] = z;
        const o = i * 4;
        rgba[o] = rgb[0]; rgba[o + 1] = rgb[1]; rgba[o + 2] = rgb[2]; rgba[o + 3] = 255;
      }
    }
  }
}

/** 线段绘制（相机空间近裁剪 + Bresenham + z 插值 + 深度偏置）。 */
function drawLines(rgba, zbuf, w, h, segments, project, rgb, alpha = 1, bias = 2) {
  const zNear = 1e-3;
  for (const [p1, p2] of segments) {
    // 近裁剪：至少一个端点在相机前方（z > zNear），否则跳过
    const a = project(p1), b = project(p2);
    if (!(a.z > zNear) && !(b.z > zNear)) continue;
    let pa = a, pb = b;
    if (!(pa.z > zNear)) {
      // pa 在后方：按 z 线性插值求交点比例
      const t = (zNear - pa.z) / (pb.z - pa.z);
      pa = { sx: pa.sx + (pb.sx - pa.sx) * t, sy: pa.sy + (pb.sy - pa.sy) * t, z: zNear };
    } else if (!(pb.z > zNear)) {
      const t = (zNear - pb.z) / (pa.z - pb.z);
      pb = { sx: pb.sx + (pa.sx - pb.sx) * t, sy: pb.sy + (pa.sy - pb.sy) * t, z: zNear };
    }
    let x0 = Math.round(pa.sx), y0 = Math.round(pa.sy);
    const x1 = Math.round(pb.sx), y1 = Math.round(pb.sy);
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    if (steps === 0 || !Number.isFinite(steps) || steps > 4 * w) continue;
    const dz = (pb.z - pa.z);
    const dx = (x1 - x0) / steps, dy = (y1 - y0) / steps;
    for (let i = 0; i <= steps; i++) {
      const x = Math.round(x0), y = Math.round(y0);
      if (x >= 0 && y >= 0 && x < w && y < h) {
        const z = pa.z + dz * (i / steps);
        const idx = y * w + x;
        if (z <= zbuf[idx] + bias) {
          const o = idx * 4;
          const ia = 1 - alpha;
          rgba[o] = rgba[o] * ia + rgb[0] * 255 * alpha;
          rgba[o + 1] = rgba[o + 1] * ia + rgb[1] * 255 * alpha;
          rgba[o + 2] = rgba[o + 2] * ia + rgb[2] * 255 * alpha;
        }
      }
      x0 += dx; y0 += dy;
    }
  }
}

/** 2x 盒式降采样。 */
function downsample2(rgba, w, h) {
  const nw = w >> 1, nh = h >> 1;
  const out = new Uint8Array(nw * nh * 4);
  for (let y = 0; y < nh; y++) {
    for (let x = 0; x < nw; x++) {
      for (let c = 0; c < 4; c++) {
        const i00 = ((y * 2) * w + x * 2) * 4 + c;
        const i10 = ((y * 2) * w + x * 2 + 1) * 4 + c;
        const i01 = ((y * 2 + 1) * w + x * 2) * 4 + c;
        const i11 = ((y * 2 + 1) * w + x * 2 + 1) * 4 + c;
        out[(y * nw + x) * 4 + c] = (rgba[i00] + rgba[i10] + rgba[i01] + rgba[i11]) >> 2;
      }
    }
  }
  return { rgba: out, width: nw, height: nh };
}

/** 渲染一组视图（默认透视），返回 PNG Buffer 数组。 */
export function renderImages(entries, options = {}) {
  const {
    mode = 'perspective', // perspective | quad | views
    size = 720,
    ...rest
  } = options;
  const views = mode === 'quad' || mode === 'views'
    ? ['perspective', 'front', 'top', 'right']
    : [mode === 'front' || mode === 'top' || mode === 'right' ? mode : 'perspective'];
  const rendered = views.map((v) => ({ name: v, ...renderView(entries, { ...rest, view: v, size }) }));
  if (mode === 'views') {
    return rendered.map((r) => {
      const ds = r.rgba && r.width > size ? downsample2(r.rgba, r.width, r.height) : r;
      return { name: r.name, png: encodePNG(ds.rgba, ds.width, ds.height), width: ds.width, height: ds.height };
    });
  }
  let out = rendered[0];
  if (mode === 'quad') {
    // 2x2 拼接（C4D 四视图布局：左上透视、右上顶、左下前、右下右）
    const cell = size;
    const sep = 2;
    const total = cell * 2 + sep;
    const composite = new Uint8Array(total * total * 4);
    // 背景
    for (let i = 0; i < composite.length; i += 4) { composite[i] = 46; composite[i + 1] = 50; composite[i + 2] = 58; composite[i + 3] = 255; }
    const place = (r, ox, oy) => {
      const rgba = r.width > cell ? downsample2(r.rgba, r.width, r.height).rgba : r.rgba;
      const s = Math.min(cell, r.width > cell ? cell : r.width);
      const w = r.width > cell ? cell : r.width;
      const h = r.height > cell ? cell : r.height;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const src = (y * w + x) * 4;
          const dst = ((oy + y) * total + ox + x) * 4;
          composite[dst] = rgba[src]; composite[dst + 1] = rgba[src + 1]; composite[dst + 2] = rgba[src + 2]; composite[dst + 3] = 255;
        }
      }
    };
    place(rendered[0], 0, 0);
    place(rendered[1], cell + sep, 0);
    place(rendered[2], 0, cell + sep);
    place(rendered[3], cell + sep, cell + sep);
    out = { name: 'quad', width: total, height: total, rgba: composite };
  } else {
    const ds = out.rgba && out.width > size ? downsample2(out.rgba, out.width, out.height) : out;
    out = ds;
  }
  return [{ name: out.name, png: encodePNG(out.rgba, out.width, out.height), width: out.width, height: out.height }];
}
