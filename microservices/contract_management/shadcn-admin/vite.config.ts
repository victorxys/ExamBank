import path from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    tanstackRouter({
      target: 'react',
      autoCodeSplitting: true,
    }),
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    proxy: {
      '/api/login': {
        target: 'http://localhost:5001',
        changeOrigin: true,
      },
      '/api/v1/contracts': {
        target: 'http://localhost:8002',
        changeOrigin: true,
      },
      '/api/v1/customers': {
        target: 'http://localhost:8001',
        changeOrigin: true,
      },
      '/api/v1/employees': {
        target: 'http://localhost:8003',
        changeOrigin: true,
      },
    },
  },
})
