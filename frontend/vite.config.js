import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('error', (error) => {
            console.error('[vite-proxy:/api] error:', error.message)
          })
        },
      },
      '/ws': {
        target: 'http://localhost:3000',
        ws: true,
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('error', (error) => {
            console.error('[vite-proxy:/ws] error:', error.message)
          })
          proxy.on('proxyReqWs', (_proxyReq, req) => {
            console.log(`[vite-proxy:/ws] upgrade ${req.url ?? '/ws'}`)
          })
        },
      },
    },
  },
})
