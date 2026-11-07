// Deterministic viewport/state checks. Fixtures are local; this is not device
// certification or a substitute for an installed extension on the live site.
export async function checkLayouts(frame, assert) {
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const doc = () => frame.contentDocument, state = () => frame.contentWindow.zenReal;
  const wait = async predicate => {
    for (let n = 0; n < 150; n++) { if (predicate()) return; await pause(40); }
    throw Error('Viewport fixture did not become ready');
  };
  const button = text => [...doc().querySelectorAll('.zen-toolbar button')].find(b => b.textContent === text);
  const rect = selector => doc().querySelector(selector).getBoundingClientRect();
  const geometry = await import('../extension/geometry.mjs');
  localStorage.setItem('zen-demo-zenMode', 'on');
  localStorage.setItem('zen-demo-motion', 'off');
  localStorage.setItem('zen-demo-theme', 'plain');
  localStorage.setItem('zen-demo-zenBar', 'glass');
  const initialTime = state()?.loadedAt;
  // This orientation reproduces the former wide coordinate/hamburger overlap.
  frame.src = 'harness/real.html?p=0&orientation=3';
  await wait(() => state()?.number === 0 && state().loadedAt !== initialTime && doc().querySelector('.zen-solved') && !doc().documentElement.dataset.zenPreparing);
  for (const [requestedWidth, requestedHeight] of [[320,568], [440,956], [540,720], [602,800], [603,800], [820,1180], [1180,820], [1024,500], [1280,800], [1600,1000]]) {
    frame.style.width = `${requestedWidth}px`; frame.style.height = `${requestedHeight}px`;
    await pause(100);
    const width = frame.clientWidth, height = frame.clientHeight;
    const tag = `${width}×${height}`, board = rect('.besogo-board'), next = rect('.zen-next');
    assert(board.x === 0 && board.y === 0 && board.width === width && board.height === height,
      `${tag}: Zen mode fills the available viewport, including under glass`);
    assert(next.width >= 44 && next.height >= 44 && next.bottom <= height && doc().documentElement.scrollWidth <= width,
      `${tag}: stable accessible controls with no horizontal overflow`);
    const svg = doc().querySelector('.besogo-board > svg'), outline = svg.querySelector('rect.besogo-svg-lines');
    const matrix = svg.getScreenCTM(), root = state().api.getRoot(), step = +outline.getAttribute('width') / (root.getSize().x - 1);
    const points = geometry.collectGeometry(root).points;
    assert(points.every(p => {
      const x = (+outline.getAttribute('x') + (p.x - 1) * step) * matrix.a + matrix.e;
      const y = (+outline.getAttribute('y') + (p.y - 1) * step) * matrix.d + matrix.f;
      return x >= -.5 && x <= width + .5 && y >= -.5 && y <= rect('.zen-toolbar').top + .5;
    }), `${tag}: stones, labels and all solution moves remain above the controls`);
    const coordinates = () => button('Coordinates');
    const initialCoordinates = coordinates().getAttribute('aria-pressed') === 'true';
    const boardMapping = () => {
      const svg = doc().querySelector('.besogo-board > svg'), m = svg.getScreenCTM();
      return JSON.stringify([svg.getAttribute('viewBox'), m.a, m.b, m.c, m.d, m.e, m.f]);
    };
    for (const enabled of [true, false]) {
      if ((coordinates().getAttribute('aria-pressed') === 'true') !== enabled) coordinates().click();
      await pause(60);
      const nav = doc().querySelector('.zen-nav-trigger'), options = rect('.zen-options summary');
      const n = nav.getBoundingClientRect(), context = rect('.zen-context'), bar = rect('.zen-toolbar');
      const placed = width > 600
        ? n.top >= bar.top && n.bottom <= bar.bottom && n.right <= options.left && options.right <= context.left
        : n.top === 12 && n.left === 12;
      assert(placed && n.width >= 44 && n.height >= 44 && options.width >= 44 && options.height >= 44,
        `${tag}, coordinates ${enabled}: navigation has separate accessible targets and stays out of the wide board`);
      const mapping = boardMapping(), current = state().api.getCurrent(), loadedAt = state().loadedAt;
      const header = doc().querySelector('.sample-header'), parent = header.parentNode;
      nav.dispatchEvent(new frame.contentWindow.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      nav.click(); await pause(40);
      const sheet = doc().querySelector('.zen-navigation-sheet');
      assert(sheet.open && sheet.contains(header) && state().api.getCurrent() === current && state().loadedAt === loadedAt,
        `${tag}, coordinates ${enabled}: navigation opens original elements without playing or advancing`);
      sheet.querySelector('header button').click(); await pause(40);
      assert(header.parentNode === parent && doc().activeElement === nav && boardMapping() === mapping,
        `${tag}, coordinates ${enabled}: closing restores native elements, keyboard focus and exact input mapping`);
    }
    if ((coordinates().getAttribute('aria-pressed') === 'true') !== initialCoordinates) coordinates().click();
    await pause(60);
    const current = state().api.getCurrent(), phase = state().session.phase, nativeForm = doc().querySelector('#move-form');
    button('Site page').click(); await pause(80);
    assert(doc().documentElement.dataset.zen === 'off' && doc().querySelector('.zen-toolbar').hidden &&
      !doc().querySelector('.zen-resume').hidden && !doc().querySelector('.besogo-board').hasAttribute('data-zen-fit'),
      `${tag}: regular mode removes Zen mode presentation in place`);
    assert(state().api.getCurrent() === current && state().session.phase === phase &&
      (!nativeForm || doc().querySelector('#move-form') === nativeForm), `${tag}: switching preserves native position and form identity`);
    doc().querySelector('.zen-resume').click(); await pause(80);
    assert(state().api.getCurrent() === current && rect('.zen-next').y === next.y && doc().documentElement.dataset.zen === 'on',
      `${tag}: returning to Zen mode retains position and control placement`);
  }
  button('Site page').click(); await pause(80);
  const oldTime = state().loadedAt;
  frame.contentWindow.location.reload();
  await wait(() => state()?.loadedAt !== oldTime && doc().querySelector('.zen-resume') && doc().documentElement.dataset.zen === 'off');
  assert(!doc().querySelector('.zen-resume').hidden, 'Regular-mode preference survives native reload');
  doc().querySelector('.zen-resume').click(); await pause(80);
  assert(localStorage.getItem('zen-demo-zenMode') === 'on', 'Zen mode choice is remembered without another page request');
}
