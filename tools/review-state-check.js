// Test-only. Runs the real native build path with Review enabled at load on
// chosen pages, as the server's $solved option does. No account or requests.
function observeReviewState(enabledPaths) {
  const force = enabledPaths.includes(location.pathname);
  let engine;
  Object.defineProperty(window, 'besogo', { configurable: true, get: () => engine, set(value) {
    engine = value;
    let create = value?.create;
    if (force && value) Object.defineProperty(value, 'create', { configurable: true,
      get: () => create && ((div, options) => { options.reviewEnabled = true; return create.call(value, div, options); }),
      set(next) { create = next; } });
  } });
  const trace = window.__zenReviewTrace = { path: location.pathname, frames: 0, mismatches: [] };
  window.__zenReviewState = () => {
    const native = document.querySelector('[id^="besogo-review-button"]'), ours = document.querySelector('.zen-review');
    const context = document.querySelector('.zen-context')?.getBoundingClientRect();
    return { active: !!native && !native.id.endsWith('-inactive') && !native.disabled, nativeId: native?.id,
      visible: !!ours && getComputedStyle(ours).display !== 'none', reviewing: window.besogo?.editor?.getReviewMode?.() === true,
      contextRight: context?.right };
  };
  function tick() {
    const root = document.documentElement;
    if (root?.dataset.zenReady === 'on' && !root.dataset.zenPreparing && root.dataset.zen === 'on') {
      const state = __zenReviewState(); trace.frames++;
      if (state.visible !== (state.active || state.reviewing)) trace.mismatches.push(state);
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}
