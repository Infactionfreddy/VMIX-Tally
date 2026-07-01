import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  root: 'src/frontend',
  plugins: [svelte()],
  build: {
    outDir: '../../dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/overrides': 'http://localhost:3000',
      '/config': 'http://localhost:3000',
      '/test': 'http://localhost:3000',
      '/vmix': 'http://localhost:3000',
      '/ws': { target: 'ws://localhost:3000', ws: true },
    },
  },
});
