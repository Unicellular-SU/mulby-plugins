const esbuild = require('esbuild');
const path = require('path');

esbuild.build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  platform: 'node',
  target: 'node18',
  outfile: path.resolve(__dirname, '../dist/main.js'),
  format: 'cjs',
  external: ['electron'],
  sourcemap: false,
  minify: false
}).then(() => {
  console.log('Backend built successfully.');
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
