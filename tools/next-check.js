// Test-only. A debugger can't read a page during a navigation, so the page logs itself.
function observeNext() {
  const log = window.__nextLog = [];
  let pressed = 0;
  const mark = () => { pressed ||= Date.now(); };
  addEventListener('pointerdown', event => { if (event.target.closest?.('.zen-next')) mark(); }, true);
  addEventListener('keydown', event => { if (event.key === 'ArrowRight') mark(); }, true);
  window.__nextMark = mark;
  setInterval(() => {
    const button = document.querySelector('.zen-next');
    if (!button || !pressed) return;
    const style = getComputedStyle(button), after = getComputedStyle(button, '::after'), box = button.getBoundingClientRect();
    log.push({ at: Date.now() - pressed, busy: button.getAttribute('aria-busy'), color: style.color, after: after.content, animation: after.animationName,
      box: [box.left, box.top, box.width, box.height].join(), disabled: button.disabled, cover: !!document.querySelector('.zen-mode-handoff') });
    // Also save as it goes: WebKit may not keep a write made during pagehide.
    try { sessionStorage.setItem('zen-next-log', JSON.stringify(log)); } catch {}
  }, 50);
  addEventListener('pagehide', () => { if (log.length) sessionStorage.setItem('zen-next-log', JSON.stringify(log)); });
}
