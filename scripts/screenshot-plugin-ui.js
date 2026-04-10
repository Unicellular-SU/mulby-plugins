#!/usr/bin/env node
/**
 * 先 build 再虚拟渲染首屏并截图，保存到 plugins/<name>/screenshots/1.png
 *
 * 使用方式（在仓库根目录）：
 *   npm run screenshot-plugins           # 为所有有 build 的插件先 build 再截图
 *   npm run screenshot-plugins -- ai-translator   # 仅指定插件
 *   node scripts/screenshot-plugin-ui.js [plugin_name...]
 *
 * 依赖：在仓库根目录执行 npm install（安装 puppeteer）
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const { execSync } = require('child_process');

const repoRoot = process.cwd();
const pluginsDir = path.join(repoRoot, 'plugins');

/** 启动静态文件服务，返回 { url, close } */
function serveStatic(dir, port) {
  const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
  const server = http.createServer((req, res) => {
    const p = path.join(dir, req.url === '/' ? 'index.html' : decodeURIComponent(req.url).replace(/^\//, '').split('?')[0]);
    if (!p.startsWith(dir)) {
      res.writeHead(403);
      res.end();
      return;
    }
    fs.readFile(p, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end();
        return;
      }
      const ext = path.extname(p);
      res.setHeader('Content-Type', mime[ext] || 'application/octet-stream');
      res.end(data);
    });
  });
  return new Promise((resolve, reject) => {
    server.listen(port, '127.0.0.1', () => resolve({
      url: `http://127.0.0.1:${port}/`,
      close: () => new Promise((cb) => server.close(cb)),
    }));
    server.on('error', reject);
  });
}

/** 列出带 package.json 且含 build 脚本的插件目录名 */
function getPluginsWithBuild() {
  const names = fs.readdirSync(pluginsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((name) => {
      const pkgPath = path.join(pluginsDir, name, 'package.json');
      if (!fs.existsSync(pkgPath)) return false;
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      return pkg.scripts && typeof pkg.scripts.build === 'string';
    });
  return names;
}

/** 判断插件是否有 UI（manifest 中声明了 ui 字段），无 UI 的为仅后端插件 */
function hasManifestUi(pluginName) {
  const manifestPath = path.join(pluginsDir, pluginName, 'manifest.json');
  if (!fs.existsSync(manifestPath)) return false;
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  return Boolean(manifest.ui);
}

/** 仅列出有 UI 且可 build 的插件（排除仅后端插件如 background-test） */
function getPluginsWithUiToScreenshot() {
  return getPluginsWithBuild().filter(hasManifestUi);
}

/** 在插件目录执行 npm install（静默）再 npm run build */
function buildPlugin(pluginName) {
  const cwd = path.join(pluginsDir, pluginName);
  try {
    execSync('npm install --include=dev', { cwd, stdio: 'pipe' });
    execSync('npm run build', { cwd, stdio: 'inherit' });
    return true;
  } catch {
    return false;
  }
}

function getViewport(pluginName) {
  const manifestPath = path.join(pluginsDir, pluginName, 'manifest.json');
  if (!fs.existsSync(manifestPath)) return { width: 800, height: 600 };
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const w = manifest.window?.width ?? 800;
  const h = manifest.window?.height ?? 600;
  return { width: w, height: h };
}

async function screenshotOne(browser, pluginName, port) {
  const uiDir = path.join(pluginsDir, pluginName, 'ui');
  const { url, close } = await serveStatic(uiDir, port);

  const page = await browser.newPage();
  const viewport = getViewport(pluginName);
  await page.setViewport({
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: 2,
  });

  try {
    await page.goto(url, {
      waitUntil: 'networkidle0',
      timeout: 15000,
    });
    // 等待根节点有内容（React 等渲染完成）
    await page.waitForFunction(
      () => {
        const root = document.getElementById('root');
        return root && root.children.length > 0;
      },
      { timeout: 8000 },
    ).catch(() => {
      // 超时也继续截图，可能只是骨架或空状态
    });

    const screenshotsDir = path.join(pluginsDir, pluginName, 'screenshots');
    fs.mkdirSync(screenshotsDir, { recursive: true });
    const outPath = path.join(screenshotsDir, '1.png');
    await page.screenshot({ path: outPath, type: 'png' });
    // v2 索引：同名的 .txt 作为该截图的 caption，不存在则创建占位
    const captionPath = path.join(screenshotsDir, '1.txt');
    if (!fs.existsSync(captionPath)) {
      fs.writeFileSync(captionPath, '主界面\n', 'utf8');
    }
    return { plugin: pluginName, path: outPath };
  } finally {
    await page.close();
    await close();
  }
}

async function main() {
  const puppeteer = require('puppeteer');
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const candidates = args.length > 0 ? args : getPluginsWithUiToScreenshot();

  if (candidates.length === 0) {
    console.error('未找到可截图的插件（需有 package.json、build 脚本且 manifest 含 ui 字段），或请指定插件名。');
    process.exit(1);
  }

  console.log('待处理插件:', candidates.join(', '));
  console.log('');

  for (const name of candidates) {
    const pkgPath = path.join(pluginsDir, name, 'package.json');
    if (!fs.existsSync(pkgPath)) {
      console.warn(`跳过 ${name}：缺少 package.json`);
      continue;
    }
    if (!hasManifestUi(name)) {
      console.warn(`跳过 ${name}：无 UI（仅后端插件）`);
      continue;
    }
    console.log(`[${name}] build...`);
    if (!buildPlugin(name)) {
      console.warn(`跳过 ${name}：build 失败`);
      continue;
    }
    const uiIndex = path.join(pluginsDir, name, 'ui', 'index.html');
    if (!fs.existsSync(uiIndex)) {
      console.warn(`跳过 ${name}：build 后仍无 ui/index.html`);
      continue;
    }
    console.log(`[${name}] build 完成`);
  }

  console.log('');
  console.log('开始截图...');
  const launchOpts = {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  };
  if (process.platform === 'darwin') {
    const systemChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    if (fs.existsSync(systemChrome)) launchOpts.executablePath = systemChrome;
  }
  const browser = await puppeteer.launch(launchOpts);

  let port = 18765;
  const results = [];
  for (const name of candidates) {
    const uiIndex = path.join(pluginsDir, name, 'ui', 'index.html');
    if (!fs.existsSync(uiIndex)) continue;
    try {
      const r = await screenshotOne(browser, name, port++);
      results.push(r);
      console.log('  ✓', name, '->', r.path);
    } catch (e) {
      console.error('  ✗', name, e.message);
    }
  }

  await browser.close();
  console.log('\n完成，共', results.length, '张截图');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
