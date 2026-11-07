// Test-only, for the ••• sheet and the saved view. No account use.
function observeMenu() {
  const trace = window.__zenMenuTrace = { first: null };
  function tick() {
    const root = document.documentElement, svg = document.querySelector('.besogo-board > svg');
    if (!trace.first && root?.dataset.zenReady === 'on' && !root.dataset.zenPreparing && svg && getComputedStyle(svg).opacity !== '0')
      trace.first = { view: root.dataset.zenView, width: svg.viewBox.baseVal.width, rotation: window.besogo?.scaleParameters?.rotation };
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
  window.__zenView = () => { const b = document.querySelector('.besogo-board > svg').viewBox.baseVal, g = document.querySelector('.besogo-board > svg rect.besogo-svg-lines'); return { width: b.width, whole: Math.abs(b.width - (2 * +g.getAttribute('x') + +g.getAttribute('width'))) < .5, saved: document.documentElement.dataset.zenView, rotation: besogo.scaleParameters.rotation }; };
  // Guests have no comment section, so this stands in for the site's React section:
  // same id, class names, place in More, event and buttons. Clearly not real data.
  window.__zenFixtureComments = () => {
    if (document.querySelector('#commentSpace')) return;
    const root = document.createElement('div'); root.id = 'commentSpace'; root.className = 'tsumego-comments-section zen-test-fixture';
    root.innerHTML = '<div class="tsumego-comments__tabs"><button class="tsumego-comments__tab" data-filter="open">Comments (2)</button></div><div class="tsumego-comments__content" style="display:none"></div>';
    window.__zenFixture ??= { opened: 0, filter: null };
    if (!window.__zenFixtureListening) { window.__zenFixtureListening = true; window.addEventListener('comments-open', () => {
      const space = document.querySelector('#commentSpace'); __zenFixture.opened++;
      space.querySelector('.tsumego-comments__tab').classList.add('active');
      setTimeout(() => {
        const content = space.querySelector('.tsumego-comments__content'); content.style.display = '';
        content.innerHTML = '<button class="tsumego-comments__anchor-btn">All</button><button class="tsumego-comments__anchor-btn">General</button><button class="tsumego-comments__anchor-btn">Here &amp; ahead</button><p>Test fixture, not a real comment.</p>';
        for (const button of content.querySelectorAll('button')) button.onclick = () => { __zenFixture.filter = button.textContent; };
      }, 250);
    }); }
    document.querySelector('#editSection').append(root);
  };
  // The states the site prints, on its real tile elements.
  window.__zenPaintTiles = rungs => {
    const items = [...document.querySelectorAll('.problem-nav__item')], states = ['N', 'V', 'S', 'C', 'W', 'F', 'X', 'G'];
    states.forEach((state, i) => {
      const item = items[i]; if (!item) return;
      item.className = `problem-nav__item problem-nav__item--${state}`;
      if (!rungs) return;
      const link = item.querySelector('a'); link.classList.add('problem-nav__rung-link');
      for (const extra of link.querySelectorAll('.problem-nav__ratio, .problem-nav__time, .problem-nav__rung')) extra.remove();
      const badge = document.createElement('div'); badge.className = `problem-nav__rung${i === 1 ? ' problem-nav__rung--missed' : i === 2 ? ' problem-nav__rung--graduated' : ''}`;
      badge.innerHTML = '<svg width="16" height="8" viewBox="0 0 16 8"><path d="M1 7 8 1l7 6" fill="none" stroke="currentColor" stroke-width="2"/></svg>';
      link.append(badge);
    });
    return items.length;
  };
  window.__zenTiles = () => [...document.querySelectorAll('.problem-nav__item')].slice(0, 8).map(item => {
    const link = item.querySelector('a'), number = item.querySelector('.problem-nav__number'), rung = item.querySelector('.problem-nav__rung');
    const box = item.getBoundingClientRect(), a = link.getBoundingClientRect(), range = document.createRange(); range.selectNodeContents(number);
    const text = range.getBoundingClientRect(), r = rung?.getBoundingClientRect();
    return { box: [box.width, box.height], link: [a.width, a.height, a.left - box.left, a.top - box.top], x: text.left + text.width / 2 - box.left - box.width / 2, y: text.top + text.height / 2 - box.top - box.height / 2,
      rung: r ? [r.width, r.height, r.left + r.width / 2 - box.left - box.width / 2, r.top - box.top] : null };
  });
}
