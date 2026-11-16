/**
 * dsh-c4d 配置解析 —— 空配置绝不弄崩启动。
 */

export const C4D_OUTPUT_DIR_ENV = 'DSH_C4D_OUTPUT_DIR';

/** 解析并校验插件配置（全部字段可选）。 */
export function resolveC4dConfig(config = {}) {
  const source = config !== null && typeof config === 'object' && !Array.isArray(config) ? config : {};
  const outputDir = typeof source.outputDir === 'string' && source.outputDir.trim() !== ''
    ? source.outputDir.trim()
    : undefined;
  const defaultView = typeof source.defaultView === 'string' && source.defaultView.trim() !== ''
    ? source.defaultView.trim()
    : 'quad';
  const defaultSize = Number.isFinite(Number(source.defaultSize)) ? Number(source.defaultSize) : 720;
  return {
    outputDir,
    defaultView,
    defaultSize: Math.min(2048, Math.max(240, defaultSize)),
  };
}
