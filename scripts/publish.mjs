/**
 * 发布脚本 —— 带认证预检，避免再撞 npm 的 404 陷阱。
 *
 * 为什么需要它：
 *   npm registry 对**匿名**的 PUT（发布）请求返回 404 Not Found，而不是 401/403。
 *   所以未登录时错误信息看起来像"包名不存在"，极具误导性。
 *   本脚本先做 whoami 验证，认证通过才真正 publish。
 *
 * 用法：
 *   node scripts/publish.mjs              # 预检 + 发布
 *   node scripts/publish.mjs --check      # 只预检，不发布
 *   node scripts/publish.mjs --dry-run    # 预检 + pnpm pack 但不推送
 *
 * Token 来源（优先级从高到低）：
 *   1. 环境变量 NPM_TOKEN
 *   2. %USERPROFILE%\.npmrc 里的 //registry.npmjs.org/:_authToken=...
 */

import { readFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { homedir } from 'node:os';

const run = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REGISTRY = 'https://registry.npmjs.org';
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

const argCheck = process.argv.includes('--check');
const argDry = process.argv.includes('--dry-run');

// ── 1. 取 token ────────────────────────────────────────────────────────────
function mask(value) {
  if (!value) return '(空)';
  return value.length <= 12 ? '***' : `${value.slice(0, 8)}…${value.slice(-4)}`;
}

function readNpmrcTokens() {
  const file = join(homedir(), '.npmrc');
  if (!existsSync(file)) return { file, tokens: {}, found: false };
  const tokens = {};
  let registry = null;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#') || trimmed.startsWith(';')) continue;
    const tokenMatch = /^(\/\/[^=]+):_authToken\s*=\s*(.+)$/.exec(trimmed);
    if (tokenMatch) tokens[tokenMatch[1]] = tokenMatch[2].trim();
    const regMatch = /^registry\s*=\s*(.+)$/.exec(trimmed);
    if (regMatch) registry = regMatch[1].trim();
  }
  return { file, tokens, registry, found: true };
}

const npmrc = readNpmrcTokens();
let token = process.env.NPM_TOKEN?.trim();
let tokenSource = 'NPM_TOKEN 环境变量';

if (!token) {
  // 优先匹配 npmjs.org 官方 registry 的 token
  const key = Object.keys(npmrc.tokens).find((k) => k.includes('registry.npmjs.org'));
  if (key) {
    token = npmrc.tokens[key];
    tokenSource = `${npmrc.file}（${key}）`;
  }
}

console.log('\n=== dsh-c4d 发布预检 ===\n');
console.log(`包      : ${pkg.name}@${pkg.version}`);
console.log(`registry: ${npmrc.registry ?? REGISTRY}`);

if (npmrc.registry && !npmrc.registry.includes('registry.npmjs.org')) {
  console.log(`\n⚠️  ~/.npmrc 把 registry 指向了 ${npmrc.registry}`);
  console.log('   镜像站（如 npmmirror）通常不接受 publish，请改回 https://registry.npmjs.org/');
}

if (!token) {
  console.log('\n❌ 未找到 npm 认证 token —— 这就是 publish 返回 404 的原因。\n');
  console.log('npm 对**匿名发布**返回 404 Not Found（不是 401），所以错误信息会误导成"包名不存在"。\n');
  console.log('解决步骤：');
  console.log('  1) 注册/登录 https://www.npmjs.com （新账号需先验证邮箱）');
  console.log('  2) 打开 https://www.npmjs.com/settings/<你的用户名>/tokens');
  console.log('  3) Generate New Token → 选 "Granular Access Token"');
  console.log('     - Permissions: Read and write');
  console.log('     - Packages: All packages（或限定 ' + pkg.name + '）');
  console.log('     - 勾选 Bypass two-factor authentication（自动化发布用）');
  console.log('  4) 复制生成的 token，写入 %USERPROFILE%\\.npmrc（用记事本新建即可）：\n');
  console.log(`     //registry.npmjs.org/:_authToken=npm_你的token\n`);
  console.log('  5) 重新运行：node scripts/publish.mjs\n');
  console.log(`   本机 .npmrc 路径应为：${join(homedir(), '.npmrc')}`);
  console.log(`   当前是否存在     ：${npmrc.found ? '存在但无有效 token' : '不存在'}\n`);
  process.exit(1);
}

