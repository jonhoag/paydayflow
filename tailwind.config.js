// Used only by build-css.js to generate tailwind.css from the class names in index.html, net.js and app.js.
module.exports = {
  content: ['./index.html', './net.js', './app.js'],
  darkMode: 'class',
};
