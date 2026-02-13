import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        // Don't rewrite - server expects /api/v2 routes
      },
      '/audio': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/cache': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/temp': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
})
