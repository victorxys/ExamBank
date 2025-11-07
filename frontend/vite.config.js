import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('@mui')) {
              return 'vendor-mui';
            }
            return 'vendor';
          }
        }
      }
    }
  },
  server: {
    host: '0.0.0.0',
    port: 5175,
    proxy: {
      '/api': { // 所有以 /api 开头的请求
        target: 'http://localhost:5001', // 代理到您的后端
        changeOrigin: true, // 需要改变请求头中的 Origin，使其看起来像是从代理服务器发出的
      }
    },
    allowedHosts: [
      // 'allin.xys.one',   // 允许通过 allin.xys.one 访问
      'dev.mengyimengsao.top',
      'test-school.mengyimengsao.top',
      'localhost',        // 允许 localhost 访问
      '127.0.0.1',       //允许127.0.0.1访问
      '192.168.1.105', // 如果需要通过内网 IP 访问，取消注释此行并替换为你的实际内网 IP
    ],
  }
})
