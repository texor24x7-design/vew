import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {},
  renderer: {
    root: 'src/renderer/shell',
    build: { rollupOptions: { input: resolve(__dirname, 'src/renderer/shell/index.html') } },
    plugins: [react(), tailwindcss()]
  }
})
