import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { loadMobileEnv } from './scripts/mobile-env.js';

function capacitorAppEntry() {
  return {
    name: 'capacitor-app-entry',
    async closeBundle() {
      const appHtmlPath = resolve('dist-mobile/app/index.html');
      const rootHtmlPath = resolve('dist-mobile/index.html');
      const appHtml = await readFile(appHtmlPath, 'utf8');

      await writeFile(rootHtmlPath, appHtml.replaceAll('../', './'));
      await rm(resolve('dist-mobile/app'), { recursive: true, force: true });
      await mkdir(resolve('dist-mobile/assets'), { recursive: true });
      await copyFile(resolve('public/robots.txt'), resolve('dist-mobile/robots.txt')).catch(() => {});
    }
  };
}

export default defineConfig(({ mode }) => {
  loadMobileEnv(process.cwd(), mode);
  return {
    base: './',
    plugins: [react(), capacitorAppEntry()],
    publicDir: false,
    build: {
      outDir: 'dist-mobile',
      emptyOutDir: true,
      rollupOptions: {
        input: {
          index: 'app/index.html'
        }
      }
    }
  };
});
