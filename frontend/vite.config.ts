import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import type { Socket } from 'net'

// Suppress noisy ECONNRESET errors from WebSocket proxy
// These occur normally when connections close (client disconnect, backend restart, etc.)
function silenceSocketErrors(socket: Socket) {
  socket.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'ECONNRESET') return
    console.error('[proxy socket error]', err)
  })
}

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true, // Listen on all interfaces (needed for Cloudflare tunnel)
    allowedHosts: ['deepgram.joshwentworth.com'],
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
      '/stream': {
        target: 'ws://localhost:3001',
        ws: true,
        configure: (proxy) => {
          proxy.on('error', () => {}) // Silence proxy-level errors
          proxy.on('proxyReqWs', (_proxyReq, _req, socket) => {
            silenceSocketErrors(socket as Socket)
          })
        },
      },
      '/jobs': {
        target: 'ws://localhost:3001',
        ws: true,
        configure: (proxy) => {
          proxy.on('error', () => {}) // Silence proxy-level errors
          proxy.on('proxyReqWs', (_proxyReq, _req, socket) => {
            silenceSocketErrors(socket as Socket)
          })
        },
      },
    },
  },
})
