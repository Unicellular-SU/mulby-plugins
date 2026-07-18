#!/usr/bin/env node
/**
 * mulby.d.ts 漂移治理管线（方案 7.2 步骤 3/4）。
 *
 * 背景：window.mulby 没有单一聚合类型真源（由宿主 preload 各 api 工厂拼装），
 * `packages/mulby-types/mulby.d.ts` 是手工维护的单点分发基线；其上游事实来自宿主
 * `src/shared/types/*.ts`。本脚本把上游快照进 `packages/mulby-types/host-shared/`
 * 并记录哈希清单——宿主类型一变，--check 即失败，提示维护者比对快照 diff、
 * 把变更手工应用到 mulby.d.ts 后重新 sync 刷新快照。
 *
 * 用法：
 *   node scripts/sync-mulby-types.mjs            # 同步：从宿主检出拷贝 shared/types 快照并写清单
 *   node scripts/sync-mulby-types.mjs --check    # 检查：
 *     1) 已迁移插件（package.json 依赖 @mulby-plugins/types）不得残留本地 src/types/mulby.d.ts（违反则 exit 1）
 *     2) 未迁移插件的本地拷贝相对基线的漂移清单（仅 warning，不阻塞）
 *     3) 若能找到宿主检出：宿主 shared/types 与快照清单比对，漂移则 exit 1
 *
 * 宿主检出定位：环境变量 MULBY_REPO；缺省依次尝试 ../mulby 与 ../../../mulby
 * （后者覆盖 .worktrees/<name> 工作树布局）。--check 找不到宿主时跳过第 3 步（CI 无宿主也可跑第 1/2 步）。
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TYPES_PKG_DIR = path.join(ROOT, 'packages', 'mulby-types');
const BASELINE = path.join(TYPES_PKG_DIR, 'mulby.d.ts');
const SNAPSHOT_DIR = path.join(TYPES_PKG_DIR, 'host-shared');
const MANIFEST = path.join(TYPES_PKG_DIR, 'sync-manifest.json');
const HOST_TYPES_SUBDIR = path.join('src', 'shared', 'types');

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

function findHostRepo() {
  const candidates = process.env.MULBY_REPO
    ? [process.env.MULBY_REPO]
    : [path.join(ROOT, '..', 'mulby'), path.join(ROOT, '..', '..', '..', 'mulby')];
  for (const c of candidates) {
    const dir = path.resolve(ROOT, c);
    if (fs.existsSync(path.join(dir, HOST_TYPES_SUBDIR))) return dir;
  }
  return null;
}

function listHostTypeFiles(hostRepo) {
  const dir = path.join(hostRepo, HOST_TYPES_SUBDIR);
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.ts'))
    .sort()
    .map((f) => ({ name: f, abs: path.join(dir, f) }));
}

function hostCommit(hostRepo) {
  try {
    return execSync('git rev-parse HEAD', { cwd: hostRepo, encoding: 'utf-8' }).trim();
  } catch {
    return null;
  }
}

function doSync() {
  const hostRepo = findHostRepo();
  if (!hostRepo) {
    console.error('[sync-mulby-types] 找不到宿主检出：请设置 MULBY_REPO 或将 mulby 仓库放在本仓库同级 / 工作树上三级。');
    process.exit(1);
  }
  fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
  // 清掉快照目录里已不存在于宿主的旧文件
  for (const f of fs.readdirSync(SNAPSHOT_DIR)) fs.rmSync(path.join(SNAPSHOT_DIR, f));

  const files = listHostTypeFiles(hostRepo);
  const manifest = {
    syncedAt: new Date().toISOString(),
    hostRepo: path.relative(ROOT, hostRepo) || hostRepo,
    hostCommit: hostCommit(hostRepo),
    hostTypesDir: HOST_TYPES_SUBDIR.split(path.sep).join('/'),
    baselineSha256: sha256(fs.readFileSync(BASELINE)),
    files: {},
  };
  for (const { name, abs } of files) {
    const buf = fs.readFileSync(abs);
    fs.writeFileSync(path.join(SNAPSHOT_DIR, name), buf);
    manifest.files[name] = sha256(buf);
  }
  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`[sync-mulby-types] 已同步 ${files.length} 个宿主类型文件快照（host=${manifest.hostRepo}@${(manifest.hostCommit || 'unknown').slice(0, 8)}）。`);
  console.log('[sync-mulby-types] 若本次同步引入了 diff，请比对 packages/mulby-types/host-shared/ 的变更并手工应用到 mulby.d.ts。');
}

function readJsonSafe(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch { return null; }
}

function collectPluginCopies() {
  const out = [];
  for (const group of ['plugins', 'archived-plugins']) {
    const groupDir = path.join(ROOT, group);
    if (!fs.existsSync(groupDir)) continue;
    for (const name of fs.readdirSync(groupDir)) {
      const dir = path.join(groupDir, name);
      if (!fs.statSync(dir).isDirectory()) continue;
      const dts = path.join(dir, 'src', 'types', 'mulby.d.ts');
      const pkg = readJsonSafe(path.join(dir, 'package.json')) || {};
      const migrated = !!(
        (pkg.dependencies && pkg.dependencies['@mulby-plugins/types']) ||
        (pkg.devDependencies && pkg.devDependencies['@mulby-plugins/types'])
      );
      out.push({ plugin: `${group}/${name}`, dtsPath: dts, hasCopy: fs.existsSync(dts), migrated });
    }
  }
  return out;
}

function doCheck() {
  let failed = false;
  const baselineBuf = fs.readFileSync(BASELINE);
  const baselineHash = sha256(baselineBuf);
  const baselineLines = baselineBuf.toString('utf-8').split('\n').length;

  // 1) 已迁移插件不得残留本地拷贝（防"包 + 本地拷贝"双轨）
  const copies = collectPluginCopies();
  for (const c of copies) {
    if (c.migrated && c.hasCopy) {
      console.error(`[sync-mulby-types] ERROR: ${c.plugin} 已依赖 @mulby-plugins/types，但仍残留本地 src/types/mulby.d.ts（双轨），请删除本地拷贝。`);
      failed = true;
    }
  }

  // 2) 未迁移插件的漂移清单（仅 warning）
  const drifted = [];
  for (const c of copies) {
    if (!c.migrated && c.hasCopy) {
      const buf = fs.readFileSync(c.dtsPath);
      if (sha256(buf) !== baselineHash) {
        drifted.push(`${c.plugin} (${buf.toString('utf-8').split('\n').length} 行 vs 基线 ${baselineLines} 行)`);
      }
    }
  }
  if (drifted.length > 0) {
    console.warn(`[sync-mulby-types] WARN: ${drifted.length} 个未迁移插件的 mulby.d.ts 与基线存在漂移（不阻塞，逐步迁移到 @mulby-plugins/types）：`);
    for (const d of drifted) console.warn(`  - ${d}`);
  }

  // 3) 宿主 shared/types 相对快照清单的漂移（找得到宿主检出才检查）
  const manifest = readJsonSafe(MANIFEST);
  const hostRepo = findHostRepo();
  if (!manifest) {
    console.warn('[sync-mulby-types] WARN: 缺少 sync-manifest.json，请先运行 node scripts/sync-mulby-types.mjs 生成宿主快照。');
  } else if (!hostRepo) {
    console.warn('[sync-mulby-types] WARN: 找不到宿主检出（MULBY_REPO），跳过宿主类型漂移检查。');
  } else {
    const files = listHostTypeFiles(hostRepo);
    const current = new Map(files.map(({ name, abs }) => [name, sha256(fs.readFileSync(abs))]));
    const recorded = new Map(Object.entries(manifest.files || {}));
    const diffs = [];
    for (const [name, hash] of current) {
      if (!recorded.has(name)) diffs.push(`+ ${name}（宿主新增）`);
      else if (recorded.get(name) !== hash) diffs.push(`~ ${name}（内容变更）`);
    }
    for (const name of recorded.keys()) {
      if (!current.has(name)) diffs.push(`- ${name}（宿主删除）`);
    }
    if (manifest.baselineSha256 && manifest.baselineSha256 !== baselineHash) {
      diffs.push('~ packages/mulby-types/mulby.d.ts（基线在上次 sync 后被修改，请重新 sync 以确认与宿主快照一致）');
    }
    if (diffs.length > 0) {
      console.error(`[sync-mulby-types] ERROR: 宿主 shared/types 相对快照存在漂移（上次同步 ${manifest.syncedAt}，host@${(manifest.hostCommit || 'unknown').slice(0, 8)}）：`);
      for (const d of diffs) console.error(`  ${d}`);
      console.error('[sync-mulby-types] 处理方式：运行 node scripts/sync-mulby-types.mjs 刷新快照，比对 host-shared/ diff 并把 API 变更手工应用到 mulby.d.ts。');
      failed = true;
    }
  }

  if (failed) process.exit(1);
  console.log('[sync-mulby-types] check 通过。');
}

if (process.argv.includes('--check')) doCheck();
else doSync();
