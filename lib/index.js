/**
 * dsh-c4d —— C4D 同款 CAD 插件（DeepSeek Harness 插件）。
 *
 * 安装即同时注册：
 *   1. 技能 dsh-c4d（C4D 风格参数化建模完整 SOP，SKILL.md 随包分发）
 *   2. 工具 c4d_view / c4d_info / c4d_model / c4d_export / c4d_panel
 *
 * 内核分级：
 *   网格内核（零依赖，始终可用）：图元 / 剖面 / MoGraph 克隆 / 布尔 / STL / OBJ / DXF / SVG
 *   OCCT 引擎（可选 opencascade.js）：STEP / IGES 精确 BRep
 *
 * 渲染：纯 JS 软件光栅化（z-buffer + 平面着色 + 特征边 + 2x 超采样），
 * 图像走 attachments 服务 → 聊天卡片；服务缺失时降级写 PNG 文件。
 *
 * @module dsh-c4d
 */

import { resolveC4dConfig } from './config.js';
import { registerC4dSkill } from './skill.js';
import { buildC4dTools } from './tools.js';

/** cordis 服务注入：apply 里要使用 ctx.tools 与 ctx.skills。 */
export const inject = ['tools', 'skills'];
export const name = 'dsh-c4d';

export function apply(ctx, config = {}) {
  const resolved = resolveC4dConfig(config);
  const warn = (message) => { ctx.logger?.warn?.(message); };
  const disposers = [];
  // 技能注册：技能文件缺失只告警，绝不弄崩宿主启动。
  try {
    disposers.push(registerC4dSkill(ctx));
  } catch (error) {
    warn('[dsh-c4d] 技能加载失败：' + (error instanceof Error ? error.message : String(error)));
  }
  for (const definition of buildC4dTools(resolved, ctx)) {
    disposers.push(ctx.tools.register(definition));
  }
  if (typeof ctx.on === 'function') {
    ctx.on('dispose', () => {
      for (const dispose of disposers) dispose();
    });
  }
}

export { resolveC4dConfig } from './config.js';
export { registerC4dSkill, SKILL_NAMES } from './skill.js';
export { buildC4dTools, OBJECT_TYPES } from './tools.js';
