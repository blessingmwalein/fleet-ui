import path from 'node:path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, 'src') },
  },
  server: {
    // Errors still surface in the console; the full-screen overlay gets in the way of automated screenshots.
    hmr: { overlay: false },
  },
  build: {
    chunkSizeWarningLimit: 1500,
  },
})
