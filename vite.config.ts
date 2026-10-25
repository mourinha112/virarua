import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const raiz = (f: string) => fileURLToPath(new URL(f, import.meta.url));

export default defineConfig({
  server: { port: 5173, host: true, proxy: { '/api': { target: 'http://127.0.0.1:8787', changeOrigin: false } } },
  build: {
    target: 'es2020',
    sourcemap: false,
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      // entradas: o jogo, a página de reivindicação (link de uso único da private reply) e o painel administrativo
      input: { main: raiz('./index.html'), reivindicar: raiz('./reivindicar.html'), admin: raiz('./admin.html') },
      output: {
        manualChunks: { three: ['three'] },
      },
    },
  },
});
