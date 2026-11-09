// Frame guard, loaded first by index.html (see the note there): in another website's frame the page stays blank and
// never starts (app.js checks PF_FRAMED). Kept out of app.js so it runs before the page is drawn.
if (window.top !== window.self && !/\.googleusercontent\.com$/.test(location.hostname)) {
  window.PF_FRAMED = true;
  document.documentElement.style.display = 'none';
}
