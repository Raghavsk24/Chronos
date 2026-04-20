import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (id.includes('firebase')) return 'vendor-firebase'
          if (id.includes('react-router')) return 'vendor-router'
          if (id.includes('@base-ui') || id.includes('react-day-picker') || id.includes('sonner')) {
            return 'vendor-ui'
          }
          if (id.includes('react-dom') || id.includes('/react/')) return 'vendor-react'
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
