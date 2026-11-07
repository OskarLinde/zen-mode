// Called only by the isolated macOS WebKit host after visible-frame preflight.
// Exercises real anonymous site behavior; these DOM clicks are not device taps.
async function checkVisibleReview({ playOnly = false } = {}) {
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms)), checks = [];
  const q = selector => document.querySelector(selector), e = window.besogo.editor;
  function foreground() {
    if (document.visibilityState !== 'visible' || !document.hasFocus() ||
        performance.now() - window.__zenProbe.lastFrame > 1000)
      throw Error('ENVIRONMENT: foreground rendering stopped');
  }
  function check(ok, label) { foreground(); if (!ok) throw Error(label); checks.push(label); }
  async function wait(predicate) {
    const deadline = performance.now() + 6500;
    while (performance.now() < deadline) { foreground(); if (predicate()) return; await pause(70); }
    throw Error('Native Review did not reach the expected state');
  }
  check((window.besogoNoLogin===true||window.besogoUserId===0), 'Anonymous actual-site context');
  async function hit(move) {
    foreground();
    const svg = q('.besogo-board > svg'), grid = svg.querySelector('rect.besogo-svg-lines');
    const step = +grid.getAttribute('width') / (e.getRoot().getSize().x - 1);
    const p = new DOMPoint(+grid.getAttribute('x') + (move.x-1)*step,
      +grid.getAttribute('y') + (move.y-1)*step).matrixTransform(svg.getScreenCTM());
    const target = document.elementFromPoint(p.x, p.y);
    window.__zenLastHit = { move, point: [p.x,p.y], target: target?.outerHTML.slice(0,400) };
    check(!!target?.closest('.besogo-board'), 'Move maps to visible native board');
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: p.x, clientY: p.y }));
    await pause(700);
  }
  await hit(e.getRoot().children.find(n => !n.canStillEndCorrect()).move);
  check(q('#status').textContent.includes('Incorrect'), 'Native failure is visible');
  q('.zen-reset').click(); await pause(100);
  check(e.getCurrent() === e.getRoot(), 'Native Reset restores root');
  for (let i=0; i<8 && !q('#status').textContent.includes('Correct!'); i++) {
    const next = e.getCurrent().children.find(n => n.canStillEndCorrect());
    if (!next) break; await hit(next.move);
  }
  check(q('#status').textContent.includes('Correct!') && location.pathname === '/5193', 'Multi-step success waits for manual advance');
  q('.zen-review').click();
  await wait(() => e.getReviewMode() && !q('.zen-review').hasAttribute('aria-busy'));
  const tree = q('.besogo-tree'), last = e.getCurrent();
  check(q('.zen-review-tree').contains(tree) && tree.getBoundingClientRect().height > 0, 'Original Review tree is visibly connected');
  const treeBox = tree.getBoundingClientRect(), paneBox = q('.zen-review-tree').getBoundingClientRect();
  check(treeBox.bottom <= paneBox.bottom + 1 && tree.scrollHeight > tree.clientHeight, 'Large tree scrolls in its own box, inside the pane');
  // On iOS the page is pinned at the edge-strip offset rather than 0: it must simply not move.
  const shown = tree.scrollTop, page = document.scrollingElement.scrollTop; tree.scrollTop = shown ? 0 : 40; await pause(120);
  check(tree.scrollTop !== shown && document.scrollingElement.scrollTop === page, 'Tree scrolls without moving the page'); tree.scrollTop = shown;
  q('.zen-rewind').click(); await pause(150);
  check(e.getCurrent() === last.parent && e.getCurrent().navTreeMarker.classList.contains('zen-current-tree-node'), 'Review Back changes node and highlights current position');
  q('.zen-forward').click(); await pause(150);
  check(e.getCurrent() === last, 'Review Forward restores the line');
  [...q('.zen-toolbar').querySelectorAll('button')].find(b => b.textContent === 'Site page').click(); await pause(150);
  check(document.documentElement.dataset.zen === 'off' && q('#target').contains(tree) && e.getCurrent() === last, 'Regular mode restores original tree and retains position');
  q('.zen-resume').click(); await pause(150);
  check(q('.zen-review-tree').contains(tree) && e.getCurrent() === last, 'Zen mode resumes Review in place');
  // The rest covers wide-window menus, not available at phone width.
  if (playOnly) return { checks };
  const coordinates = [...q('.zen-toolbar').querySelectorAll('button')].find(b => b.textContent === 'Coordinates');
  const originalCoordinates = coordinates.getAttribute('aria-pressed') === 'true';
  const mapping = () => {
    const svg = q('.besogo-board > svg'), m = svg.getScreenCTM();
    return JSON.stringify([svg.getAttribute('viewBox'), m.a, m.b, m.c, m.d, m.e, m.f]);
  };
  for (const enabled of [true, false]) {
    if ((coordinates.getAttribute('aria-pressed') === 'true') !== enabled) coordinates.click();
    await pause(100);
    const trigger = q('.zen-nav-trigger'), n = trigger.getBoundingClientRect();
    const options = q('.zen-options summary').getBoundingClientRect(), bar = q('.zen-toolbar').getBoundingClientRect();
    check(n.width >= 44 && n.height >= 44 && n.top >= bar.top && n.right <= options.left &&
      options.right <= q('.zen-context').getBoundingClientRect().left, `Coordinates ${enabled}: wide menu targets stay in the bar, clear of the board`);
    const before = mapping(), header = q('.whitebox1'), parent = header.parentNode;
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    trigger.click(); await pause(100);
    const navigation = q('.zen-navigation-sheet');
    check(navigation.open && navigation.contains(header) && e.getCurrent() === last && location.pathname === '/5193',
      `Coordinates ${enabled}: native navigation opens without playing or advancing`);
    navigation.querySelector('header button').click(); await pause(100);
    check(header.parentNode === parent && document.activeElement === trigger && mapping() === before,
      `Coordinates ${enabled}: menu close restores native header, focus and exact board mapping`);
  }
  if ((coordinates.getAttribute('aria-pressed') === 'true') !== originalCoordinates) coordinates.click();
  await pause(100);
  q('.zen-options summary').click(); await pause(100);
  const sheet = q('.zen-problem-sheet').getBoundingClientRect();
  check(q('.zen-problem-sheet').open && sheet.top >= 0 && sheet.bottom <= innerHeight, 'Native options are reachable');
  q('.zen-problem-sheet').close();
  window.__zenReviewPosition = last;
  return { checks, viewport: [innerWidth, innerHeight] };
}
