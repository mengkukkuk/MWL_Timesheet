// Tailwind config for the locally-built replacement of the old
// `<link href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/...">` CDN
// include in templates/app.html. Pinned to the exact same tailwindcss@2.2.19
// version and default theme (no `theme.extend`, no plugins) so purging only
// removes UNUSED selectors — it does not change any utility's definition.
// Output is written to ../static/tailwind.css (see package.json's "build:css"
// script), not through Vite, so it keeps the same <head> position/order as
// the CDN link did (before static/style.css, which is written to extend it).
module.exports = {
  purge: {
    enabled: true,
    content: ['./index.html', './src/**/*.{ts,tsx}'],
  },
  darkMode: false,
  theme: {},
  variants: {},
  plugins: [],
}
