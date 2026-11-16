/**
 * 发布前自检 —— 一条命令确认包处于"可上线"状态。
 *
 * 用法：
 *   node scripts/publish-check.mjs            # 全量检查（含测试）
 *   node scripts/publish-check.mjs --no-test  # 跳过测试
 *
 * 退出码 0 = 可以发布；1 = 有阻塞项（❌）；警告（⚠️）不阻塞但上线前应处理。
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const skipTests = process.argv.includes('--no-test');

const blockers = [];
const warnings = [];
const passes = [];

const ok = (m) => passes.push(`  ✔ ${m}`);
const warn = (m) => warnings.push(`  ⚠️  ${m}`);
const fail = (m) => blockers.push(`  ❌ ${m}`);

const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));

// ── 1. 必填字段 ────────────────────────────────────────────────────────────
for (const key of ['name', 'version', 'description', 'type', 'main', 'exports', 'license', 'engines', 'files', 'keywords']) {
  if (pkg[key] === undefined) fail(`package.json 缺字段 ${key}`);
}
if (pkg.type !== 'module') fail('package.json 的 type 必须是 "module"');
else ok('ESM 模块声明正确（type: module）');

if (!/^\d+\.\d+\.\d+/.test(pkg.version ?? '')) fail(`版本号不是语义化版本：${pkg.version}`);
else ok(`版本号 ${pkg.version}`);

// ── 2. 占位符必须替换 ──────────────────────────────────────────────────────
const raw = JSON.stringify(pkg);
const placeholders = [...raw.matchAll(/REPLACE_WITH_[A-Z_]+/g)].map((m) => m[0]);
if (placeholders.length > 0) {
  warn(`仍有未替换的占位符：${[...new Set(placeholders)].join(', ')}`);
  warn('  → 发布前替换 author / repository / homepage / bugs 中的占位符，否则市场页与源码链接会失效');
} else {
  ok(`无占位符残留（author: ${pkg.author ?? '未声明'}）`);
}
// repository 是可选字段：缺失不阻塞发布，只是 npm 页不会有源码链接
if (!pkg.repository) {
  warn('未声明 repository —— npm 页面不会有源码仓库链接（可选，不阻塞发布）');
} else {
  ok(`repository → ${pkg.repository.url ?? pkg.repository}`);
}

// ── 3. 入口与补丁指向真实文件 ──────────────────────────────────────────────
if (!existsSync(join(root, pkg.main))) fail(`main 指向的文件不存在：${pkg.main}`);
else ok(`main → ${pkg.main}`);

for (const [alias, target] of Object.entries(pkg.exports ?? {})) {
  const path = typeof target === 'string' ? target : target?.default;
  if (path?.endsWith('/') || path?.includes('*')) continue; // 通配导出跳过
  if (path && !existsSync(join(root, path))) fail(`exports["${alias}"] 指向不存在的文件：${path}`);
}
ok('exports 全部指向真实文件');

const patch = pkg.dsh?.bundle?.patch;
if (!patch) fail('缺 dsh.bundle.patch —— DSH 不会把它当 bundle 安装');
else if (!existsSync(join(root, patch))) fail(`dsh.bundle.patch 指向的文件不存在：${patch}`);
else ok(`dsh.bundle.patch → ${patch}`);

// ── 4. files 白名单覆盖运行时产物 ──────────────────────────────────────────
const published = new Set(pkg.files ?? []);
for (const required of ['lib', 'skills', 'cordis.patch.yml']) {
  if (![...published].some((p) => p === required || p.startsWith(`${required}/`))) {
    fail(`files 未包含运行时必需的 ${required} —— 装到用户机器上会缺文件`);
  }
}
// 不该发布的东西
for (const bad of ['test', '.c4d-demo', '.smoke-c4d', 'node_modules']) {
  if ([...published].some((p) => p === bad || p.startsWith(`${bad}/`))) {
    fail(`files 包含不该发布的 ${bad}`);
  }
}
ok('files 白名单不含 test / 演示产物');

for (const entry of published) {
  if (!existsSync(join(root, entry))) warn(`files 里的 ${entry} 在磁盘上不存在（打包时会被忽略）`);
}

// ── 5. 技能 frontmatter ────────────────────────────────────────────────────
try {
  const skillDirs = (await readdir(join(root, 'skills'))).filter((d) => !d.startsWith('.'));
  if (skillDirs.length === 0) fail('skills/ 下没有任何技能目录');
  for (const dir of skillDirs) {
    const file = join(root, 'skills', dir, 'SKILL.md');
    if (!existsSync(file)) { fail(`skills/${dir} 缺 SKILL.md`); continue; }
    const text = await readFile(file, 'utf8');
    const fm = /^---[ \t]*\n([\s\S]*?)\n---/.exec(text);
    if (!fm) { fail(`skills/${dir}/SKILL.md 缺 frontmatter`); continue; }
    if (!/^name:\s*\S+/m.test(fm[1])) fail(`skills/${dir}/SKILL.md frontmatter 缺 name`);
    if (!/^description:\s*\S+/m.test(fm[1])) fail(`skills/${dir}/SKILL.md frontmatter 缺 description`);
    else if (fm[1].match(/description:\s*"(.+)"/)?.[1]?.length < 40) {
      warn(`skills/${dir} 的 description 偏短，模型可能无法正确判断何时加载该技能`);
    }
  }
  ok(`技能 ${skillDirs.length} 个，frontmatter 完整`);
} catch (error) {
  fail(`skills/ 检查失败：${error.message}`);
}

// ── 6. CHANGELOG 版本一致 ──────────────────────────────────────────────────
const changelog = join(root, 'CHANGELOG.md');
if (!existsSync(changelog)) fail('缺 CHANGELOG.md');
else {
  const text = await readFile(changelog, 'utf8');
  if (!text.includes(`## [${pkg.version}]`)) fail(`CHANGELOG.md 里没有 ${pkg.version} 的条目`);
  else ok(`CHANGELOG.md 含 ${pkg.version} 条目`);
}

// ── 7. 体积与文件数 ────────────────────────────────────────────────────────
let bytes = 0;
let files = 0;
async function walk(dir) {
  for (const name of await readdir(dir, { withFileTypes: true })) {
    if (name.name === 'node_modules' || name.name.startsWith('.')) continue;
    const full = join(dir, name.name);
    if (name.isDirectory()) await walk(full);
    else {
      const s = await stat(full);
      bytes += s.size;
      files++;
    }
  }
}
await walk(root);
const mb = bytes / 1024 / 1024;
if (mb > 20) warn(`包体约 ${mb.toFixed(1)} MB，偏大（市场加载会慢）`);
else ok(`包体约 ${mb.toFixed(1)} MB / ${files} 个文件`);

// ── 8. 测试 ────────────────────────────────────────────────────────────────
if (skipTests) {
  warn('已跳过测试（--no-test）');
} else {
  try {
    const testDir = join(root, 'test');
    const specs = existsSync(testDir)
      ? (await readdir(testDir)).filter((f) => f.endsWith('.test.mjs')).map((f) => join('test', f))
      : [];
    if (specs.length === 0) fail('test/ 下没有 .test.mjs 测试文件');
    else {
      await run(process.execPath, ['--test', ...specs], { cwd: root, timeout: 180_000 });
      ok(`单元测试全部通过（${specs.length} 个测试文件）`);
    }
  } catch (error) {
    fail(`单元测试失败：${(error.stdout ?? error.message).toString().split('\n').slice(-6).join(' ')}`);
  }
}

// ── 输出 ───────────────────────────────────────────────────────────────────
console.log('\n=== dsh-c4d 发布自检 ===\n');
if (passes.length) console.log(passes.join('\n'));
if (warnings.length) console.log('\n警告（不阻塞）：\n' + warnings.join('\n'));
if (blockers.length) console.log('\n阻塞项（必须修复）：\n' + blockers.join('\n'));

const verdict = blockers.length === 0
  ? (warnings.length === 0 ? '✅ 可以发布' : '✅ 可以发布（建议先处理警告）')
  : '❌ 暂不可发布';
console.log(`\n结论：${verdict}\n`);
process.exit(blockers.length === 0 ? 0 : 1);
