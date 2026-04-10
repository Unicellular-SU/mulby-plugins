/**
 * 遍历 plugins 目录下的所有插件，依次执行 npm run build。
 * 如果插件没有 package.json 或没有 build 脚本，则跳过。
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const pluginsDir = path.resolve(__dirname, '..', 'plugins');
const dirs = fs.readdirSync(pluginsDir).filter((name) => {
  return fs.statSync(path.join(pluginsDir, name)).isDirectory();
});

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

  // 执行 npm run build
  console.log(`\n🔨 正在构建 ${dir} ...`);
  try {
    execSync('npm run build', { cwd: pluginPath, stdio: 'inherit' });
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
