// Used only by build-css.js to generate tailwind.css from the class names in index.html and the app's scripts (APP_SCRIPTS in build-sw.js).
module.exports = {
  content: ['./index.html', ...require('./build-sw').APP_SCRIPTS.map(f => './' + f)],
  darkMode: 'class',
};
