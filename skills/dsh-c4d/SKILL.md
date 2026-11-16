---
name: dsh-c4d
description: "C4D 风格参数化三维建模（独立实现，无需安装 Cinema 4D）：对象管理器 JSON 场景、14 种图元、挤出/旋转/扫描/放样、MoGraph 克隆、布尔运算、四视图渲染、STL/OBJ/DXF/SVG 导出与常驻离线 CAD 面板。用户想做三维模型、参数化建模、C4D/建模/MoGraph 风格效果、布尔运算、导出 STL 做 3D 打印、看三维预览或需要可拖拽旋转的模型面板时使用。不驱动 Cinema 4D 主程序，不读写 .c4d 工程文件。"
---

# dsh-c4d —— C4D 风格参数化 CAD

你拥有一套 **C4D 风格的参数化建模工具链**：对象管理器 JSON 场景 → 内置网格内核编译 →
四视图渲染（聊天图像卡片）→ STL/OBJ/DXF/SVG 导出 → 常驻 CAD 面板（自包含 HTML）。

## 能力边界（先读，避免答错）

| 能做 | 不做 |
| --- | --- |
| 用 C4D 的概念（对象管理器、图元、挤出、MoGraph 克隆、布尔）**独立建模** | ❌ 不连接、不驱动 Cinema 4D 主程序（没有 C4D Python 桥、不调用 `c4d` 模块） |
| 渲染预览图（内置纯 JS 光栅化器） | ❌ 不读写 `.c4d` 工程文件（`.c4d/` 目录里是本插件的场景 JSON 与产物，不是 C4D 工程） |
| 导出 STL / OBJ / DXF / SVG | ❌ 不导出 STEP / IGES（管线尚未接入，调用会给明确提示） |
| 生成离线交互面板（HTML） | ❌ 不做材质、灯光、动力学、渲染器 GI 等 C4D 高级模块 |

**一句话**：这是"C4D 操作手感的三维建模工具"，不是"C4D 遥控器"。用户问"能不能直接改我的 .c4d 文件"时，明确说明不能，并给出替代路径（导出 STL/OBJ 再导入 C4D）。


## 工具一览

| 工具 | 用途 | 对应 |
| --- | --- | --- |
| `c4d_view` | 渲染预览图（透视 / 四视图），图像进聊天卡片 | ≈ cad_view |
| `c4d_info` | 检查模型/场景信息（对象/顶点/面/包围盒/引擎能力） | ≈ cad_info |
| `c4d_model` | 构建参数化场景 → 常驻 .c4d/c4d-scene.json，可选导出+渲染 | 参数化建模主入口 |
| `c4d_export` | 导出 stl/obj/dxf/svg（step/iges 需要 OCCT 引擎） | 文件交付 |
| `c4d_panel` | 生成常驻 CAD 面板 c4d-panel.html（浏览器打开） | 常驻面板 |

## 标准流程

1. **组织对象**：把用户需求拆成对象列表（图元/剖面/布尔/克隆），先想清楚再调用。
2. **构建**：`c4d_model` 传 scene JSON。产物写入 `.c4d/c4d-scene.json`（常驻场景）。
3. **查看**：`c4d_view`（或 c4d_model 自带渲染）出图后必须亲自查看图像，确认形状、比例、构图。
4. **迭代**：改 scene JSON 重新构建，直到构图满意。
5. **交付**：`c4d_export` 导出用户要的格式；`c4d_panel` 生成常驻面板供用户交互查看。

## 场景 JSON（对象管理器）

```json
{
  "objects": [
    { "type": "cylinder", "name": "底座", "params": { "r": 320, "h": 40, "seg": 48 },
      "position": [0, -260, 0], "color": "#8f9db3" },
    { "type": "clone", "name": "径向克隆", "mode": "radial", "count": 8, "radius": 240, "axis": "y",
      "child": { "type": "torus", "params": { "R": 80, "r": 28 } } },
    { "type": "boolean", "name": "开槽", "op": "difference",
      "a": { "type": "sphere", "params": { "r": 110 } },
      "b": { "type": "box", "params": { "w": 60, "h": 320, "d": 60 } } },
    { "type": "extrude", "params": { "profile": "star", "depth": 120 }, "position": [0, 320, 0] }
  ]
}
```

