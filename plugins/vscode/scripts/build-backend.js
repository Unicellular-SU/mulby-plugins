const esbuild = require('esbuild');
const path = require('path');

const outDir = path.resolve(__dirname, '../dist');

esbuild.build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  platform: 'node',
  target: 'node18',
  outfile: path.join(outDir, 'main.js'),
  format: 'cjs',
  external: ['sql.js'],
  sourcemap: false,
  minify: false,
}).then(() => {
  console.log('Backend built successfully!');
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
