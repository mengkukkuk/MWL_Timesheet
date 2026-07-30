module.exports = {
  purge: {
    enabled: true,
    content: [
      './templates/*.html',
      './static/app.js',
      './static/app/*.js',
    ],
  },
  darkMode: false,
  theme: {
    extend: {},
  },
  plugins: [],
};
