import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

// The renderer is loaded from disk by Electron, so every asset reference has to
// be relative -- an absolute '/assets/...' resolves against the filesystem root
// under file:// and silently 404s.
export default defineConfig({
  root: resolve(process.cwd(), 'src/renderer'),
  base: './',
  plugins: [react()],
  build: {
    outDir: resolve(process.cwd(), 'dist/renderer'),
    emptyOutDir: true,
    target: 'chrome128',
    rollupOptions: {
      input: {
        notch: resolve(process.cwd(), 'src/renderer/notch.html'),
        settings: resolve(process.cwd(), 'src/renderer/settings.html')
      }
    }
  }
});
