import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  // Canonical origin baked into index.html. Defaults to the official site so
  // existing builds are unchanged; set VITE_SITE_URL for a self-hosted domain.
  const siteUrl = (env.VITE_SITE_URL || 'https://dkit.name.ng').replace(/\/+$/, '')

  return {
    plugins: [
      react(),
      {
        name: 'site-url',
        transformIndexHtml: (html) => html.replaceAll('%SITE_URL%', siteUrl),
      },
    ],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, './src'),
      },
    },
    server: {
      allowedHosts: ['.ngrok-free.dev', '.ngrok-free.app', 'localhost', 'dkit.name.ng'],
      proxy: {
        '/api': 'http://localhost:3001',
      },
    },
  }
})
