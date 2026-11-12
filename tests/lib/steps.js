// The step counter every test file uses: step(name, fn) runs one check and records whether it passed (with the first
// lines of the error if not); a failed check never stops the run. fn may be plain or async: a plain one is recorded
// at once, an async one when it settles (await the step). finish() prints every result and the count, and exits 1 if
// any failed or one is still running (an async step that wasn't awaited would otherwise never count). onFail(name) runs after a failed check, e.g. to save a screenshot. No dependencies, so Node-only tests
// can use it too.
function makeSteps({ onFail } = {}) {
  const results = [];
  let running = 0;
  const failed = (name, e) => {
    results.push([false, name + '\n      ' + String(e && e.message).split('\n').slice(0, 4).join('\n      ')]);
    if (onFail) return onFail(name);
  };
  function step(name, fn) {
    let out;
    try { out = fn(); } catch (e) { return failed(name, e); }
    if (!out || typeof out.then !== 'function') { results.push([true, name]); return; }
    running++;
    return out.then(() => { running--; results.push([true, name]); }, e => { running--; return failed(name, e); });
  }
  function finish() {
    if (running) results.push([false, running + ' step(s) still running at the end: await each async step']);
    const bad = results.filter(([ok]) => !ok).length;
    results.forEach(([ok, name]) => console.log((ok ? '  PASS  ' : '  FAIL  ') + name));
    console.log(`\n${results.length - bad}/${results.length} passed`);
    process.exit(bad ? 1 : 0);
  }
  return { step, finish };
}

module.exports = { makeSteps };
