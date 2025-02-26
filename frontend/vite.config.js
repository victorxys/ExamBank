import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5175,
    allowedHosts: [
      // 'allin.xys.one',   // 允许通过 allin.xys.one 访问
      'dev.mengyimengsao.top',
      'localhost',        // 允许 localhost 访问
      '127.0.0.1',       //允许127.0.0.1访问
      // '192.168.1.104', // 如果需要通过内网 IP 访问，取消注释此行并替换为你的实际内网 IP
    ],
  }
})
