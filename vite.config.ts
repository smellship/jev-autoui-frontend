import { fileURLToPath, URL } from 'node:url'

import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

// 开发期把 /api 代理到本地后端；构建产物由后端托管（同源），因此业务代码一律用相对路径
const API_TARGET = process.env.VITE_API_TARGET || 'http://127.0.0.1:8770'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    port: 5273,
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true },
    },
  },
  build: {
    chunkSizeWarningLimit: 2000,
  },
})
