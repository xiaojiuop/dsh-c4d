# dsh-c4d

**C4D 风格的参数化三维建模插件**（DeepSeek Harness 插件）——对象管理器 JSON 场景、14 种图元、挤出/旋转/扫描/放样、MoGraph 克隆、布尔运算、四视图渲染、STL/OBJ/DXF/SVG 导出与常驻离线 CAD 面板。

[English](README.md) | 中文

## 能力边界（先看这个）

这是**独立实现**的建模插件，用 C4D 的操作概念做三维模型，但：

| 能做 | 不做 |
| --- | --- |
| 用对象管理器 / 图元 / 挤出 / MoGraph 克隆 / 布尔**从零建模** | ❌ 不连接、不驱动 Cinema 4D 主程序（无 C4D Python 桥） |
| 内置渲染器出预览图（透视 / 四视图） | ❌ 不读写 `.c4d` 工程文件 |
| 导出 STL / OBJ / DXF / SVG | ❌ 不导出 STEP / IGES（当前版本未接入） |
| 生成离线可交互 HTML 面板 | ❌ 不做材质、灯光、动力学、GI 渲染 |

需要进 Cinema 4D 继续加工时：本插件导出 STL/OBJ → 在 C4D 里导入。

## 功能

- **工具 5 件**：`c4d_view`（渲染预览 → 聊天图像卡片）、`c4d_info`（对象/顶点/面/包围盒/引擎能力）、`c4d_model`（参数化建模主入口）、`c4d_export`（STL/OBJ/DXF/SVG）、`c4d_panel`（常驻离线面板）
- **技能 1 份**：`dsh-c4d`（建模 SOP，随包分发，含场景 JSON 语法与建模要领）
- **网格内核（零依赖，始终可用）**：14 种图元 + 挤出/旋转/扫描/放样 + MoGraph 克隆（线性/径向/网格）+ 布尔（BSP CSG）+ 镜像
- **渲染器（零依赖）**：纯 JS 软件光栅化——z-buffer、平面着色、特征边、地面网格、2x 超采样、C4D 四视图（透视 + 前/顶/右）
- **常驻面板**：自包含离线 `c4d-panel.html`——交互轨道查看器（拖拽旋转/滚轮缩放/数字键 1-5 切换视图）+ 对象管理器列表

## 安装

桌面版 profile 固定为 `desktop`：

```powershell
# 本地目录安装（开发期，装成 symlink，改源码即生效）
dsh plugin --profile desktop add "D:\AI\操作区\dsh-c4d"

# 或在 Web 侧栏「插件」页 / 用 plugin_manager 工具按 bundle 安装
```

本地调试也可在 `~/.dsh/profiles/desktop/cordis.patch.yml` 末尾追加：

```yaml
- insert:
    - id: dsh-c4d
      name: dsh-c4d
      config: {}
```

> 注意：`dsh plugin` 把参数原样转发给 pnpm，`install` 不是它的子命令。

## 快速上手

对话里直接说：

- 「用 c4d 建一个 MoGraph 风格的环形阵列场景看看」→ `c4d_model` + 四视图渲染
- 「把这个场景导出 STL 拿去 3D 打印」→ `c4d_export`
- 「给我一个能拖拽旋转的面板」→ `c4d_panel`

## 自测

```powershell
node skills/dsh-c4d/scripts/demo.mjs --out .c4d-demo   # 演示场景 → 渲染 + 导出 + 面板
node --test "test/*.test.mjs"                          # 单元测试
node scripts/publish-check.mjs                         # 发布前自检（12 项）
```

## 发布

> ⚠️ **npm 对匿名发布返回 `404 Not Found`，不是 401。** 未登录时看到的错误会让你以为"包名不存在"，其实只是没认证。

```powershell
# 1. 自检
node scripts/publish-check.mjs

# 2. 配置 npm 认证（一次性）
#    a) 注册 https://www.npmjs.com（用户名必须是 ASCII，不能是中文）
#    b) https://www.npmjs.com/settings/<用户名>/tokens → Generate New Token
#       → Granular Access Token，Permissions 选 Read and write
#    c) 写入 %USERPROFILE%\.npmrc：
#       //registry.npmjs.org/:_authToken=npm_你的token

# 3. 预检（验证 token 有效、包名可用），不发布
node scripts/publish.mjs --check

# 4. 正式发布
node scripts/publish.mjs

# 5. 用户安装
dsh plugin --profile desktop add dsh-c4d
```

`scripts/publish.mjs` 会先做 whoami 验证再发布，不会再让你撞 404 陷阱。

**替代路径（无需 npm 账号）**：把工程推到 GitHub，用户可直接从仓库安装：

```powershell
dsh plugin --profile desktop add github:<用户名>/dsh-c4d
```

市场条目所需元数据已写在 `package.json` 的 `dshMarket` 字段（分类、中文功能要点、能力边界）。

## 引擎能力

| 能力 | 网格内核（默认，始终可用） | OCCT / STEP-IGES |
| --- | --- | --- |
| 图元 / 剖面 / 克隆 / 布尔 | ✅ | — |
| STL / OBJ / DXF / SVG | ✅ | — |
| STEP / IGES | ⚠️ 未接入：调用返回明确提示，建议改用 STL | ⚠️ 规划中（`opencascade.js`），当前不可用 |

## 许可证

MIT
