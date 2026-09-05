import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { posix } from 'node:path';
import { TextDecoder } from 'node:util';

// Audit the Git INDEX, not just working files: a staged secret must not be
// hidden by subsequently editing the working copy. No candidate bytes are logged.
const roots = new Set([
  '.gitignore', '.gitattributes', '.nvmrc', '.env.example',
  'README.md', 'SECURITY.md', 'CONTRIBUTING.md',
  'package.json', 'package-lock.json', 'tsconfig.json', 'vite.config.ts',
  'index.html', 'wrangler.jsonc', '.github/workflows/ci.yml',
  'contracts/Pinhaotuan.sol', 'contracts/DemoUSD.sol', 'contracts/TestUSDC.sol',
  'worker/index.ts', 'worker/media.ts', 'src/i18n/en.json',
  'public/_headers', 'public/deployment.json', 'public/catalog.json',
  'public/proof/settlement.json', 'public/proof/README.md',
]);
const scripts = new Set([
  'compile-contracts.mjs', 'deploy-local.mjs', 'test-contracts.mjs',
  'test-recovery-unit.mjs', 'test-controller-regressions.mjs',
  'test-media-worker.mjs', 'check-repository.mjs',
]);
const allowed = file => roots.has(file) ||
  (/^src\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+\.(ts|tsx|css)$/.test(file)) ||
  (file.startsWith('scripts/') && scripts.has(file.slice('scripts/'.length)));
const secretPatterns = [
  ['private-key block', /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/],
  ['GitHub credential', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/],
  ['provider credential', /\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{24,}\b/],
  ['AWS access key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ['assigned secret', /(?:private[_-]?key|secret[_-]?key|api[_-]?key|access[_-]?token|mnemonic|seed[_-]?phrase)["']?\s*[:=]\s*["'][A-Za-z0-9+\/_= .-]{20,}["']/i],
  ['credential URL', /https?:\/\/[^\s/@:]+:[^\s/@]+@/],
  ['personal absolute path', /\/(?:Users|home)\/[A-Za-z0-9._-]+\//],
];
function git(args) {
  return execFileSync('git', args, { maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
}
const staged = git(['ls-files', '--stage', '-z']).toString('utf8').split('\0').filter(Boolean);
assert(staged.length > 0, 'No tracked/staged files. Stage the reviewed source allowlist first.');
const files = new Set();
const contents = new Map();
const failures = [];
let totalBytes = 0;
for (const row of staged) {
  const match = /^(\d+) ([a-f0-9]+) (\d)\t(.+)$/.exec(row);
  assert(match, 'Unrecognized Git index entry');
  const [, mode, object, stage, file] = match;
  files.add(file);
  if (stage !== '0' || !['100644', '100755'].includes(mode)) {
    failures.push(`${file}: unresolved entry, symlink or submodule`); continue;
  }
  if (!allowed(file)) { failures.push(`${file}: outside public source allowlist`); continue; }
  const data = git(['cat-file', 'blob', object]);
  totalBytes += data.length;
  const limit = file === 'package-lock.json' ? 1024 * 1024 : 256 * 1024;
  if (data.length > limit) failures.push(`${file}: unexpectedly large source file`);
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(data); }
  catch { failures.push(`${file}: not UTF-8 text`); continue; }
  if (data.includes(0)) failures.push(`${file}: binary data`);
  for (const [label, pattern] of secretPatterns) {
    if (pattern.test(text)) failures.push(`${file}: possible ${label}`);
  }
  contents.set(file, text);
}
for (const needed of [...roots, ...[...scripts].map(x => `scripts/${x}`), 'src/generated/abi.ts', 'src/main.tsx', 'src/App.tsx']) {
  if (!files.has(needed)) failures.push(`${needed}: required public source is missing`);
}
const env = contents.get('.env.example') || '';
for (const line of env.split('\n').map(x => x.trim()).filter(x => x && !x.startsWith('#'))) {
  if (!/^[A-Z][A-Z0-9_]*=$/.test(line)) failures.push('.env.example: examples must have blank values');
}
// Check local Markdown destinations against the committed tree. External URLs
// are intentionally not fetched in CI and must never be mistaken for local media.
for (const [file, text] of contents) {
  if (!file.endsWith('.md')) continue;
  for (const link of text.matchAll(/\]\(([^\s)]+)\)/g)) {
    const destination = link[1];
    if (/^(?:https?:|mailto:)/.test(destination)) continue;
    if (destination.startsWith('#')) {
      const id = destination.slice(1);
      if (!text.includes(`id="${id}"`)) failures.push(`${file}: missing local anchor ${id}`);
      continue;
    }
    const target = posix.normalize(posix.join(posix.dirname(file), destination.split('#')[0]));
    if (!files.has(target)) failures.push(`${file}: missing linked source ${target}`);
  }
}
const pkg = JSON.parse(contents.get('package.json') || '{}');
for (const command of Object.values(pkg.scripts || {})) {
  for (const ref of command.matchAll(/scripts\/[A-Za-z0-9_.-]+/g)) {
    if (!files.has(ref[0])) failures.push(`package.json: missing npm entrypoint ${ref[0]}`);
  }
}
assert(!pkg.devDependencies?.playwright && !pkg.devDependencies?.pptxgenjs, 'Media-production dependencies do not belong in the public package.');
if (failures.length) {
  console.error('Repository hygiene failed:\n' + failures.map(x => `- ${x}`).join('\n'));
  process.exit(1);
}
console.log(JSON.stringify({ checkedFiles: files.size, totalSourceBytes: totalBytes,
  engineeringScripts: [...scripts], mediaFiles: 0, unexpectedPaths: 0,
  detectedCredentialPatterns: 0, checked: 'Git index blobs; not a comprehensive security audit' }, null, 2));
