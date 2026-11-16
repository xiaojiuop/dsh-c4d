# 更新日志

本文件记录 dsh-c4d 的所有重要变更。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [1.0.0] - 2026-11-16

首个正式发布版本。

### 新增

- **工具 5 件**
  - `c4d_view`：渲染预览图（透视 / 四视图 / 单视图），图像走附件服务进聊天卡片，服务缺失时降级为 PNG 文件
  - `c4d_info`：检查场景对象列表、顶点/面数、包围盒、尺寸与引擎能力
  - `c4d_model`：参数化建模主入口，编译场景 JSON → 常驻 `.c4d/c4d-scene.json`，可选导出与渲染
  - `c4d_export`：导出 STL（二进制/ASCII）、OBJ、DXF（R12 线框）、SVG（三视图线框）
  - `c4d_panel`：生成自包含离线 `c4d-panel.html` 交互面板
- **技能 1 份** `dsh-c4d`：含场景 JSON 语法、建模要领、渲染参数、导出与疑难排查
- **网格内核（零依赖）**：14 种图元（box/sphere/cylinder/cone/torus/capsule/tube/plane/pyramid/knot/tetra/octa/icosa/dodeca）、剖面操作（挤出/旋转/扫描/放样）、MoGraph 克隆（线性/径向/网格）、布尔运算（BSP CSG 的 union/difference/intersection）、镜像
- **软件渲染器（零依赖）**：z-buffer 光栅化、平面着色（主光+补光+环境）、特征边线框、地面网格、2x 超采样、C4D 四视图布局
- **几何导出器（零依赖）**：PNG 编码器、STL/OBJ/DXF/SVG 写出、STL/OBJ 导入

### 变更

- 描述层全面校准：明确"独立实现、不连接 Cinema 4D、不读写 .c4d 工程文件"的能力边界
- `c4d_info` 的引擎信息如实反映 STEP/IGES 未接入，不再暗示"装了 opencascade.js 即可用"
- 移除 `optionalDependencies: opencascade.js`（避免安装时拉取约 60 MB 依赖）；改在 `peerDependenciesMeta` 中标记为可选，仅为未来接入预留
- README 安装命令修正为 `dsh plugin --profile desktop add <路径>`（`install` 不是 `dsh plugin` 的子命令）
- 中文 README 全量中文化（原混用英文小标题）

### 已知限制

- STEP / IGES 导入导出**未接入**：调用会返回明确提示并建议改用 STL（二进制）。即使安装了 `opencascade.js` 也无法使用。
- 布尔运算要求两实体为流形且体积有实际重叠；嵌套（一实体完全在另一实体内）的求交走包围盒 + 射线法回退。
- 渲染为软件光栅化，不支持材质贴图、法线贴图、景深、全局光照。
- 不做动力学、粒子、MoGraph 效果器（仅克隆）。
