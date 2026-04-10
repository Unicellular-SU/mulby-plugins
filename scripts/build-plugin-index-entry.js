#!/usr/bin/env node
/**
 * Build a single Plugin Store Index v2 (Rich Metadata) entry.
 * Usage: node scripts/build-plugin-index-entry.js <plugin_name> <inplugin_file> <base_raw_url> <repo_url> <release_tag>
 * Run from repo root. Writes one JSON line to stdout.
 *
 * Includes `type` from manifest.json (PluginType); defaults to `other` when missing.
 *
 * - base_raw_url: e.g. https://raw.githubusercontent.com/Unicellular-SU/mulby-plugins/main
 * - repo_url: e.g. https://github.com/Unicellular-SU/mulby-plugins
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const repoRoot = process.cwd();
const [pluginName, inpluginFile, baseRawUrl, repoUrl, releaseTag] = process.argv.slice(2);

if (!pluginName || !inpluginFile) {
  process.stderr.write('Usage: node build-plugin-index-entry.js <plugin_name> <inplugin_file> <base_raw_url> <repo_url> <release_tag>\n');
  process.exit(1);
}

const pluginDir = path.join(repoRoot, 'plugins', pluginName);
const manifestPath = path.join(pluginDir, 'manifest.json');

if (!fs.existsSync(manifestPath)) {
  process.stderr.write(`manifest not found: ${manifestPath}\n`);
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

// Required + backward-compatible
const description = manifest.description || '';
let details = '';
const readmePath = path.join(pluginDir, 'README.md');
if (fs.existsSync(readmePath)) {
  details = fs.readFileSync(readmePath, 'utf8').trim();
}
// Fallback: if description is empty, use first paragraph of details
const summary = description || (details ? details.split(/\n\n+/)[0].replace(/#+\s*/, '').trim() : '');

const displayName = manifest.displayName || manifest.name;
let downloadUrl = `./releases/${inpluginFile}`;
if (repoUrl && releaseTag) {
  const encodedTag = encodeURIComponent(releaseTag);
  const encodedFile = encodeURIComponent(inpluginFile);
  downloadUrl = `${repoUrl.replace(/\/$/, '')}/releases/download/${encodedTag}/${encodedFile}`;
}

// sha256 of .inplugin (from releases/)
let sha256 = '';
const inpluginPath = path.join(repoRoot, 'releases', inpluginFile);
if (fs.existsSync(inpluginPath)) {
  const buf = fs.readFileSync(inpluginPath);
  sha256 = crypto.createHash('sha256').update(buf).digest('hex');
}

// icon: { type: "url", value: "..." } or string for backward compat
const iconPath = manifest.icon || 'icon.png';
const iconValue = baseRawUrl
  ? `${baseRawUrl.replace(/\/$/, '')}/plugins/${pluginName}/${iconPath}`
  : `./plugins/${pluginName}/${iconPath}`;
const icon = { type: 'url', value: iconValue };

// screenshots from plugins/<name>/screenshots/
const screenshotsDir = path.join(pluginDir, 'screenshots');
const screenshots = [];
if (fs.existsSync(screenshotsDir) && fs.statSync(screenshotsDir).isDirectory()) {
  const exts = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];
  const files = fs.readdirSync(screenshotsDir)
    .filter((f) => exts.some((e) => f.toLowerCase().endsWith(e)))
    .sort();
  for (const f of files) {
    const url = baseRawUrl
      ? `${baseRawUrl.replace(/\/$/, '')}/plugins/${pluginName}/screenshots/${f}`
      : `./plugins/${pluginName}/screenshots/${f}`;
    const captionPath = path.join(screenshotsDir, path.basename(f, path.extname(f)) + '.txt');
    const caption = fs.existsSync(captionPath)
      ? fs.readFileSync(captionPath, 'utf8').trim()
      : undefined;
    screenshots.push(caption ? { url, caption } : { url });
  }
}

const entry = {
  id: manifest.id,
  name: manifest.name,
  displayName,
  version: manifest.version,
  author: manifest.author || 'Unknown',
  description: summary,
  downloadUrl,
  lastPackageTime: new Date().toISOString(),
};

const rawType = typeof manifest.type === 'string' ? manifest.type.trim() : '';
entry.type = rawType || 'other';

if (details) entry.details = details;
entry.icon = icon;
if (screenshots.length) entry.screenshots = screenshots;
if (sha256) entry.sha256 = sha256;
if (manifest.homepage) entry.homepage = manifest.homepage;
else if (repoUrl) entry.homepage = repoUrl;
if (repoUrl) entry.repository = `${repoUrl}/tree/main/plugins/${pluginName}`;
if (manifest.license) entry.license = manifest.license;
if (manifest.tags && Array.isArray(manifest.tags)) entry.tags = manifest.tags;
if (manifest.categories && Array.isArray(manifest.categories)) entry.categories = manifest.categories;

process.stdout.write(JSON.stringify(entry) + '\n');
