import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from "path"
// 引入压缩插件
import viteCompression from 'vite-plugin-compression'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // 添加压缩配置
    viteCompression({
      verbose: true,        // 在控制台输出压缩结果
      disable: false,       // 是否禁用
      threshold: 10240,     // 体积大于 10kb 才进行压缩 (单位b)
      algorithm: 'gzip',    // 压缩算法，对应 Nginx 的 gzip
      ext: '.gz',           // 生成的文件后缀
      deleteOriginalAssets: false // 【重要】不要删除源文件，Nginx 需要保留源文件作为回退
    })
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    sourcemap: false,
    // 建议：生产环境构建时通常可以关闭 sourcemap 以减小体积和保护源码，
    // 如果你需要调试线上问题保留为 true 也可以。
    // sourcemap: false, 
  },
  server: {
    host: '0.0.0.0',
    port: 5175,
    proxy: {
      '/api': {
        // 使用环境变量或默认值
        target: process.env.VITE_BACKEND_URL || 'http://localhost:5001',
        changeOrigin: true,
        secure: false,
      }
    },
    allowedHosts: 'all',
  }
})