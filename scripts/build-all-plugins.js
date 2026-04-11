/**
 * 多包 workspace：先在仓库根执行一次 pnpm install，再对每个有 build 脚本的插件执行 pnpm run build。
 * 若插件没有 package.json 或没有 build 脚本，则跳过。
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const pluginsDir = path.join(repoRoot, 'plugins');
const dirs = fs.readdirSync(pluginsDir).filter((name) => {
  return fs.statSync(path.join(pluginsDir, name)).isDirectory();
});

console.log('📦 在仓库根安装 workspace 依赖（pnpm install）...');
try {
  execSync('pnpm install', { cwd: repoRoot, stdio: 'inherit' });
} catch {
  console.error('❌ 根目录 pnpm install 失败（请确认已安装 pnpm，且与 package.json 中 packageManager 版本一致）');
  process.exit(1);
}

let success = 0;
let skipped = 0;
let failed = 0;

for (const dir of dirs) {
  const pluginPath = path.join(pluginsDir, dir);
  const pkgPath = path.join(pluginPath, 'package.json');

  // 检查是否存在 package.json
  if (!fs.existsSync(pkgPath)) {
    console.log(`⏭  跳过 ${dir}（无 package.json）`);
    skipped++;
    continue;
  }

  // 检查是否有 build 脚本
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    if (!pkg.scripts || !pkg.scripts.build) {
      console.log(`⏭  跳过 ${dir}（无 build 脚本）`);
      skipped++;
      continue;
    }
  } catch {
    console.log(`⏭  跳过 ${dir}（package.json 解析失败）`);
    skipped++;
    continue;
  }

  console.log(`\n🔨 正在构建 ${dir} ...`);
  try {
    execSync('pnpm run build', { cwd: pluginPath, stdio: 'inherit' });
    console.log(`✅ ${dir} 构建成功`);
    success++;
  } catch {
    console.error(`❌ ${dir} 构建失败`);
    failed++;
  }
}

console.log(`\n========== 构建完成 ==========`);
console.log(`✅ 成功: ${success}  ⏭ 跳过: ${skipped}  ❌ 失败: ${failed}`);

if (failed > 0) {
  process.exit(1);
}
