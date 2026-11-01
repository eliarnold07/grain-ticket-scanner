import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { demoAppPlugin } from './demo/app-plugin.js';

export default defineConfig({
  plugins: [demoAppPlugin(), react()],
  build: {
    rollupOptions: {
      input: {
        landing: 'index.html',
        privacy: 'privacy/index.html',
        support: 'support/index.html',
        app: 'app/index.html',
        demo: 'demo/index.html'
      }
    }
  },
  server: {
    port: 5173
  }
});
