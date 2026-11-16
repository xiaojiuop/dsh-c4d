/**
 * dsh-c4d 常驻面板 —— 自包含离线 c4d-panel.html 生成器。
 *
 * 内嵌：网格数据（量化坐标）、Canvas 2D 软件光栅化轨道查看器（拖拽旋转/滚轮缩放）、
 * 四视图/单视图切换（数字键 1-5）、对象管理器列表。零外链、零依赖。
 */

import { faceNormal, bounds } from './kernel/mesh.js';

/** 量化网格为内嵌 JSON（Float32 → 3 位小数，降低体积）。 */
function packEntries(entries) {
  return entries.map((e, i) => ({
    name: e.name ?? `对象 ${i + 1}`,
    color: e.color ? e.color.map((c) => Math.round(c * 255)) : [135, 152, 173],
    verts: e.mesh.verts.map((v) => v.map((c) => Math.round(c * 1000) / 1000)),
    faces: e.mesh.faces,
  }));
}

/** 面板脚本（内嵌模板字符串；查看器与对象管理器）。 */
function panelScript() {
  return String.raw`
(function () {
  'use strict';
  var data = window.__C4D_SCENE__;
  var canvas = document.getElementById('view');
  var ctx2d = canvas.getContext('2d');
  var state = { view: 'perspective', azimuth: 45, elevation: 28, zoom: 1, drag: null, showEdges: true };
  var VIEWS = ['perspective', 'quad', 'front', 'top', 'right'];

  function bounds() {
    var min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (var e of data.entries) for (var v of e.verts) for (var k = 0; k < 3; k++) {
      if (v[k] < min[k]) min[k] = v[k];
      if (v[k] > max[k]) max[k] = v[k];
    }
    return { min: min, max: max, center: [(min[0]+max[0])/2, (min[1]+max[1])/2, (min[2]+max[2])/2],
      radius: Math.max(1, Math.hypot(max[0]-min[0], max[1]-min[1], max[2]-min[2]) / 2) };
  }
  var bb = bounds();

  function camAxes(view) {
    if (view === 'front') return { eye: [0, 0, -1], up: [0, 1, 0], ortho: true };
    if (view === 'top') return { eye: [0, 1, 0], up: [0, 0, -1], ortho: true };
    if (view === 'right') return { eye: [1, 0, 0], up: [0, 1, 0], ortho: true };
    var az = state.azimuth * Math.PI / 180, el = state.elevation * Math.PI / 180;
    return { eye: [Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)], up: [0, 1, 0], ortho: false };
  }

  function render() {
    var w = canvas.width = canvas.clientWidth * devicePixelRatio;
    var h = canvas.height = canvas.clientHeight * devicePixelRatio;
    var cells = state.view === 'quad' ? 2 : 1;
    var cw = Math.floor(w / cells), ch = Math.floor(h / cells);
    var names = state.view === 'quad' ? ['perspective', 'top', 'front', 'right'] : [state.view];
    for (var ci = 0; ci < names.length; ci++) {
      renderCell(names[ci], (ci % 2) * cw, Math.floor(ci / 2) * ch, cw, ch);
    }
  }

  function renderCell(name, ox, oy, cw, ch) {
    // 背景
    var grad = ctx2d.createLinearGradient(0, oy, 0, oy + ch);
    grad.addColorStop(0, '#e0e5ea'); grad.addColorStop(1, '#c7cdd4');
    ctx2d.fillStyle = grad;
    ctx2d.fillRect(ox, oy, cw, ch);
    var cam = camAxes(name);
    var scale = Math.min(cw, ch) / (bb.radius * 2.6) * state.zoom;
    var dist = bb.radius * 3.2;
    var cx = ox + cw / 2, cy = oy + ch / 2;

    function project(p) {
      var d = [p[0] - bb.center[0], p[1] - bb.center[1], p[2] - bb.center[2]];
      var z = dot(cam.eye, d) + dist;
      var right = normalize(cross(cam.up, cam.eye));
      var up2 = cross(cam.eye, right);
      var x = dot(right, d), y = dot(up2, d);
      var f = cam.ortho ? scale : scale * dist / Math.max(z, 1e-6);
      return { x: cx + x * f, y: cy - y * f, z: z };
    }

    // 面片（画家算法：按深度排序）
    var polys = [];
    for (var e of data.entries) {
      for (var f of e.faces) {
        var a = e.verts[f[0]], b = e.verts[f[1]], c = e.verts[f[2]];
        var pa = project(a), pb = project(b), pc = project(c);
        var n = faceNormal(a, b, c);
        if (dot(n, cam.eye) <= 0) continue; // 背面剔除
        polys.push({ e: e, pa: pa, pb: pb, pc: pc, depth: (pa.z + pb.z + pc.z) / 3, n: n });
      }
    }
    polys.sort(function (p, q) { return q.depth - p.depth; });
    var key = normalize([0.45, 0.8, 0.35]);
    for (var p of polys) {
      var kd = Math.max(0, dot(p.n, key));
      var k = 0.38 + kd * 0.55;
      var col = p.e.color;
      ctx2d.fillStyle = 'rgb(' + Math.min(255, col[0] * k | 0) + ',' + Math.min(255, col[1] * k | 0) + ',' + Math.min(255, col[2] * k | 0) + ')';
      ctx2d.beginPath();
      ctx2d.moveTo(ox + p.pa.x, oy + p.pa.y);
      ctx2d.lineTo(ox + p.pb.x, oy + p.pb.y);
      ctx2d.lineTo(ox + p.pc.x, oy + p.pc.y);
      ctx2d.closePath();
      ctx2d.fill();
      if (state.showEdges) {
        ctx2d.strokeStyle = 'rgba(40,46,58,0.35)';
        ctx2d.lineWidth = 0.5;
        ctx2d.stroke();
      }
    }
    // 视图标签
    ctx2d.fillStyle = 'rgba(30,36,48,0.6)';
    ctx2d.font = (12 * devicePixelRatio) + 'px system-ui';
    ctx2d.fillText({ perspective: '透视', quad: '四视图', front: '前视图', top: '顶视图', right: '右视图' }[name] || name, ox + 8, oy + 18);
  }

  function faceNormal(a, b, c) {
    var ux = b[0]-a[0], uy = b[1]-a[1], uz = b[2]-a[2];
    var vx = c[0]-a[0], vy = c[1]-a[1], vz = c[2]-a[2];
    var n = [uy*vz-uz*vy, uz*vx-ux*vz, ux*vy-uy*vx];
    return normalize(n);
  }
  function dot(a, b) { return a[0]*b[0] + a[1]*b[1] + a[2]*b[2]; }
  function cross(a, b) { return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]; }
  function normalize(v) { var l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0]/l, v[1]/l, v[2]/l]; }

  // 交互：拖拽旋转 / 滚轮缩放 / 数字键切换
  canvas.addEventListener('mousedown', function (e) { state.drag = { x: e.clientX, y: e.clientY, az: state.azimuth, el: state.elevation }; });
  window.addEventListener('mousemove', function (e) {
    if (!state.drag) return;
    state.azimuth = state.drag.az + (e.clientX - state.drag.x) * 0.5;
    state.elevation = Math.max(-89, Math.min(89, state.drag.el + (e.clientY - state.drag.y) * 0.5));
    render();
  });
  window.addEventListener('mouseup', function () { state.drag = null; });
  canvas.addEventListener('wheel', function (e) {
    e.preventDefault();
    state.zoom = Math.max(0.2, Math.min(5, state.zoom * (e.deltaY < 0 ? 1.1 : 0.9)));
    render();
  }, { passive: false });
  window.addEventListener('keydown', function (e) {
    var i = parseInt(e.key, 10);
    if (i >= 1 && i <= 5) { state.view = VIEWS[i - 1]; syncViewButtons(); render(); }
  });

  // 对象管理器
  var list = document.getElementById('objects');
  data.entries.forEach(function (e, i) {
    var row = document.createElement('div');
    row.className = 'obj';
    row.innerHTML = '<span class="sw" style="background:rgb(' + e.color.join(',') + ')"></span>'
      + '<span class="nm">' + escapeHtml(e.name) + '</span>'
      + '<span class="ct">' + e.faces.length + ' 面</span>';
    list.appendChild(row);
  });
  function escapeHtml(s) { return s.replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  // 视图按钮
  var btns = document.querySelectorAll('[data-view]');
  btns.forEach(function (b) {
    b.addEventListener('click', function () { state.view = b.dataset.view; syncViewButtons(); render(); });
  });
  function syncViewButtons() {
    btns.forEach(function (b) { b.classList.toggle('active', b.dataset.view === state.view); });
  }
  syncViewButtons();
  render();
  window.addEventListener('resize', render);
})();
`;
}

