// Test-only, for the WebKit host: Show differently. The host supplies real pointer events.
const zenWait = async (predicate, ms = 4000) => {
  const end = performance.now() + ms;
  while (performance.now() < end) { if (predicate()) return true; await new Promise(resolve => setTimeout(resolve, 50)); }
  return false;
};
async function checkShowDifferently(presses) {
  const checks = [], check = (ok, message) => { if (!ok) throw Error(message); checks.push(message); };
  const shown = () => JSON.stringify(besogo.editor.getTransformationFromSgf()), reset = () => document.querySelector('.zen-reset');
  check(reset().getAttribute('aria-label') === 'Show differently', 'Before a move, Reset reads Show differently');
  const seen = new Set([shown()]);
  for (let i = 1; i <= presses; i++) {
    const before = shown(), title = document.querySelector('.zen-problem').textContent, states = [], start = performance.now();
    const watch = new MutationObserver(() => states.push(`${document.documentElement.dataset.zenHandoff || 'none'}@${Math.round(performance.now() - start)}`));
    let ended = -1; document.addEventListener('zen:reframe-end', () => { ended = Math.round(performance.now() - start); }, { once: true });
    watch.observe(document.documentElement, { attributes: true, attributeFilter: ['data-zen-handoff'] });
    reset().click();
    await zenWait(() => shown() !== before && states.length && !document.documentElement.dataset.zenHandoff, 5000);
    await new Promise(resolve => setTimeout(resolve, 250)); watch.disconnect();
    seen.add(shown());
    check(shown() !== before, `Press ${i} shows something else`);
    check(states.some(state => state.startsWith('moving')), `Press ${i} moves through the board transition: ${states.join(' ')}; reframe-end at ${ended} ms; motion ${document.documentElement.dataset.zenMotion}; reduced ${matchMedia('(prefers-reduced-motion: reduce)').matches}; page transitions ${typeof PageSwapEvent}`);
    check(document.querySelector('.zen-problem').textContent === title, `Press ${i}: the bar keeps its problem title`);
    check(__zenStonesInSgf() === __zenNativeStones, `Press ${i}: stones keep their stored SGF points`);
    check(['C3', 'D16', 'Q4', 'K10'].every(l => besogo.editor.viewLabelToSgf(besogo.editor.sgfLabelToView(l)) === l), `Press ${i}: coordinate labels convert both ways`);
    const text = __zenCommentText(); check(text.shown === text.expected, `Press ${i}: problem text follows the colours, as the site writes it`);
    const p = __zenPlacement(); check(!p.under.length && !p.blocked.length && !p.outside.length, `Press ${i}: nothing playable under ☰, the hearts or off screen`);
  }
  return { checks, seen: seen.size };
}
