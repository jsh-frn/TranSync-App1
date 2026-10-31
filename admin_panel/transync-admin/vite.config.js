import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),  // ← add this
  ],
  server: {
    proxy: {
      // Any request from the admin panel starting with /api
      // gets forwarded to XAMPP — no CORS issues at all.
      '/api': {
        target: 'http://localhost/TranSync-App/transync-backend',
        changeOrigin: true,
        secure: false,
        // /api/verify.php → http://localhost/TranSync-App/transync-backend/api/verify.php
      },
    },
  }
})