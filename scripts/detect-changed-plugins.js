#!/usr/bin/env node
/**
 * Detect which plugins have changed since the last release tag.
 *
 * Usage:
 *   node scripts/detect-changed-plugins.js [--base <ref>] [--head <ref>] [--all-on-infra]
 *
 * Options:
 *   --base <ref>        Base reference (default: latest vYYYY.MM.DD-HHMM tag)
 *   --head <ref>        Head reference (default: HEAD)
 *   --all-on-infra      Rebuild all plugins when infra files change (default: true)
 *
 * Output (JSON to stdout):
 *   {
 *     "mode": "incremental" | "full",
 *     "reason": "...",
 *     "plugins": ["clipboard-history", "screen-pin"],
 *     "infraChanged": false
 *   }
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const INFRA_PATTERNS = [
  /^scripts\//,
  /^\.github\/workflows\//,
  /^package\.json$/,
  /^pnpm-workspace\.yaml$/,
  /^pnpm-lock\.yaml$/,
  /^build-local\.sh$/,
];

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { base: '', head: 'HEAD', allOnInfra: true };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--base' && args[i + 1]) opts.base = args[++i];
    else if (args[i] === '--head' && args[i + 1]) opts.head = args[++i];
    else if (args[i] === '--all-on-infra') opts.allOnInfra = true;
    else if (args[i] === '--no-all-on-infra') opts.allOnInfra = false;
  }
  return opts;
}

function git(cmd) {
  return execSync(`git ${cmd}`, { encoding: 'utf-8' }).trim();
}

function getLatestReleaseTag() {
  try {
    const tags = git('tag -l "v20*" --sort=-creatordate');
    if (!tags) return '';
    return tags.split('\n')[0].trim();
  } catch {
    return '';
  }
}

function getChangedFiles(base, head) {
  if (!base) return null;
  try {
    const diff = git(`diff --name-only ${base}...${head}`);
    return diff ? diff.split('\n').filter(Boolean) : [];
  } catch {
    return null;
  }
}

function getAllPlugins() {
  const pluginsDir = path.join(process.cwd(), 'plugins');
  if (!fs.existsSync(pluginsDir)) return [];
  return fs.readdirSync(pluginsDir).filter((name) => {
    const dir = path.join(pluginsDir, name);
    return (
      fs.statSync(dir).isDirectory() &&
      fs.existsSync(path.join(dir, 'package.json'))
    );
  });
}

function extractPluginNames(files) {
  const names = new Set();
  for (const f of files) {
    const m = f.match(/^plugins\/([^/]+)\//);
    if (m) names.add(m[1]);
  }
  return [...names];
}

/**
 * workspace 公共包（packages/，如 @mulby-plugins/manga-kit）有变更时，
 * 将声明了 @mulby-plugins/* 依赖的插件全部视为 changed（方案 7.1 步骤 5：
 * 按依赖精准标记，而非把 packages/ 加进 INFRA_PATTERNS 触发全量重建）。
 */
function pluginsDependingOnWorkspacePackages() {
  const names = [];
  for (const name of getAllPlugins()) {
    try {
      const pkg = JSON.parse(
        fs.readFileSync(path.join(process.cwd(), 'plugins', name, 'package.json'), 'utf-8')
      );
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (Object.keys(deps).some((d) => d.startsWith('@mulby-plugins/'))) names.push(name);
    } catch {
      /* ignore unreadable package.json */
    }
  }
  return names;
}

function hasInfraChanges(files) {
  return files.some((f) => INFRA_PATTERNS.some((p) => p.test(f)));
}

function main() {
  const opts = parseArgs();
  const base = opts.base || getLatestReleaseTag();

  if (!base) {
    const allPlugins = getAllPlugins();
    const result = {
      mode: 'full',
      reason: 'No previous release tag found, building all plugins',
      plugins: allPlugins,
      infraChanged: false,
    };
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return;
  }

  const files = getChangedFiles(base, opts.head);
  if (files === null) {
    const allPlugins = getAllPlugins();
    const result = {
      mode: 'full',
      reason: `Failed to diff ${base}...${opts.head}, building all plugins`,
      plugins: allPlugins,
      infraChanged: false,
    };
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return;
  }

  if (files.length === 0) {
    const result = {
      mode: 'incremental',
      reason: `No changes since ${base}`,
      plugins: [],
      infraChanged: false,
    };
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return;
  }

  const infraChanged = hasInfraChanges(files);
  const changedPlugins = extractPluginNames(files);
  if (files.some((f) => /^packages\//.test(f))) {
    for (const name of pluginsDependingOnWorkspacePackages()) {
      if (!changedPlugins.includes(name)) changedPlugins.push(name);
    }
  }

  if (infraChanged && opts.allOnInfra) {
    const allPlugins = getAllPlugins();
    const result = {
      mode: 'full',
      reason: `Infrastructure files changed since ${base}, rebuilding all plugins`,
      plugins: allPlugins,
      infraChanged: true,
    };
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return;
  }

  const existingPlugins = getAllPlugins();
  const validPlugins = changedPlugins.filter((p) => existingPlugins.includes(p));

  const result = {
    mode: 'incremental',
    reason: `${validPlugins.length} plugin(s) changed since ${base}`,
    plugins: validPlugins,
    infraChanged,
  };
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

main();
