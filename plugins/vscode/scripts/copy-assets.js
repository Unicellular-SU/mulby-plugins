const fs = require('fs');
const path = require('path');

const srcDir = path.resolve(__dirname, '..');
const distDir = path.resolve(__dirname, '../dist');
const srcDirAlt = path.resolve(__dirname, '../src');

// Directories to copy to dist
const copyToDist = ['icon'];

// Copy third_party (sql.js WASM)
const thirdPartySrc = path.join(srcDirAlt, 'third_party');
const thirdPartyDest = path.join(distDir, 'third_party');

// Copy icon dir to ui for frontend use
const iconSrc = path.join(srcDir, 'icon');
const iconDest = path.join(srcDir, 'ui', 'icon');

if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

function copyRecursive(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }
    fs.readdirSync(src).forEach((child) => {
      copyRecursive(path.join(src, child), path.join(dest, child));
    });
  } else {
    fs.copyFileSync(src, dest);
  }
}

// Copy to dist
copyToDist.forEach((asset) => {
  const srcPath = path.join(srcDir, asset);
  const destPath = path.join(distDir, asset);
  if (fs.existsSync(srcPath)) {
    console.log(`Copying ${asset} to dist...`);
    copyRecursive(srcPath, destPath);
  }
});

// Copy third_party (sql.js) to dist
if (fs.existsSync(thirdPartySrc)) {
  console.log('Copying third_party to dist...');
  copyRecursive(thirdPartySrc, thirdPartyDest);
}

// Copy icon to ui for frontend
console.log('Copying icon to ui...');
copyRecursive(iconSrc, iconDest);

console.log('Assets copied successfully!');
