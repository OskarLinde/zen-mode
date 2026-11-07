// Test-only presentation measurement. No awards, account requests or solution data.
function observeReloadShadows() {
  const key = 'zen-test-reload-presentation';
  let expected; try { expected = JSON.parse(sessionStorage.getItem(key)); } catch {}
  const trace = window.__zenReloadTrace = { expected, frames: [], errors: [], events: [] };
  // Why a handoff did or didn't move: layout changes and phase changes, with the board and cover boxes.
  const box = selector => { const r = document.querySelector(selector)?.getBoundingClientRect(); return r && [r.x, r.y, r.width, r.height].map(Math.round).join(); };
  const note = what => trace.events.push({ at: Math.round(performance.now()), what, width: document.documentElement?.clientWidth, inner: innerWidth,
    board: box('#target .besogo-board'), cover: box('.zen-mode-handoff'), copy: !!document.querySelector('.zen-bar-copy') });
  addEventListener('resize', () => note('resize'));
  let lastPhase;
  function presentation(handoff = false) {
    const board = document.querySelector('.besogo-board'), clip = board?.getBoundingClientRect();
    const svg = document.querySelector(handoff ? '.zen-handoff-surface > svg' : '.besogo-board > svg');
    if (!svg || !clip) return null;
    const group = handoff ? svg.querySelector('.zen-handoff-shadows') : svg.querySelector('#markupGroup')?.previousElementSibling?.querySelector(':scope > g');
    const filter = svg.querySelector(handoff ? '#zen-handoff-blur feGaussianBlur' : '#blur feGaussianBlur');
    const circles = [...group?.querySelectorAll('circle') || []].map(el => {
      const m = el.getScreenCTM(), style = getComputedStyle(el);
      const x = +el.getAttribute('cx') * m.a + m.e, y = +el.getAttribute('cy') * m.d + m.f, r = +el.getAttribute('r') * m.a;
      return { x, y, r, blur: +(filter?.getAttribute('stdDeviation') || 0) * m.a, fill: style.fill, opacity: +style.opacity };
    }).filter(p => p.x + p.r > clip.left && p.x - p.r < clip.right && p.y + p.r > clip.top && p.y - p.r < clip.bottom);
    return { shadows: circles.sort((a,b) => a.x-b.x || a.y-b.y),
      labels: [...svg.querySelectorAll(handoff ? '.zen-handoff-coordinates text' : ':scope > text')].map(n => n.textContent) };
  }
  window.__zenSaveReloadExpected = () => {
    expected = presentation(); sessionStorage.setItem(key, JSON.stringify(expected)); return expected;
  };
  // A BFCache restore keeps this closure: read what the departing page saved.
  addEventListener('pageshow', event => {
    if (event.persisted) try { trace.expected = expected = JSON.parse(sessionStorage.getItem(key)); } catch {}
  });
  let marked = false;
  function tick() {
    const phase = document.documentElement?.dataset.zenHandoff;
    if (phase !== lastPhase) { note(`phase ${phase || 'none'}`); lastPhase = phase; }
    // Trace marker: presented frames are counted from the first moving frame.
    if (phase === 'moving' && !marked) { marked = true; performance.mark('zen-moving'); }
    if (!phase) marked = false;
    if (phase && expected) {
      const actual = presentation(true);
      if (actual) {
        if (phase === 'waiting') {
          if (actual.shadows.length !== expected.shadows.length) trace.errors.push('Missing native shadows');
          actual.shadows.forEach((p,i) => {
            const e = expected.shadows[i]; if (!e) return;
            if (['x','y','r','blur','opacity'].some(k => Math.abs(p[k]-e[k]) > .05) || p.fill !== e.fill)
              trace.errors.push('Native shadow appearance differs');
          });
          if (JSON.stringify(actual.labels) !== JSON.stringify(expected.labels)) trace.errors.push('Native coordinates differ');
        }
        const stones = document.querySelectorAll('.zen-handoff-stones > g');
        const shadows = document.querySelectorAll('.zen-handoff-shadows > g');
        if (stones.length !== shadows.length) trace.errors.push('Unpaired stone/shadow layers');
        stones.forEach((s,i) => {
          if (['transform','opacity'].some(k => s.getAttribute(k) !== shadows[i]?.getAttribute(k)))
            trace.errors.push('Shadow choreography differs from stone');
        });
        trace.frames.push({ phase, shadows: actual.shadows.length, labels: actual.labels.length });
      }
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}
