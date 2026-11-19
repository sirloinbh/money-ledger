// Managed file. Edit it in sirloinbh/project-standards templates/app/frontend/
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
// Ports come from the central registry (slot 5). Browser tests run the API on 3205 so a local dev server can keep 3105.
const api = process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:3105';
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5205, strictPort: true, proxy: { '/api': api } },
});
