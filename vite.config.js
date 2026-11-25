import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the build also works from a sub-path (e.g. GitHub Pages).
  base: './',
  server: { port: 5173, open: false },
  // three.js alone is ~700 kB minified; don't warn about it.
  build: { chunkSizeWarningLimit: 1200 },
});
