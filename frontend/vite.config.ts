// Vite config for the MWL frontend.
// Builds into ../static/react/ with a manifest; Flask's vite_asset() helper
// (app/__init__.py) reads static/react/.vite/manifest.json and injects the
// hashed <script>/<link> tags into the Jinja templates.
//
// Entries during the SPA migration (see C:\Users\mengk\.claude\plans\purring-weaving-pillow.md):
//   - `app`       — the new react-router SPA shell (index.html -> src/main.tsx).
//                   Not yet wired into Flask; app/core.py still serves
//                   templates/index.html via the legacy index() route.
//   - `login`     — existing standalone login island, unchanged.
//   - `dashboard` — existing island mounted inside templates/index.html at
//                   #dashboard-root. Removed once PR2 ports it into `app`.
//   - `worklog`   — existing island mounted inside templates/index.html at
//                   #worklog-view-root. Removed once PR3 ports it into `app`.
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ command }) => ({
  plugins: [react()],
  // Dev server serves from '/', production build is read from /static/react/.
  base: command === 'build' ? '/static/react/' : '/',
  build: {
    outDir: '../static/react',
    emptyOutDir: true,
    manifest: true,
    rollupOptions: {
      input: {
        app: 'index.html',
        login: 'login.html',
        dashboard: 'dashboard.html',
        worklog: 'worklog.html',
      },
      output: {
        // Stable-hash vendor chunks so a code change doesn't bust the
        // react-dom / react-query cache entry on every deploy.
        manualChunks: {
          'react-vendor': ['react', 'react-dom'],
          query: ['@tanstack/react-query'],
        },
      },
    },
  },
  server: {
    proxy: {
      // The Flask CSRF check (verify_api_csrf_origin) trusts the app's own
      // Origin, not the Vite dev server's :5173. `changeOrigin` rewrites the
      // Host header only, not Origin, so we rewrite Origin explicitly here —
      // this keeps the production CSRF check completely untouched.
      '/api': {
        // Flask's own default (see app.py: os.getenv('PORT', 5123)).
        target: 'http://localhost:5123',
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.setHeader('origin', 'http://localhost:5123')
          })
        },
      },
    },
  },
}))
