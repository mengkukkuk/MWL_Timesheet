// Vite config for the MWL React islands (login / dashboard / worklog).
// Builds into ../static/react/ with a manifest; Flask's vite_asset() helper
// (app/__init__.py) reads static/react/.vite/manifest.json and injects the
// hashed <script>/<link> tags into the Jinja templates.
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/static/react/',
  build: {
    outDir: '../static/react',
    emptyOutDir: true,
    manifest: true,
    rollupOptions: {
      input: {
        login: 'login.html',
        dashboard: 'dashboard.html',
        worklog: 'worklog.html',
      },
    },
  },
})
