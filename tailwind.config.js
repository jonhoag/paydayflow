// Used only by build-css.js to generate tailwind.css from the class names in index.html and app.js.
module.exports = {
  content: ['./index.html', './app.js'],
  darkMode: 'class',
};
