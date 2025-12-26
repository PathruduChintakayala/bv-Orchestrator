import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Proxy API calls to FastAPI running on port 8000
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        // Keep the /api prefix so it matches backend routes
      },
    },
  },
})