/** 生成面板 HTML。 */
export function buildPanelHtml(entries, { title = 'dsh-c4d 常驻面板' } = {}) {
  const packed = packEntries(entries);
  const scene = JSON.stringify({ entries: packed });
  const script = panelScript();
  const faces = packed.reduce((n, e) => n + e.faces.length, 0);
  const verts = packed.reduce((n, e) => n + e.verts.length, 0);
  return `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  * { box-sizing: border-box; margin: 0; }
  body { font: 14px/1.6 system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif; display: flex; height: 100vh; color: #1c2430; background: #f2f4f7; }
  aside { width: 280px; flex-shrink: 0; background: #ffffff; border-right: 1px solid #e2e5ec; display: flex; flex-direction: column; }
  aside h1 { font-size: 15px; padding: 14px 16px 6px; }
  aside .sub { padding: 0 16px 10px; color: #667085; font-size: 12px; border-bottom: 1px solid #e2e5ec; }
  aside h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .08em; color: #667085; padding: 12px 16px 6px; }
  #objects { overflow: auto; padding: 0 8px 12px; flex: 1; }
  .obj { display: flex; align-items: center; gap: 8px; padding: 7px 10px; border-radius: 8px; }
  .obj:hover { background: #f2f5fa; }
  .obj .sw { width: 12px; height: 12px; border-radius: 3px; flex-shrink: 0; }
  .obj .nm { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .obj .ct { color: #98a2b3; font-size: 12px; }
  main { flex: 1; display: flex; flex-direction: column; min-width: 0; }
  nav { display: flex; gap: 6px; padding: 10px 14px; background: #ffffff; border-bottom: 1px solid #e2e5ec; }
  nav button { font: inherit; font-size: 13px; padding: 6px 14px; border: 1px solid #d6dae2; background: #fff; border-radius: 8px; cursor: pointer; }
  nav button.active { background: #4f6bdb; border-color: #4f6bdb; color: #fff; }
  nav .hint { margin-left: auto; color: #98a2b3; font-size: 12px; align-self: center; }
  #view { flex: 1; cursor: grab; }
  #view:active { cursor: grabbing; }
</style>
</head>
<body>
<aside>
  <h1>dsh-c4d 常驻面板</h1>
  <div class="sub">${packed.length} 个对象 · ${faces} 面 · ${verts} 顶点 · 离线自包含</div>
  <h2>对象管理器</h2>
  <div id="objects"></div>
</aside>
<main>
  <nav>
    <button data-view="perspective">透视</button>
    <button data-view="quad">四视图</button>
    <button data-view="front">前</button>
    <button data-view="top">顶</button>
    <button data-view="right">右</button>
    <span class="hint">拖拽旋转 · 滚轮缩放 · 数字键 1-5 切换视图</span>
  </nav>
  <canvas id="view"></canvas>
</main>
<script>window.__C4D_SCENE__ = ${scene};</script>
<script>${script}</script>
</body>
</html>
`;
}
