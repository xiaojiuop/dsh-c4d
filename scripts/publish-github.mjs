/**
 * 发布到 GitHub —— 纯 Node 实现，不需要 git CLI。
 *
 * ⚠️ 为什么不能用账号密码：
 *   GitHub 自 2021-08-13 起彻底禁用了密码认证的 git 操作，自 2020-11 起 REST API
 *   也不再接受「用户名 + 密码」的 Basic Auth。账号密码只能用于**网页登录**，
 *   而网页登录要走 2FA / 设备验证，无法自动化产出令牌。
 *   所以自动化链路里唯一可用的凭据是 **Personal Access Token (PAT)**。
 *
 * 本脚本用 GitHub Git Data API 一次性提交整个目录树：
 *   blob（每个文件）→ tree（整棵树）→ commit → ref（指向 main）
 * 因此连 git 都不需要装。
 *
 * 用法：
 *   set GH_TOKEN=ghp_xxx        (PowerShell: $env:GH_TOKEN="ghp_xxx")
 *   node scripts/publish-github.mjs --check     # 只验证 token 与仓库状态
 *   node scripts/publish-github.mjs             # 创建仓库并上传
 *   node scripts/publish-github.mjs --repo dsh-c4d --private
 *
 * Token 生成：https://github.com/settings/tokens
 *   → Generate new token (classic) → 勾选 repo 作用域
 *   或 Fine-grained token → Repository access: All repositories
 *                            Repository permissions: Contents = Read and write,
 *                            Administration = Read and write（需要建仓库）
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { resolve, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const API = 'https://api.github.com';

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n, d) => { const i = argv.indexOf(n); return i === -1 ? d : argv[i + 1]; };

const ONLY_CHECK = flag('--check');
const PRIVATE = flag('--private');
const REPO_NAME = opt('--repo', 'dsh-c4d');

const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));

// ── Token ──────────────────────────────────────────────────────────────────
function findToken() {
  const env = process.env.GH_TOKEN?.trim() || process.env.GITHUB_TOKEN?.trim();
  if (env) return { token: env, source: 'GH_TOKEN 环境变量' };
  const file = join(homedir(), '.gh-token');
  if (existsSync(file)) {
    const t = readFileSync(file, 'utf8').trim();
    if (t) return { token: t, source: file };
  }
  return null;
}

const found = findToken();
const mask = (v) => (v.length <= 10 ? '***' : `${v.slice(0, 7)}…${v.slice(-4)}`);

console.log('\n=== dsh-c4d → GitHub 发布 ===\n');
console.log(`包     : ${pkg.name}@${pkg.version}`);
console.log(`仓库名 : ${REPO_NAME}（${PRIVATE ? '私有' : '公开'}）`);

if (!found) {
  console.log('\n❌ 没有找到 GitHub Token。\n');
  console.log('账号密码在这里用不上 —— GitHub 已禁止密码认证 git 操作（2021-08）');
  console.log('和 REST API（2020-11）。自动化只能用 Personal Access Token。\n');
  console.log('获取步骤（约 1 分钟）：');
  console.log('  1) 用浏览器登录 https://github.com 确认账号 jiujiu010201 可用');
  console.log('  2) 打开 https://github.com/settings/tokens');
  console.log('  3) Generate new token (classic)');
  console.log('     - Note: dsh-c4d publish');
  console.log('     - Expiration: 30 days');
  console.log('     - 勾选 ☑ repo（完整仓库读写，含创建仓库）');
  console.log('  4) Generate token，复制 ghp_ 开头的那串');
  console.log('  5) 在 PowerShell 里设置环境变量（只在当前窗口有效）：');
  console.log('       $env:GH_TOKEN="ghp_你的token"');
  console.log('     或写入文件 %USERPROFILE%\\.gh-token（内容只有 token 一行）');
  console.log('  6) 重新运行：node scripts/publish-github.mjs\n');
  process.exit(1);
}

const TOKEN = found.token;
console.log(`token  : ${mask(TOKEN)}（来源：${found.source}）`);

const api = async (path, init = {}) => {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${TOKEN}`,
      accept: 'application/vnd.github+json',
      'user-agent': 'dsh-c4d-publisher',
      'x-github-api-version': '2022-11-28',
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...init.headers,
    },
  });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { ok: res.ok, status: res.status, body };
};

// ── 1. 验证 token ──────────────────────────────────────────────────────────
const me = await api('/user');
if (!me.ok) {
  console.log(`\n❌ token 无效（HTTP ${me.status}）`);
  console.log(`   ${JSON.stringify(me.body).slice(0, 300)}`);
  console.log('\n   → 检查 token 是否过期、是否勾选了 repo 作用域。');
  process.exit(1);
}
const owner = me.body.login;
console.log(`账号   : ${owner}  ✔`);

// ── 2. 仓库状态 ────────────────────────────────────────────────────────────
const repoRes = await api(`/repos/${owner}/${REPO_NAME}`);
const repoExists = repoRes.ok;
if (repoExists) {
  console.log(`仓库   : ${owner}/${REPO_NAME} 已存在（将追加提交）`);
} else if (repoRes.status === 404) {
  console.log(`仓库   : ${owner}/${REPO_NAME} 不存在（将创建）`);
} else {
  console.log(`\n❌ 检查仓库失败（HTTP ${repoRes.status}）`);
  console.log(`   ${JSON.stringify(repoRes.body).slice(0, 300)}`);
  process.exit(1);
}

if (ONLY_CHECK) {
  console.log('\n（--check：仅校验，未上传）\n');
  process.exit(0);
}

// ── 3. 创建仓库（如果需要）────────────────────────────────────────────────
if (!repoExists) {
  const created = await api('/user/repos', {
    method: 'POST',
    body: JSON.stringify({
      name: REPO_NAME,
      description: pkg.description,
      homepage: pkg.homepage ?? '',
      private: PRIVATE,
      has_issues: true,
      has_wiki: false,
      auto_init: false,
    }),
  });
  if (!created.ok) {
    console.log(`\n❌ 创建仓库失败（HTTP ${created.status}）`);
    console.log(`   ${JSON.stringify(created.body).slice(0, 500)}`);
    if (created.status === 403) console.log('\n   → token 缺少 repo 作用域，或该账号无权创建仓库。');
    process.exit(1);
  }
  console.log(`创建   : ${created.body.html_url}  ✔`);
}

// ── 4. 收集文件（与 zip 相同的排除规则）───────────────────────────────────
const SKIP_DIRS = new Set(['node_modules', '.git', '.c4d-demo', '.smoke-c4d', '_zip-stage']);
const SKIP_EXT = new Set(['.tgz', '.log']);
const files = [];
async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) { await walk(full); continue; }
    const rel = relative(root, full).split('\\').join('/');
    if (SKIP_EXT.has(rel.slice(rel.lastIndexOf('.')))) continue;
    files.push({ path: rel, abs: full, size: (await stat(full)).size });
  }
}
await walk(root);
files.sort((a, b) => a.path.localeCompare(b.path));
const totalBytes = files.reduce((n, f) => n + f.size, 0);
console.log(`文件   : ${files.length} 个 / ${(totalBytes / 1024).toFixed(1)} KB`);

// ── 5. 逐个上传 blob ───────────────────────────────────────────────────────
const tree = [];
for (const file of files) {
  const content = await readFile(file.abs);
  const blob = await api(`/repos/${owner}/${REPO_NAME}/git/blobs`, {
    method: 'POST',
    body: JSON.stringify({ content: content.toString('base64'), encoding: 'base64' }),
  });
  if (!blob.ok) {
    console.log(`\n❌ 上传 ${file.path} 失败（HTTP ${blob.status}）`);
    console.log(`   ${JSON.stringify(blob.body).slice(0, 300)}`);
    process.exit(1);
  }
  tree.push({
    path: file.path,
    mode: '100644',
    type: 'blob',
    sha: blob.body.sha,
  });
  process.stdout.write(`\r  blob ${tree.length}/${files.length}  ${file.path.slice(0, 60).padEnd(60)}`);
}
console.log('');

// ── 6. 建 tree / commit / ref ──────────────────────────────────────────────
// 已有仓库需要带上父提交，否则历史会被顶掉
let parents = [];
let baseTree;
if (repoExists) {
  const ref = await api(`/repos/${owner}/${REPO_NAME}/git/ref/heads/main`);
  const branch = ref.ok ? 'main' : 'master';
  const refRes = ref.ok ? ref : await api(`/repos/${owner}/${REPO_NAME}/git/ref/heads/${branch}`);
  if (refRes.ok) {
    parents = [refRes.body.object.sha];
    const commit = await api(`/repos/${owner}/${REPO_NAME}/git/commits/${parents[0]}`);
    if (commit.ok) baseTree = commit.body.tree.sha;
  }
}

const treeRes = await api(`/repos/${owner}/${REPO_NAME}/git/trees`, {
  method: 'POST',
  body: JSON.stringify(baseTree ? { base_tree: baseTree, tree } : { tree }),
});
if (!treeRes.ok) {
  console.log(`\n❌ 建 tree 失败（HTTP ${treeRes.status}）`);
  console.log(`   ${JSON.stringify(treeRes.body).slice(0, 400)}`);
  process.exit(1);
}

const commitRes = await api(`/repos/${owner}/${REPO_NAME}/git/commits`, {
  method: 'POST',
  body: JSON.stringify({
    message: `v${pkg.version}: ${pkg.description}`,
    tree: treeRes.body.sha,
    parents,
  }),
});
if (!commitRes.ok) {
  console.log(`\n❌ 建 commit 失败（HTTP ${commitRes.status}）`);
  console.log(`   ${JSON.stringify(commitRes.body).slice(0, 400)}`);
  process.exit(1);
}

const branchName = repoExists && parents.length ? 'main' : 'main';
const refRes = repoExists && parents.length
  ? await api(`/repos/${owner}/${REPO_NAME}/git/refs/heads/${branchName}`, {
    method: 'PATCH',
    body: JSON.stringify({ sha: commitRes.body.sha, force: false }),
  })
  : await api(`/repos/${owner}/${REPO_NAME}/git/refs`, {
    method: 'POST',
    body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha: commitRes.body.sha }),
  });

if (!refRes.ok) {
  // 分支名可能是 master，重试
  const retry = await api(`/repos/${owner}/${REPO_NAME}/git/refs`, {
    method: 'POST',
    body: JSON.stringify({ ref: 'refs/heads/master', sha: commitRes.body.sha }),
  });
  if (!retry.ok) {
    console.log(`\n❌ 更新分支失败（HTTP ${refRes.status}）`);
    console.log(`   ${JSON.stringify(refRes.body).slice(0, 400)}`);
    process.exit(1);
  }
  console.log('分支   : master');
} else {
  console.log(`分支   : ${branchName}`);
}

console.log(`\n✅ 已发布到 https://github.com/${owner}/${REPO_NAME}\n`);
console.log('其他人可以直接安装（无需 npm 账号）：');
console.log(`  dsh plugin --profile desktop add github:${owner}/${REPO_NAME}\n`);
console.log('你自己本机也可以改成从 GitHub 装：');
console.log(`  dsh plugin --profile desktop remove dsh-c4d`);
console.log(`  dsh plugin --profile desktop add github:${owner}/${REPO_NAME}\n`);
