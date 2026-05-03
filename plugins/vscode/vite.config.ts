import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  root: 'src/ui',
  base: './',
  plugins: [react()],
  build: {
    outDir: resolve(__dirname, 'ui'),
    emptyOutDir: true,
  },
});
