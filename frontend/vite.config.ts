import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
// Ports come from the central registry (slot 05).
export default defineConfig({
  plugins: [tailwindcss()],
  server: {
    port: 5205,
    strictPort: true,
    proxy: { '/api': process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:3105' },
  },
});
