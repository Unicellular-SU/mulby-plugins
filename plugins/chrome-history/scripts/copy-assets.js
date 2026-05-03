const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const distDir = path.join(root, 'dist');
const uiDir = path.join(root, 'ui');

function copyRecursive(source, target) {
  const stat = fs.statSync(source);
  if (stat.isDirectory()) {
    fs.mkdirSync(target, { recursive: true });
    for (const child of fs.readdirSync(source)) {
      copyRecursive(path.join(source, child), path.join(target, child));
    }
    return;
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

fs.mkdirSync(distDir, { recursive: true });

copyRecursive(path.join(root, 'icon'), path.join(distDir, 'icon'));
copyRecursive(path.join(root, 'icon'), path.join(uiDir, 'icon'));
copyRecursive(path.join(root, 'lib'), path.join(distDir, 'third_party/sqljs'));

console.log('Assets copied successfully.');
