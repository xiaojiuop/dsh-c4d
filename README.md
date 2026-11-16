# dsh-c4d

**C4D-style parametric 3D modeling plugin** for DeepSeek Harness — Object-Manager JSON scenes, 14 primitives, extrude/lathe/sweep/loft, MoGraph clones, booleans, quad-view rendering, STL/OBJ/DXF/SVG export, and a persistent offline CAD panel.

English | [中文](README.zh.md)

## Scope (read first)

This plugin is a **standalone implementation**. It borrows Cinema 4D's concepts, but:

| Does | Does not |
| --- | --- |
| Model from scratch with object manager / primitives / extrude / MoGraph clones / booleans | ❌ Connect to or drive the Cinema 4D application (no C4D Python bridge) |
| Render previews with a built-in rasterizer (perspective / quad view) | ❌ Read or write `.c4d` project files |
| Export STL / OBJ / DXF / SVG | ❌ Export STEP / IGES (not implemented yet) |
| Generate an offline interactive HTML panel | ❌ Materials, lighting, dynamics, GI rendering |

To keep working in Cinema 4D: export STL/OBJ here, then import in C4D.

## Features

- **Five tools**: `c4d_view` (shaded previews → chat image cards), `c4d_info` (objects/vertices/faces/bounds/engine), `c4d_model` (parametric modeling entry), `c4d_export` (STL/OBJ/DXF/SVG), `c4d_panel` (persistent offline panel)
- **One skill**: `dsh-c4d` (modeling SOP bundled, with scene-JSON syntax and modeling guidelines)
- **Mesh kernel (zero dependencies, always available)**: 14 primitives + extrude/lathe/sweep/loft + MoGraph clones (linear/radial/grid) + booleans (BSP CSG) + mirror
- **Renderer (zero dependencies)**: pure-JS software rasterizer — z-buffer, flat shading, feature edges, ground grid, 2x supersampling, C4D quad view
- **Persistent panel**: self-contained offline `c4d-panel.html` — orbit viewer (drag/scroll/keys 1-5) + object manager

## Install

Desktop profile is `desktop`:

```powershell
# Local directory (dev): installed as a symlink, source edits take effect
dsh plugin --profile desktop add "D:\AI\操作区\dsh-c4d"

# Or install as a bundle from the Web Plugins page / the plugin_manager tool
```

For local debugging you may also append to `~/.dsh/profiles/desktop/cordis.patch.yml`:

```yaml
- insert:
    - id: dsh-c4d
      name: dsh-c4d
      config: {}
```

> Note: `dsh plugin` forwards arguments to pnpm verbatim; `install` is not a subcommand.

## Quick start

- "Build a MoGraph-style radial clone scene with c4d" → `c4d_model` + quad view
- "Export this scene to STL for 3D printing" → `c4d_export`
- "Give me a panel I can orbit around" → `c4d_panel`

## Smoke test

```powershell
node skills/dsh-c4d/scripts/demo.mjs --out .c4d-demo   # demo scene → render + export + panel
node --test "test/*.test.mjs"                          # unit tests
node scripts/publish-check.mjs                         # pre-publish self-check (12 items)
```

## Publishing

> ⚠️ **npm returns `404 Not Found` for unauthenticated publishes, not 401.** The error makes it look like the package name is taken — it only means you are not logged in.

```powershell
# 1. Self-check
node scripts/publish-check.mjs

# 2. Configure npm auth (one time)
#    a) Sign up at https://www.npmjs.com (username must be ASCII)
#    b) https://www.npmjs.com/settings/<user>/tokens → Generate New Token
#       → Granular Access Token with Read and write
#    c) Write to %USERPROFILE%\.npmrc:
#       //registry.npmjs.org/:_authToken=npm_your_token

# 3. Precheck only (validates token, checks name availability)
node scripts/publish.mjs --check

# 4. Publish
node scripts/publish.mjs

# 5. Users install
dsh plugin --profile desktop add dsh-c4d
```

**Alternative without an npm account**: push to GitHub, then users can install directly:

```powershell
dsh plugin --profile desktop add github:<user>/dsh-c4d
```

Marketplace metadata lives in the `dshMarket` field of `package.json`.

## Engine capabilities

| Capability | Mesh kernel (default, always available) | OCCT / STEP-IGES |
| --- | --- | --- |
| Primitives / profiles / clones / booleans | ✅ | — |
| STL / OBJ / DXF / SVG | ✅ | — |
| STEP / IGES | ⚠️ Not implemented: returns a clear message pointing to STL | ⚠️ Planned (`opencascade.js`), currently unavailable |

## License

MIT
