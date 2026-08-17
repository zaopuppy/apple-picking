import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: 5188,
    strictPort: true,
    proxy: {
      '/socket.io': {
        target: 'http://127.0.0.1:5190',
        ws: true,
      },
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 4188,
    strictPort: true,
    proxy: {
      '/socket.io': {
        target: 'http://127.0.0.1:5190',
        ws: true,
      },
    },
  },
  build: {
    sourcemap: true,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      input: ['index.html', 'online.html', 'editor.html'],
    },
  },
});
