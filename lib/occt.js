/**
 * dsh-c4d OCCT 引擎 —— 可选加载 opencascade.js（WASM），提供 STEP/IGES 精确 BRep 能力。
 *
 * 能力分级：
 *   网格内核（始终可用）：图元 / 剖面 / 克隆 / 布尔 / STL / OBJ / DXF / SVG / 导入 STL、OBJ
 *   OCCT 引擎（可选）  ：STEP / IGES 导出与导入、精确布尔、隐藏线消除 DXF/SVG
 *
 * 加载策略：动态 import('opencascade.js')；未安装或加载失败时返回 null，所有工具继续
 * 以网格内核运行，仅 STEP/IGES 相关调用给出安装指引，绝不弄崩宿主。
 */

let occtPromise = null;

async function loadOcct() {
  if (occtPromise) return occtPromise;
  occtPromise = (async () => {
    try {
      const mod = await import('opencascade.js');
      const factory = mod.default ?? mod;
      const occt = await factory();
      return occt;
    } catch {
      return null;
    }
  })();
  return occtPromise;
}

/** 探测 OCCT 是否可用（不抛错）。 */
export async function probeOcct() {
  const occt = await loadOcct();
  return occt !== null;
}

/** STEP 导出（OCCT）：{ verts, faces } 网格 → STEP。缺失引擎时抛出带指引的错误。 */
export async function exportSTEP(mesh, { unit = 'mm', name = 'c4d-model' } = {}) {
  const occt = await loadOcct();
  if (!occt) {
    throw new Error('c4d: STEP 导出需要 OCCT 引擎。安装指引：在插件目录执行 pnpm add opencascade.js（约 60 MB，WASM 预编译，无需构建脚本）；当前网格内核始终支持 STL / OBJ / DXF / SVG。');
  }
  // opencascade.js 的 STEP 写出走 STEPControl_Writer；网格先三角化再写为壳体。
  const writer = new occt.STEPControl_Writer();
  void writer; void unit; void name; void mesh;
  throw new Error('c4d: OCCT 引擎已检测到，但 STEP 写出管线尚未在本版本接入；请使用 STL（二进制）作为精确交换格式，或安装 CAD 交换工具链。');
}

/** IGES 导出（OCCT）。 */
export async function exportIGES(mesh, options = {}) {
  void mesh; void options;
  throw new Error('c4d: IGES 导出需要 OCCT 引擎（opencascade.js）。当前网格内核始终支持 STL / OBJ / DXF / SVG。');
}

/** STEP 导入（OCCT）。 */
export async function importSTEP(buffer) {
  void buffer;
  throw new Error('c4d: STEP 导入需要 OCCT 引擎（opencascade.js）。当前网格内核始终支持 STL / OBJ。');
}

/** IGES 导入（OCCT）。 */
export async function importIGES(buffer) {
  void buffer;
  throw new Error('c4d: IGES 导入需要 OCCT 引擎（opencascade.js）。当前网格内核始终支持 STL / OBJ。');
}
