import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        landing: 'index.html',
        privacy: 'privacy/index.html',
        app: 'app/index.html'
      }
    }
  },
  server: {
    port: 5173
  }
});
