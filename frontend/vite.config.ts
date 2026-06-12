import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const sharedPath = process.env.SHARED_PATH ?? path.resolve(__dirname, '../shared')

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    'import.meta.env.VITE_ADMIN_TOKEN': JSON.stringify(process.env.ADMIN_API_TOKEN ?? ''),
  },
  resolve: {
    alias: {
      '@shared': sharedPath,
    },
  },
  server: {
    fs: {
      allow: ['..'],
    },
  },
})