### 对象类型（type）

- **图元**：`box`(w,h,d) `sphere`(r,seg,rings) `cylinder`(r,h,seg) `cone`(r,h,seg)
  `torus`(R,r,seg,side) `capsule`(r,h) `tube`(r1,r2,h) `plane`(w,d,seg) `pyramid`(w,h)
  `knot`(p,q,R,r) `tetra` `octa` `icosa` `dodeca`(r)
- **剖面**（2D 截面 → 3D）：`extrude`(profile,depth) `lathe`(profile,angle,seg)
  `sweep`(profile,path) `loft`(profiles,height)
  - profile：点数组 `[[x,y],...]` 或 `"circle"` / `"square"` / `"star"`
- **运算**：`boolean`(op=union|difference|intersection, a, b) `mirror`(axis, child)
- **克隆（MoGraph）**：`clone`(mode=linear|radial|grid, child, …)
  - linear：count + step [x,y,z]
  - radial：count + radius + axis(x|y|z) + startAngle
  - grid：count [nx,ny,nz] + step [x,y,z]

### 公共字段

- `position` [x,y,z]（无单位，内部按包围盒取景；建议全场景量级一致）
- `rotation` [x,y,z]（度，XYZ 欧拉）
- `scale` [x,y,z]
- `color` "#RRGGBB"（缺省按索引自动分配 C4D 风格蓝灰色系）
- `name` 对象名（面板/统计里显示）

## 渲染

- `mode`：`perspective`（单透视）/ `quad`（四视图拼合，默认）/ `views`（四张分图）/ `front` / `top` / `right`
- `size`：边长像素（默认 720；quad 输出约 2×size）
- `edges`：特征边线框（默认 true）；`edgeAngle` 阈值（默认 30°）
- 图像优先走聊天卡片；附件服务缺失时降级为 PNG 文件（`.c4d/` 下），此时用 `present` 展示给用户。

## 建模要领

- **构图**：物体尽量放在原点附近；position 用整数便于心算。
- **比例**：同一场景对象量级一致（如全部 100–500），渲染器按包围盒自动取景。
- **布尔**：两个实体必须有实际重叠，否则 difference 无效果；布尔输出已自动紧缩。
- **克隆**：radial 克隆的 child 是单个对象（不写 position，克隆器负责摆放）。
- **星形/凹多边形**：extrude/lathe 的 earClip 三角化支持凹截面。
- **查错**：先 `c4d_info` 看面数与包围盒；面数异常小通常是对象没建出来。

## 导出

- `stl`：默认二进制（`ascii: true` 转 ASCII）；3D 打印首选。
- `obj`：带组名的通用交换格式。
- `dxf`：R12 线框（特征边 + 开口边），CAD 图纸交流。
- `svg`：三视图线框（前/顶/右），可直接嵌入文档。
- `unit`：mm（默认）/ cm / m / inch。
- `step`/`iges`：**当前版本尚未接入**。调用会返回明确错误并建议改用 STL（二进制）；即使装了 `opencascade.js` 也无法导出。给用户答复时如实说明，不要承诺"装个引擎就能用"。

## 常驻面板

`c4d_panel` 生成自包含离线 `c4d-panel.html`：
交互轨道查看器（拖拽旋转/滚轮缩放/数字键 1-5 切换透视与四视图）+ 对象管理器列表。
浏览器直接打开即可，常驻工作区 `.c4d/`；给用户交付时告诉他们双击打开。

## 疑难

- **图像没进聊天**：附件服务缺失（降级为文件）——告诉用户 PNG 路径并 `present`。
- **STEP/IGES 导出报错**：这是预期行为，当前版本未接入该管线（不是缺引擎）。改用 STL 交付，并如实告知用户。
- **用户要求改真实 .c4d 工程**：本插件做不到。建议导出 STL/OBJ 后在 Cinema 4D 里导入，或说明本插件只能新建模型。
- **渲染太暗/太亮**：材质色用中明度（#8798ad 一类）；避免纯黑纯白。
- **布尔结果破碎**：确保两实体为流形（本内核图元与剖面均为流形）且重叠体积足够。
