import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// electron-vite's isolatedEntries progress output assumes a terminal and crashes in CI or piped builds.
// ponytail: no-op shim until electron-vite guards these calls itself.
if (!process.stdout.isTTY) {
  Object.assign(process.stdout, {
    clearLine: () => true,
    cursorTo: () => true,
    moveCursor: () => true
  })
}

export default defineConfig({
  main: {},
  preload: {
    build: {
      // Sandboxed preloads can't require sibling files, so each entry must be one standalone file.
      isolatedEntries: true,
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts'),
          overlay: resolve(__dirname, 'src/preload/overlay.ts')
        }
      }
    }
  },
  renderer: {
    root: 'src/renderer',
    build: {
      rollupOptions: {
        input: {
          shell: resolve(__dirname, 'src/renderer/shell/index.html'),
          overlay: resolve(__dirname, 'src/renderer/overlay/index.html')
        }
      }
    },
    plugins: [react(), tailwindcss()]
  }
})