console.log(`token   : ${mask(token)}（来源：${tokenSource}）`);

// ── 2. 验证 token 有效性 ───────────────────────────────────────────────────
try {
  const res = await fetch(`${REGISTRY}/-/whoami`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.text();
    console.log(`\n❌ token 无效（HTTP ${res.status}）`);
    console.log(`   ${body.slice(0, 300)}`);
    console.log('\n   → 重新生成 token，确认权限为 "Read and write"，且未过期。');
    process.exit(1);
  }
  const who = await res.json();
  console.log(`账号    : ${who.username}  ✔ 认证通过`);
} catch (error) {
  console.log(`\n❌ 无法连接 registry：${error.message}`);
  process.exit(1);
}

// ── 3. 检查包名可用性 ──────────────────────────────────────────────────────
try {
  const res = await fetch(`${REGISTRY}/${encodeURIComponent(pkg.name)}`);
  if (res.ok) {
    const info = await res.json();
    const owners = Object.keys(info.versions ?? {});
    console.log(`\n⚠️  ${pkg.name} 已存在于 registry（${owners.length} 个版本）`);
    console.log('   → 你是 owner 就提升 version 后再发；不是 owner 就换名。');
  } else if (res.status === 404) {
    console.log(`\n✔ ${pkg.name} 尚未被占用，首次发布将创建该包`);
  }
} catch { /* 名称检查失败不阻塞 */ }

if (argCheck) {
  console.log('\n（--check：仅预检，未发布）\n');
  process.exit(0);
}

// ── 4. 发布 ────────────────────────────────────────────────────────────────
const pnpmCandidates = [
  'C:/Users/九九/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/pnpm/bin/pnpm.cjs',
  join(homedir(), '.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/pnpm/bin/pnpm.cjs'),
];
const pnpm = pnpmCandidates.find((p) => existsSync(p));
if (!pnpm) {
  console.log('\n❌ 找不到 pnpm。请手动执行： pnpm publish --access public\n');
  process.exit(1);
}

const args = [pnpm, 'publish', '--access', 'public', '--no-git-checks'];
if (argDry) args.push('--dry-run');

console.log(`\n→ 执行：pnpm ${args.slice(1).join(' ')}\n`);
try {
  const { stdout, stderr } = await run(process.execPath, args, {
    cwd: root,
    timeout: 300_000,
    env: { ...process.env, NPM_TOKEN: token },
    maxBuffer: 8 * 1024 * 1024,
  });
  if (stdout) console.log(stdout);
  if (stderr) console.log(stderr);
  console.log(`\n✅ ${argDry ? 'dry-run 完成' : '发布成功'}\n`);
  if (!argDry) {
    console.log('用户现在可以安装：');
    console.log(`  dsh plugin --profile desktop add ${pkg.name}\n`);
  }
} catch (error) {
  const out = `${error.stdout ?? ''}${error.stderr ?? ''}${error.message ?? ''}`;
  console.log('\n❌ 发布失败\n');
  console.log(out.slice(0, 2000));
  if (/E404|404 Not Found/.test(out)) {
    console.log('\n提示：仍是 404 —— 确认 token 有 "Read and write" 权限，且浏览器/终端已能访问 registry.npmjs.org。');
  }
  if (/E403|403/.test(out)) {
    console.log('\n提示：403 通常表示包名已被别人占用，或 token 权限不足 / 需要 2FA。');
  }
  if (/E409|409/.test(out)) {
    console.log('\n提示：409 表示该版本号已存在，先提升 package.json 的 version。');
  }
  process.exit(1);
}
