import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Listen on all interfaces so another device on the same LAN can reach the dev server
    // (Vite prints a "Network:" URL on start). The API stays on localhost — Vite proxies /api to it
    // server-side, so LAN clients only ever talk to Vite and no CORS/API change is needed.
    host: true,
    proxy: {
      "/api": "http://127.0.0.1:4000",
    },
  },
})
