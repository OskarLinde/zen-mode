const frame = document.querySelector('#preview');
const scenario = document.querySelector('#scenario');
const checks = document.querySelector('#checks');
checks.textContent = 'Ready for local checks.';
// The LAN bundle provides this route. A loopback preview cannot be reached
// from a phone, so it must not offer a misleading QR link.
if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(location.hostname))
  document.querySelector('#phone-share').hidden = false;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function setWidth(width, height = width > 400 ? 960 : 844) {
  frame.style.width = `${width}px`;
  frame.style.height = `${height}px`;
  document.querySelectorAll('[data-width]').forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.width) === width)));
}
document.querySelectorAll('[data-width]').forEach(button => button.onclick = () => setWidth(Number(button.dataset.width), Number(button.dataset.height) || undefined));
scenario.onchange = () => { frame.src = scenario.value.startsWith('real:') ? `harness/real.html?p=${scenario.value.slice(5)}` : `harness/puzzle.html?p=${scenario.value}`; };

document.querySelector('#run-checks').onclick = async event => {
  event.target.disabled = true;
  checks.textContent = 'Running checks…';
  const results = [];
  const assert = (condition, label) => {
    if (!condition) throw new Error(label);
    results.push(label);
    checks.textContent = `${results.length} checks passed…\n${label}`;
  };
  const waitFor = async predicate => {
    for (let i = 0; i < 150; i++) { if (predicate()) return; await pause(40); }
    throw new Error('Timed out waiting for sample');
  };
  const doc = () => frame.contentDocument;
  const state = () => frame.contentWindow.zenSample;
  const button = name => [...doc().querySelectorAll('.zen-toolbar button')].find(b => b.textContent === name);
  const load = async p => {
    localStorage.setItem('zen-demo-zenMode', 'on');
    const previousTime = state()?.loadedAt;
    frame.src = `harness/puzzle.html?p=${p}`;
    await waitFor(() => state()?.fixture === p && state()?.loadedAt !== previousTime && button('Auto-fit'));
    if (p < 4 || p === 4) await waitFor(() => !button('Auto-fit').disabled);
    await waitFor(() => !doc().documentElement.dataset.zenHandoff);
    await pause(80);
  };
  const rect = selector => doc().querySelector(selector).getBoundingClientRect();
  try {
    setWidth(390);
    await load(0);
    await waitFor(() => !doc().documentElement.hasAttribute('data-zen-preparing'));
    const popupBox = doc().querySelector('.besogo-board > svg').getAttribute('viewBox'), popupNext = rect('.zen-next').y;
    for (const kind of ['short', 'long', 'repeated']) {
      frame.contentWindow.zenFakeAchievement(kind); await pause(kind === 'repeated' ? 600 : 60);
      const notices = [...doc().querySelectorAll('[data-zen-achievement]')].filter(n => frame.contentWindow.getComputedStyle(n).display !== 'none');
      assert(notices.length === (kind === 'repeated' ? 3 : 1) && notices.every(n => n.textContent.includes('TEST ONLY')),
        `Demo ${kind} trigger produces labelled test-only notifications through the shared adapter`);
      for (const notice of notices) notice.querySelector('.zen-achievement-dismiss').click();
      await pause(520);
      assert(notices.every(n => frame.contentWindow.getComputedStyle(n).display === 'none') &&
        doc().querySelector('.besogo-board > svg').getAttribute('viewBox') === popupBox && rect('.zen-next').y === popupNext,
        `Demo ${kind} notifications dismiss without moving board or controls`);
    }
    const cover = doc().createElement('div'); cover.className = 'zen-mode-handoff';
    doc().documentElement.append(cover); doc().documentElement.dataset.zenHandoff = 'waiting';
    try {
      assert(frame.contentWindow.getComputedStyle(doc().querySelector('.besogo-board')).viewTransitionName === 'none' &&
        frame.contentWindow.getComputedStyle(cover).viewTransitionName === 'none',
        'The document-swap cover uses only the root snapshot, avoiding duplicate named boards');
    } finally { cover.remove(); delete doc().documentElement.dataset.zenHandoff; }
    assert(frame.contentWindow.getComputedStyle(doc().querySelector('.besogo-board')).viewTransitionName === 'zen-solving',
      'Removing the cover restores the native board snapshot name');
    doc().documentElement.dataset.zenDeparting = 'on';
    try {
      assert(frame.contentWindow.getComputedStyle(doc().querySelector('.besogo-board')).viewTransitionName === 'none',
        'Departure captures only the stable root snapshot');
      assert(frame.contentWindow.getComputedStyle(doc().querySelector('.besogo-board > svg')).opacity === '1' &&
        !doc().querySelector('.zen-mode-handoff'),
        'Departure retains the painted native board instead of introducing a new cover');
    } finally { delete doc().documentElement.dataset.zenDeparting; }
    const appearance = label => doc().querySelector(`select[aria-label="${label}"]`);
    const choose = (label, value) => { const select = appearance(label); select.value = value; select.dispatchEvent(new Event('change')); };
    choose('Bottom bar', 'solid'); choose('Board edge margin', 'off'); await pause(30);
    choose('Board appearance', 'plain'); choose('Outside board', 'auto'); await pause(30);
    const surface = () => frame.contentWindow.getComputedStyle(doc().querySelector('.besogo-board'));
    const originalSurface = frame.contentWindow.getComputedStyle(doc().querySelector('.besogo-board > svg')).background;
    const originalBar = frame.contentWindow.getComputedStyle(doc().querySelector('.zen-toolbar')).background;
    const surroundNextY = rect('.zen-next').y, surroundBox = doc().querySelector('.besogo-board > svg').getAttribute('viewBox');
    assert(surface().backgroundImage.includes('linear-gradient') && !surface().backgroundImage.includes('tatami'),
      'Auto surround uses a subtle CSS weave with the plain board');
    choose('Board appearance', 'site'); await pause(30);
    assert(surface().backgroundImage.includes('tatami.png'), 'Auto surround uses natural tatami with the site board');
    const texture = new Image(); texture.src = new URL('../extension/tatami.png', location.href); await texture.decode();
    assert(texture.naturalWidth > 0, 'Natural tatami is a packaged, decodable local image');
    choose('Outside board', 'woven'); await pause(30);
    assert(!surface().backgroundImage.includes('tatami'), 'Explicit woven surround overrides the site-theme match');
    choose('Board appearance', 'plain'); choose('Outside board', 'natural'); await pause(30);
    assert(surface().backgroundImage.includes('tatami') && frame.contentWindow.localStorage.getItem('zen-demo-surround') === 'natural',
      'Natural surround can be selected independently and is remembered');
    choose('Outside board', 'solid'); await pause(30);
    assert(surface().backgroundImage === 'none', 'Solid surround removes all pattern layers');
    assert(frame.contentWindow.getComputedStyle(doc().querySelector('.besogo-board > svg')).background === originalSurface &&
      frame.contentWindow.getComputedStyle(doc().querySelector('.zen-toolbar')).background === originalBar &&
      rect('.zen-next').y === surroundNextY && doc().querySelector('.besogo-board > svg').getAttribute('viewBox') === surroundBox,
      'Surround changes leave the real board surface, geometry and bottom UI unchanged');
    await load(0);
    assert(appearance('Outside board').value === 'solid' && surface().backgroundImage === 'none', 'Surround preference survives ordinary navigation');
    choose('Outside board', 'auto'); await pause(30);
    const barY = rect('.zen-toolbar').y;
    choose('Board edge margin', 'on'); await pause(30);
    const rimBoard = doc().querySelector('.besogo-board');
    const rimStyle = frame.contentWindow.getComputedStyle(rimBoard);
    assert(Math.abs(rect('.besogo-board > svg').left - rect('.besogo-board').left - parseFloat(rimStyle.getPropertyValue('--zen-grid-step')) / 3) < 1,
      'Optional mat margin is one-third of a grid interval beyond the true side edge');
    assert(rect('.zen-toolbar').y === barY, 'Board edge margin does not move controls');
    choose('Bottom bar', 'glass'); await pause(30);
    assert(rect('.besogo-board').bottom === frame.clientHeight && rect('.zen-toolbar').y === barY,
      'Glass continues the board plane behind fixed controls');
    assert(frame.contentWindow.getComputedStyle(doc().querySelector('.zen-toolbar'), '::before').backdropFilter.includes('blur'),
      'Frosted controls blur the actual underlying board or mat');
    assert(rect('.zen-hearts').top === 12 && rect('.zen-nav-trigger').top === 12,
      'Frosted backdrop keeps the heart and hamburger fixed at the top of the viewport');
    await load(0);
    assert(appearance('Board edge margin').value === 'on' && appearance('Bottom bar').value === 'glass',
      'Margin and bottom-bar preferences survive native navigation');
    choose('Board edge margin', 'off'); choose('Bottom bar', 'solid'); await pause(30);
    const hearts = () => doc().querySelector('.zen-hearts');
    const counter = () => doc().querySelector('#health-counter');
    const refresh = () => doc().dispatchEvent(new Event('zen:preferences'));
    assert(!hearts().hidden && hearts().textContent === '9⁄10' && hearts().getAttribute('aria-label') === '9 of 10 hearts remaining',
      'Hearts mirror the native count with a readable accessible label');
    const heartRect = rect('.zen-hearts'), initialNext = rect('.zen-next');
    assert(heartRect.top === 12 && frame.clientWidth - heartRect.right === 12,
      'Heart count sits in the top-right overlay without moving controls');
    assert(frame.contentWindow.getComputedStyle(hearts().querySelector('path')).fill === 'none' &&
      frame.contentWindow.getComputedStyle(hearts()).backgroundColor === 'rgba(0, 0, 0, 0)',
      'Heart outline and badge background remain transparent');
    await waitFor(() => !!doc().elementFromPoint(heartRect.x + 12, heartRect.y + 20)?.closest('.besogo-board'));
    assert(!hearts().contains(doc().elementFromPoint(heartRect.x + 12, heartRect.y + 20)),
      'The heart overlay lets board taps through');
    frame.contentWindow.currentHealth = 8; refresh(); await pause(30);
    assert(hearts().textContent === '9⁄10', 'Unrevealed engine health cannot spoil a refutation');
    counter().textContent = '8 / 10'; await pause(30);
    assert(hearts().textContent === '8⁄10', 'Native revealed loss updates the heart count without another board action');
    counter().firstChild.data = '0 / 10'; await pause(30);
    assert(hearts().textContent === '0⁄10', 'Zero hearts stays visible');
    counter().textContent = '-2 / 10'; await pause(30);
    assert(hearts().textContent === '0⁄10', 'Native negative health shows zero remaining hearts');
    counter().outerHTML = '<span id="health-counter">10 / 10</span>'; await pause(30);
    assert(hearts().textContent === '10⁄10', 'Counter replacement and restored hearts are observed');
    assert(rect('.zen-next').y === initialNext.y && rect('.zen-hearts').right === heartRect.right,
      'Changing heart counts keeps the bar and right alignment stable');
    counter().textContent = '?'; await pause(30);
    assert(hearts().hidden, 'An unknown native count hides stale hearts');
    doc().querySelector('#health').remove(); await pause(30);
    assert(hearts().hidden, 'Missing heart markup is not guessed');
    doc().querySelector('.play-header-table').insertAdjacentHTML('afterbegin', '<div id="health"><span id="health-counter">9 / 10</span></div>'); await pause(30);
    assert(!hearts().hidden && hearts().textContent === '9⁄10', 'Replaced native health container reconnects cleanly');
    frame.contentWindow.besogoNoLogin = true; refresh(); await pause(30);
    assert(hearts().hidden, 'Signed-out pages never display a made-up allowance');
    frame.contentWindow.besogoNoLogin = false; frame.contentWindow.mode = 5; refresh(); await pause(30);
    assert(hearts().hidden, 'Mistake Training does not inherit the level-mode heart allowance');
    frame.contentWindow.mode = 1; refresh(); await pause(30);
    doc().querySelector('.zen-options > summary').click(); await pause(30);
    counter().textContent = '7 / 10'; await pause(30);
    assert(hearts().textContent === '7⁄10', 'Heart updates survive native header relocation into the options sheet');
    doc().querySelector('.zen-problem-sheet').close(); counter().textContent = '9 / 10'; await pause(30);
    const geometry = await import('../extension/geometry.mjs');
    const board = rect('.besogo-board'), next = rect('.zen-next');
    const originalTime = state().loadedAt;
    const svg = () => doc().querySelector('.besogo-board svg');
    if (state().api.getCoordStyle() !== 'none') { button('Coordinates').click(); await pause(100); }
    if (button('Thumb reach').getAttribute('aria-pressed') !== 'true') button('Thumb reach').click();
    assert(svg().viewBox.baseVal.x === 0 && svg().viewBox.baseVal.y === 0, 'Real corner stays at the edge of the rendered board');
    const inputs = geometry.collectGeometry(state().api.getRoot()).points.map(p =>
      rect(`[data-point="${p.x},${p.y}"]`));
    const inputTop = Math.min(...inputs.map(r => r.top));
    assert(inputTop >= board.top - 1 &&
      Math.max(...inputs.map(r => r.bottom)) <= board.bottom + 1,
      'Bottom placement keeps the complete input rectangle visible');
    const fitGeometry = geometry.collectGeometry(state().api.getRoot());
    // The crop Auto-fit chose (the stones first, see problemFrame), as the board records it.
    const [cropLeft, cropTop, cropRight, cropBottom] = doc().querySelector('.besogo-board').dataset.zenCrop.split(',').map(Number);
    const safe = geometry.viewBoxFor({ left: cropLeft, top: cropTop, right: cropRight, bottom: cropBottom }, fitGeometry.size, { x: 16, y: 16, step: 32 });
    const matrix = svg().getScreenCTM();
    assert(Math.abs((safe[1] + safe[3]) * matrix.d + matrix.f - board.bottom) < 1,
      'Width-limited safe rectangle sits at the bottom of the solving area');
    assert(Math.abs(matrix.a - Math.min(board.width / safe[2], board.height / safe[3])) < .001,
      'Bottom placement preserves the largest fitting stone size');
    assert([...svg().querySelectorAll('circle')].every(stone => {
      const r = stone.getBoundingClientRect();
      return r.left >= board.left && r.right <= board.right && r.top >= board.top && r.bottom <= board.bottom;
    }), 'Reach fitting keeps every starting stone onscreen');
    const loweredY = svg().getBoundingClientRect().y;
    assert(loweredY > 0 && svg().getBoundingClientRect().bottom <= board.bottom + 1, 'Upper-corner board moves down within the fixed solving area');
    button('Thumb reach').click();
    // Without thumb reach the board starts at the top, unless the phone's menu band
    // needs the problem lower: then it moves exactly that far and no further.
    const playTop = (() => { const b = geometry.frameBounds(fitGeometry.size, fitGeometry.points); return rect(`[data-point="${b.left},${b.top}"]`).top; })();
    const band = Math.max(...['.zen-toolbar .zen-nav-trigger', '.zen-hearts'].map(selector => doc().querySelector(selector))
      .filter(el => el && el.getClientRects().length).map(el => el.getBoundingClientRect().bottom)) + 8;
    assert(playTop >= band - .5 && (svg().getBoundingClientRect().y === 0 || Math.abs(playTop - band) < 1),
      'Disabling thumb reach keeps the board high, moved only as far as the menu band needs');
    button('Thumb reach').click();
    assert(svg().viewBox.baseVal.width / 32 >= 6, 'Auto-fit keeps at least six intersections across');
    assert(board.x === 0 && board.y === 0 && board.width === frame.clientWidth && board.bottom === rect('.zen-toolbar').top, 'Mobile board fills screen above bottom bar');
    assert(doc().querySelector('.zen-problem').textContent === 'Sample captures 1/7', 'Compact bar identifies the set and problem number');
    assert(rect('.zen-next').height >= 44 && rect('.zen-reset').height >= 44, 'Bottom controls have large touch targets');
    assert(doc().querySelector('.zen-review-controls').hidden && rect('.zen-review-controls').height === 0 && rect('.zen-toolbar').height === 72,
      'Normal play keeps the compact bar without an extra navigation row');
    while (!button('+').disabled) { button('+').click(); await pause(30); }
    const zoom = Number(doc().querySelector('.zen-toolbar output').textContent.replace('%', '')) / 100;
    assert(svg().viewBox.baseVal.width / (32 * zoom) >= 5.95, 'Manual zoom cannot exceed the six-across limit');
    button('Auto-fit').click(); await pause(50);
    button('Coordinates').click(); await pause(100);
    assert(state().api.getCoordStyle() !== 'none' && svg().querySelectorAll('text').length > 0, 'Coordinates can be turned on');
    button('Coordinates').click(); await pause(100);
    assert(state().api.getCoordStyle() === 'none' && svg().querySelectorAll('text').length === 0, 'Coordinates can be removed for a tighter board');
    let bubbled = 0;
    doc().addEventListener('click', () => bubbled++);
    button('Full board').click();
    assert(bubbled === 0, 'View controls do not reach document click handlers');
    assert(svg().viewBox.baseVal.width === 608, 'Full board restores all 19 lines');
    const centred = () => { const r = svg().getBoundingClientRect(); return Math.abs((r.top - board.top) - (board.bottom - r.bottom)) < 1; };
    assert(centred(), 'A whole board that fits is centred, even with thumb reach on');
    button('Thumb reach').click();
    assert(centred(), 'Disabling reach leaves it centred');
    button('Thumb reach').click();
    button('Auto-fit').click();
    doc().querySelector('[data-point="2,3"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await pause(200);
    assert(state().solved && state().loadedAt === originalTime, 'Correct move waits for user advancement');
    assert(Math.abs(svg().getBoundingClientRect().y - loweredY) < 1, 'Reach position stays steady after solving');
    assert(Math.abs(rect('.zen-next').y - next.y) < 1, 'Success message keeps Next in place');
    const comment = doc().querySelector('#theComment');
    const explanation = ('Correct, but what about this answer?\n' + 'A longer explanation remains readable without covering a playable intersection. '.repeat(12)).trim();
    comment.textContent = explanation;
    await waitFor(() => doc().querySelector('.zen-feedback button').textContent === explanation);
    assert(!doc().querySelector('.zen-feedback').hidden, 'Native continuation comments appear in the compact bar without an engine update');
    assert(rect('.besogo-board').height === board.height && rect('.zen-next').y === next.y,
      'Continuation feedback keeps the board and Next in place');
    doc().querySelector('.zen-feedback button').click();
    assert(doc().querySelector('.zen-feedback-dialog').open && doc().querySelector('.zen-feedback-dialog p').textContent === explanation,
      'Feedback opens the complete multiline explanation on request');
    assert(state().loadedAt === originalTime && state().solved, 'Opening feedback cannot advance a solved problem');
    setWidth(320); await pause(60);
    const feedbackBox = rect('.zen-feedback-dialog');
    assert(feedbackBox.width <= 320 && feedbackBox.left >= 0 && feedbackBox.bottom <= frame.clientHeight,
      'Long feedback fits a narrow phone viewport');
    doc().querySelector('.zen-feedback-dialog button').click();
    comment.style.display = 'none';
    await waitFor(() => doc().querySelector('.zen-feedback').hidden);
    assert(!doc().querySelector('.zen-live-status').hidden, 'Native hide/reset clears feedback even when old comment text remains');
    comment.style.display = 'block';
    setWidth(760); await pause(60);
    assert(!doc().querySelector('.zen-feedback').hidden && rect('.besogo-board').width === frame.clientWidth, 'Wide Zen mode keeps continuation feedback and fills the viewport');
    assert(frame.contentWindow.getComputedStyle(hearts()).display !== 'none', 'Wide Zen mode retains the revealed heart counter');
    comment.textContent = ''; comment.style.removeProperty('display');
    setWidth(390); await pause(60);
    const nativeHeader = doc().querySelector('.sample-header'), headerParent = nativeHeader.parentNode;
    const nativeDetails = doc().querySelector('.sample-details'), detailsParent = nativeDetails.parentNode;
    const nativeForm = doc().querySelector('#move-form');
    const navTrigger = doc().querySelector('.zen-nav-trigger');
    navTrigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    navTrigger.click(); await pause(50);
    const navSheet = doc().querySelector('.zen-navigation-sheet');
    assert(navSheet.open && navSheet.contains(nativeHeader) && rect('.sample-header').height > 0,
      'Hamburger shows the original navigation elements');
    assert(state().solved && state().loadedAt === originalTime && rect('.zen-next').y === next.y,
      'Opening navigation after success neither advances nor moves controls');
    navSheet.querySelector('header button').click(); await pause(50);
    assert(nativeHeader.parentNode === headerParent && doc().activeElement === navTrigger,
      'Keyboard navigation close restores native DOM and trigger focus');
    navTrigger.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', bubbles: true }));
    navTrigger.click(); await pause(30);
    const closeNav = navSheet.querySelector('header button');
    closeNav.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', bubbles: true }));
    closeNav.click(); await pause(30);
    assert(doc().activeElement !== navTrigger && !navTrigger.matches(':focus-visible'),
      'Touch menu dismissal does not leave a focus ring on the hamburger');
    const optionsSummary = doc().querySelector('.zen-options summary');
    optionsSummary.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    optionsSummary.click(); await pause(50);
    const problemSheet = doc().querySelector('.zen-problem-sheet');
    assert(problemSheet.open && problemSheet.contains(nativeDetails) && doc().querySelector('#move-form') === nativeForm,
      'Bottom menu preserves the original native form and page details');
    assert(rect('#besogo-next-button').height >= 44 && problemSheet.contains(doc().querySelector('#besogo-next-button')),
      'Bottom menu exposes native problem controls with touch targets');
    nativeDetails.open = true;
    const field = nativeForm.querySelector('input'); field.value = 'B17'; field.focus();
    field.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', bubbles: true }));
    let delegatedClick = false;
    const delegate = event => { if (event.target === field) delegatedClick = true; };
    doc().querySelector('#content').addEventListener('click', delegate);
    field.click(); doc().querySelector('#content').removeEventListener('click', delegate);
    assert(delegatedClick && doc().activeElement === field && state().loadedAt === originalTime,
      'Native form focus and ancestor event delegation survive the menu');
    button('Coordinates').click(); await pause(100);
    assert(problemSheet.open && doc().querySelectorAll('#besogo-next-button').length === 1 &&
      problemSheet.contains(doc().querySelector('#besogo-next-button')),
      'Engine rebuild replaces the native control panel without duplicate IDs');
    problemSheet.querySelector('header button').click(); await pause(50);
    assert(nativeDetails.parentNode === detailsParent && field.value === 'B17' &&
      doc().querySelector('#target').contains(doc().querySelector('#besogo-next-button')) && doc().activeElement === optionsSummary,
      'Keyboard options close restores native controls, form values and trigger focus');
    doc().querySelector('.besogo-board').dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', bubbles: true }));
    assert(doc().activeElement !== optionsSummary && !optionsSummary.matches(':focus-visible'),
      'Returning to board touch clears a previously keyboard-focused menu opener');
    button('Coordinates').click(); await pause(100);
    const originalTree = doc().querySelector('.besogo-tree'), treeParent = originalTree.parentNode;
    button('Review').click(); await pause(80);
    const reviewHeight = rect('.besogo-board').height;
    assert(doc().querySelector('.zen-review-tree').contains(originalTree) && reviewHeight === board.height - 232,
      'Review expands the bottom panel with the original tree and fits the board above it');
    assert(svg().viewBox.baseVal.width < 608 && svg().viewBox.baseVal.width / 32 >= 6 &&
      button('Auto-fit').getAttribute('aria-pressed') === 'true',
      'Review keeps Auto-fit and its minimum six intersections instead of forcing full board');
    button('Full board').click(); await pause(60);
    assert(svg().viewBox.baseVal.width === 608 && state().review,
      'Full board remains an explicit option during Review');
    button('Auto-fit').click(); await pause(60);
    assert(svg().viewBox.baseVal.width < 608 && state().review,
      'Auto-fit can be restored without leaving Review');
    assert(!doc().querySelector('.zen-rewind').disabled, 'Review enables native move rewind when a parent position exists');
    doc().querySelector('.zen-rewind').click(); await pause(80);
    assert(state().api.getCurrent() === state().api.getRoot() && doc().querySelector('.zen-rewind').disabled &&
      state().loadedAt === originalTime, 'Back one move reaches the parent and stops at the root without changing problems');
    assert(svg().querySelectorAll('circle').length === state().sample.black.length + state().sample.white.length,
      'Native rewind restores the captured stone');
    assert(rect('.zen-next').y === next.y && rect('.besogo-board').height === reviewHeight,
      'Rewinding keeps the board area and Next control fixed');
    doc().querySelector('.zen-forward').click(); await pause(80);
    assert(state().api.getCurrent().parent === state().api.getRoot() && doc().querySelector('.zen-forward').disabled,
      'Forward follows the native line and stops at its end');
    originalTree.querySelector('button').click(); await pause(80);
    assert(state().api.getCurrent() === state().api.getRoot(), 'The original game tree remains interactive in its new panel');
    button('Exit review').click(); await pause(80);
    assert(originalTree.parentNode === treeParent && rect('.besogo-board').height === board.height &&
      doc().querySelector('.zen-review-controls').hidden && !button('Review').disabled && rect('.zen-toolbar').height === 72,
      'Exiting review restores the tree and board area, and solved problems keep Review available');
    const toolbarTime = state().loadedAt;
    button('Site view').click();
    assert(svg().getAttribute('preserveAspectRatio') === null, 'Site view restores native SVG alignment');
    await pause(100);
    assert(state().loadedAt === toolbarTime, 'Toolbar never advances a solved sample');
    doc().querySelector('[data-point="2,3"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await waitFor(() => state()?.fixture === 1 && button('Auto-fit') && !button('Auto-fit').disabled);
    assert(state().loadedAt !== originalTime, 'Board click after success performs real navigation');
    // The carried copy of the old bar covers the new page until its board is revealed.
    await waitFor(() => !doc().documentElement.hasAttribute('data-zen-bar-copy'));
    assert(doc().querySelector('.zen-number').textContent === '2/7', 'Problem number updates after native navigation');
    assert(Math.abs(svg().getBoundingClientRect().bottom - board.bottom) < 1, 'Auto-fit full-board position also stays near the bottom');
    assert(Math.abs(rect('.besogo-board').width - board.width) < 1 && Math.abs(rect('.zen-next').y - next.y) < 1, '9×9 and 19×19 share board and control placement');
    doc().querySelector('.zen-next').click();
    await waitFor(() => state()?.fixture === 2 && button('Auto-fit') && !button('Auto-fit').disabled);
    assert(state().fixture === 2, 'Original Next link remains functional');
    assert(doc().querySelector('.besogo-board svg').getAttribute('preserveAspectRatio') !== 'none', 'Rectangular puzzle preserves uniform scale');
    const tallSVG = doc().querySelector('.besogo-board svg'), tallBox = tallSVG.viewBox.baseVal;
    assert(tallBox.x >= 0 && tallBox.y >= 0 && tallBox.x + tallBox.width <= 288 && tallBox.y + tallBox.height <= 416,
      'Portrait framing never invents area outside a rectangular board');
    await load(3);
    const g = geometry.collectGeometry(state().api.getRoot());
    const vb = doc().querySelector('.besogo-board svg').viewBox.baseVal;
    // The moves playable next are in the frame; a far variation is followed as it is played.
    const nextInside = state().api.getRoot().children.every(child => {
      const x = 32 * child.move.x - 16, y = 32 * child.move.y - 16;
      return x >= vb.x && x <= vb.x + vb.width && y >= vb.y && y <= vb.y + vb.height;
    });
    assert(g.points.some(p => p.x === 17 && p.y === 16) && nextInside, 'Distant variation stays in the problem; the moves playable next are in the frame');
    assert(g.points.some(p => p.x === 18 && p.y === 18) && 32 * 18 - 16 <= vb.x + vb.width && 32 * 18 - 16 <= vb.y + vb.height, 'Problem label remains inside frame');
    doc().querySelector(`[data-point="${state().sample.answer.join(',')}"]`).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    doc().querySelector('#besogo-review-button').click();
    await pause(60);
    assert(doc().querySelector('.besogo-board svg').viewBox.baseVal.width === 608, 'Review preserves distant branches and labels that require the complete board');
    { const r = svg().getBoundingClientRect(), frame = rect('.besogo-board'), bar = rect('.zen-toolbar');
      assert(r.top >= frame.top && r.bottom <= Math.min(frame.bottom, bar.top) + 1 && Math.abs((r.top - frame.top) - (Math.min(frame.bottom, bar.top) - r.bottom)) < 2, 'Review centres a whole board that fits above the controls'); }
    for (const width of [320, 390, 760]) {
      setWidth(width); await pause(100);
      assert(doc().documentElement.scrollWidth <= frame.clientWidth + 1, `No page overflow at ${width}px preview`);
      const r = rect('.zen-next');
      assert(r.height >= 44 && r.width >= 44, `Next touch target at ${width}px preview`);
    }
    setWidth(760);
    await load(4);
    assert(!button('Auto-fit').disabled, 'Delayed engine becomes frameable');
    await waitFor(() => state().startupFrames.length >= 12);
    const startup = state().startupFrames;
    assert(new Set(startup.map(s => `${s.boardY},${s.nextY}`)).size === 1,
      'Desktop board and Next stay fixed while transient editor controls disappear');
    assert(startup.filter(s => s.visible === 'visible').every(s => s.box === startup.at(-1).box),
      'First visible board frame already has the final crop');
    const visibleStones = startup.filter(s => s.stoneVisible === 'visible' && s.opacity !== '0');
    assert(visibleStones.length > 0 && visibleStones.every(s => String(s.stoneRect) === String(startup.at(-1).stoneRect)),
      'First visible stones have their final positions, including explicitly visible SVG children');
    assert(startup.some(s => s.opacity === '0' && String(s.stoneRect) !== String(startup.at(-1).stoneRect)),
      'Staged intermediate stone positions are covered during preparation');
    assert(rect('.zen-next').bottom <= frame.clientHeight && rect('.besogo-board').top === 0,
      'Wider Zen mode keeps controls and board in the viewport after delayed startup');
    setWidth(390);
    await load(5);
    assert(button('Auto-fit').disabled && !doc().querySelector('#zen-mode-fallback').hidden && doc().querySelector('#zen-mode-fallback').textContent.includes('could not safely fit'), 'Unknown engine retains native view with explanation');
    assert(doc().documentElement.dataset.zenMode === 'off', 'Unknown engine exposes the full page fallback');
    await load(6);
    assert(doc().querySelector('#errorMessage').textContent.includes('failed'), 'Loading error remains visible');
    button('Site page').click(); await pause(80);
    doc().dispatchEvent(new Event('zen:startup-failed'));
    assert(!doc().documentElement.hasAttribute('data-zen') && !doc().querySelector('.zen-toolbar'), 'Disabling removes the enhancement without reload');
    await load(0);
    button('Site page').click(); await pause(80);
    doc().querySelector('.sample-details').open = true;
    const input = doc().querySelector('input[name="coordinate"]');
    input.focus(); input.value = 'B17';
    input.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', bubbles: true }));
    assert(state().fixture === 0 && doc().activeElement === input, 'Form typing/focus is not hijacked');
    doc().querySelector('.zen-resume').click(); await pause(80);
    button('Full board').click();
    button('+').click();
    assert(doc().querySelector('.besogo-board').style.getPropertyValue('--zen-zoom') === '1.25', 'Manual zoom is available');
    button('Full board').click();
    assert(doc().querySelector('.besogo-board').style.getPropertyValue('--zen-zoom') === '1', 'Full board also resets manual zoom');
    const theme = doc().querySelector('.zen-theme select');
    theme.value = 'site'; theme.dispatchEvent(new Event('change'));
    await load(1);
    assert(state().api.getCoordStyle() === 'none', 'Coordinate preference persists across documents');
    assert(doc().documentElement.dataset.zenTheme === 'site', 'Appearance preference persists across documents');
    const resetTheme = doc().querySelector('.zen-theme select');
    resetTheme.value = 'plain'; resetTheme.dispatchEvent(new Event('change'));
    setWidth(440); frame.style.height = '772px';
    frame.src = 'harness/puzzle.html?p=0&framing=1';
    await waitFor(() => state()?.framing && button('Auto-fit') && !button('Auto-fit').disabled);
    await pause(80);
    button('Auto-fit').click(); await pause(80);
    if (state().api.getCoordStyle() !== 'none') { button('Coordinates').click(); await pause(80); }
    assert(Math.abs(rect('.besogo-board svg').left) < 1 && Math.abs(rect('.besogo-board svg').width - rect('.besogo-board').width) < 1,
      'Enclosed shape extends real grid across the full screen width');
    assert(svg().getScreenCTM().a * 32 > 46, 'Filling the screen width preserves the larger stone spacing');
    assert(Math.abs(rect('.besogo-board svg').top) < 1 && Math.abs(rect('.besogo-board svg').bottom - rect('.besogo-board').bottom) < 1,
      'Lowered enclosed shape extends real board upward without a blank top margin');
    assert([...svg().querySelectorAll('circle')].every(stone => {
      const r = stone.getBoundingClientRect(), b = rect('.besogo-board');
      return r.left >= b.left && r.right <= b.right && r.top >= b.top && r.bottom <= b.bottom;
    }), 'Tighter enclosure crop keeps every rendered stone visible');
    setWidth(390);
    // The training controller uses mode 5 with the same board. These are
    // authored lifecycle checks, not signed-in server/progress validation.
    frame.src = 'harness/puzzle.html?p=0&training=1';
    await waitFor(() => frame.contentWindow.mode === 5 && button('Auto-fit') && !button('Auto-fit').disabled);
    await pause(80);
    const trainingTime = state().loadedAt, trainingNextY = rect('.zen-next').y;
    assert(doc().documentElement.dataset.zenMode === 'on' && doc().querySelector('.zen-set').textContent === 'Mistake Training',
      'Mistake training uses the compact board and native title');
    assert(doc().querySelector('.zen-next').disabled, 'Training Next respects its native inactive state');
    doc().querySelector('[data-point="5,5"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await waitFor(() => doc().querySelector('.zen-feedback button').textContent.includes('Press Reset'));
    assert(doc().querySelector('.zen-feedback button').textContent.includes('Incorrect!'), 'Training failure and Reset instruction appear together');
    doc().querySelector('[data-point="2,3"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    assert(!state().solved, 'Training fixture retains native failure lock until Reset');
    doc().querySelector('.zen-reset').click();
    await waitFor(() => doc().querySelector('.zen-feedback').hidden);
    assert(!state().solved && state().loadedAt === trainingTime, 'Training Reset clears feedback without independent navigation');
    doc().querySelector('[data-point="2,3"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    doc().querySelector('.zen-options summary').click();
    await waitFor(() => !doc().querySelector('.zen-next').disabled);
    assert(doc().querySelector('.zen-problem-sheet').open && state().loadedAt === trainingTime,
      'Delayed training result enables Next even while native controls are in the menu; no auto-advance');
    doc().querySelector('.zen-problem-sheet > header button').click();
    await pause(50);
    doc().querySelector('.zen-feedback button').click();
    assert(doc().querySelector('.zen-feedback-dialog p').textContent.includes('Next review in 2 days.') &&
      doc().querySelector('.zen-feedback-dialog p').textContent.includes('All clear today.'),
      'Training review and completion messages have full-text access');
    doc().querySelector('.zen-feedback-dialog button').click();
    assert(rect('.zen-next').y === trainingNextY, 'Training outcomes keep Next in the same place');
    doc().querySelector('.zen-review').click();
    await waitFor(() => state().review && !doc().querySelector('.zen-review').hasAttribute('aria-busy'));
    const key = name => {
      const event = new frame.contentWindow.KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true });
      doc().querySelector('.besogo-board').dispatchEvent(event); return event;
    };
    key('ArrowLeft'); await pause(30);
    assert(state().api.getCurrent() === state().api.getRoot(), 'Training Review Left reaches root after delayed result');
    key('ArrowLeft'); key('ArrowUp'); key('ArrowDown'); await pause(30);
    assert(state().api.getCurrent() === state().api.getRoot() && state().loadedAt === trainingTime,
      'Unavailable training Review directions do not navigate to another problem');
    key('ArrowRight'); await pause(30);
    assert(state().api.getCurrent() === state().api.getRoot().children[0], 'Training Review Right replays the native move');
    doc().querySelector('.zen-review').click();
    await waitFor(() => !state().review && !doc().querySelector('.zen-review').hasAttribute('aria-busy'));
    const outside = new frame.contentWindow.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true });
    let delivered = false; const record = () => { delivered = true; };
    doc().addEventListener('keydown', record, { once: true });doc().body.dispatchEvent(outside);
    doc().removeEventListener('keydown', record);
    assert(delivered && !outside.defaultPrevented, 'After training Review exit, keyboard handling defers to the native document');

    doc().querySelector('.zen-next').click();
    await waitFor(() => frame.contentWindow.mode === 5 && state()?.fixture === 1 && button('Auto-fit') && !button('Auto-fit').disabled);
    assert(frame.contentWindow.location.search.includes('training=1') && state().loadedAt !== trainingTime,
      'Next follows the original training link and remains in training');
    const replay = doc().createElement('div'); replay.className = 'mistake-training-replay';
    replay.textContent = 'Already solved today. This try does not count.';
    doc().querySelector('#target').before(replay);
    state().api.setCoordStyle(state().api.getCoordStyle());
    await waitFor(() => doc().querySelector('.zen-feedback button').textContent.includes('does not count'));
    assert(!doc().querySelector('.zen-feedback').hidden, 'Already-solved replay notice stays visible in compact training');
    frame.contentWindow.mode = 3;
    state().api.setCoordStyle(state().api.getCoordStyle());
    await waitFor(() => doc().documentElement.dataset.zenMode === 'off');
    assert(doc().documentElement.dataset.zenMode === 'off', 'Timed mode still retains the complete native page');
    await load(0);
    doc().querySelector('[data-point="2,3"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await pause(80);
    const nativeReview = doc().querySelector('#besogo-review-button'), openReview = nativeReview.onclick;
    const reviewButton = doc().querySelector('.zen-review');
    let reviewCalls = 0, paintOpportunity = false, busyAtInvoke = false;
    nativeReview.onclick = () => {
      reviewCalls++; busyAtInvoke = paintOpportunity && reviewButton.getAttribute('aria-busy') === 'true';
      setTimeout(openReview, 180);
    };
    reviewButton.click();
    frame.contentWindow.requestAnimationFrame(() => { paintOpportunity = !!reviewButton.querySelector('.zen-review-spinner'); });
    assert(reviewButton.disabled && reviewButton.getAttribute('aria-busy') === 'true' &&
      reviewButton.querySelector('.zen-review-spinner') && !state().review,
      'Review replaces its label with an immediate accessible busy indicator');
    reviewButton.click(); reviewButton.click();
    await waitFor(() => state().review && !reviewButton.hasAttribute('aria-busy'));
    assert(reviewCalls === 1 && busyAtInvoke, 'Repeated taps dispatch one native action after a spinner paint opportunity');
    assert(reviewButton.textContent === 'Exit review' && !reviewButton.disabled,
      'Successful review clears the spinner and restores its action');
    nativeReview.onclick = openReview;
    reviewButton.click(); await waitFor(() => !state().review && !reviewButton.hasAttribute('aria-busy'));
    nativeReview.onclick = () => { reviewCalls++; };
    reviewButton.click();
    await waitFor(() => !reviewButton.hasAttribute('aria-busy'));
    assert(!reviewButton.disabled && !doc().querySelector('.zen-review-message').hidden &&
      doc().querySelector('.zen-review-message').textContent.includes('5 seconds') && !state().review,
      'Unresponsive review times out visibly and restores an actionable button');
    nativeReview.onclick = openReview;
    reviewButton.click(); await waitFor(() => state().review && !reviewButton.hasAttribute('aria-busy'));
    assert(doc().querySelector('.zen-review-message').hidden, 'Retry clears the error and can open Review normally');
    reviewButton.click(); await waitFor(() => !state().review && !reviewButton.hasAttribute('aria-busy'));
    reviewCalls = 0; nativeReview.onclick = () => { reviewCalls++; openReview(); };
    reviewButton.click(); doc().querySelector('.zen-reset').click(); await pause(120);
    assert(reviewCalls === 0 && !state().review && !reviewButton.hasAttribute('aria-busy'),
      'Reset cancels a queued Review action before it can open');
    reviewButton.click(); doc().dispatchEvent(new Event('zen:startup-failed')); await pause(120);
    assert(reviewCalls === 0 && !state().review && !doc().querySelector('.zen-toolbar'),
      'Removing the enhancement cancels pending Review callbacks');
    await load(0);
    await (await import('./real-checks.mjs')).checkRealSamples(frame, assert);
    await (await import('./platform-checks.mjs')).checkLayouts(frame, assert);
    scenario.value = 'real:0';
    checks.textContent = `${results.length} / ${results.length} checks passed.\nAuthored fixtures + local SGF selection; no account sync or Safari device verification.`;
    window.zenCheckResults = { passed: results.length, results };
  } catch (error) {
    checks.textContent = `${results.length} passed. FAILED: ${error.message}`;
    window.zenCheckResults = { passed: results.length, error: error.message, results };
  } finally {
    setWidth(390);
    event.target.disabled = false;
  }
};
if (new URLSearchParams(location.search).has('checks')) setTimeout(() => document.querySelector('#run-checks').click(), 200);

for (const button of document.querySelectorAll('[data-preview-achievement]')) {
  button.onclick = () => frame.contentWindow.zenFakeAchievement?.(button.dataset.previewAchievement);
}
