// Shared by the isolated Chrome and visible WebKit hosts. No navigation or
// account theme changes: compare one native page with its own Zen mode rendering.
async function preparePresentationCheck() {
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const button = text => [...document.querySelectorAll('.zen-toolbar button')].find(b => b.textContent === text);
  button('Site page').click(); await pause(150);
  const board = document.querySelector('.besogo-board'), svg = board.querySelector('svg');
  // The site can apply its texture after the mode switch.
  for (let i = 0; i < 30 && getComputedStyle(board).backgroundImage === 'none'; i++) await pause(100);
  const image = getComputedStyle(board).backgroundImage;
  for (const match of image.matchAll(/url\(["']?(.*?)["']?\)/g)) {
    const picture = new Image(); picture.src = match[1]; await picture.decode();
  }
  window.__zenNativePresentation = { image, glyphs: [...svg.querySelectorAll('text')].map(n => [n.textContent, getComputedStyle(n).fill]),
    node: besogo.editor.getCurrent(), box: svg.getAttribute('viewBox') };
  return { image, glyphs: __zenNativePresentation.glyphs.slice(0, 4), box: __zenNativePresentation.box };
}

async function checkPresentationCase(theme, coordinates, reach = false, margin = 'off') {
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const q = selector => document.querySelector(selector);
  const button = text => [...q('.zen-toolbar').querySelectorAll('button')].find(b => b.textContent === text);
  if (document.documentElement.dataset.zen === 'off') q('.zen-resume').click();
  const choose = (label, value) => { const s = q(`select[aria-label="${label}"]`); s.value = value; s.dispatchEvent(new Event('change')); };
  choose('Board appearance', theme); choose('Board edge margin', margin);
  choose('Bottom bar', 'glass'); choose('Board transition', 'off');
  if ((button('Coordinates').getAttribute('aria-pressed') === 'true') !== coordinates) button('Coordinates').click();
  document.documentElement.dataset.zenReach = reach ? 'on' : 'off';
  document.dispatchEvent(new Event('zen:preferences'));
  await pause(160);
  const b = q('.besogo-board'), s = b.querySelector('svg'), grid = s.querySelector('rect.besogo-svg-lines');
  const style = getComputedStyle(s), r = s.getBoundingClientRect(), m = s.getScreenCTM(), size = besogo.editor.getRoot().getSize();
  const step = +grid.getAttribute('width') / (size.x - 1), spacing = step * m.a;
  // Wood is the last background layer, below the rim shading.
  const last = value => value.split(/,\s*(?![^()]*\))/).at(-1).trim();
  const [x, y] = [style.backgroundPositionX, style.backgroundPositionY].map(value => parseFloat(last(value)));
  const [w, h] = last(style.backgroundSize).split(' ').map(parseFloat);
  const image = theme === 'site' ? __zenNativePresentation.image : 'none';
  const checks = [], check = (ok, message) => { if (!ok) throw Error(message); checks.push(message); };
  check(style.backgroundImage.endsWith(image), `${theme}: uses the same native texture source, or explicit Plain: ${style.backgroundImage} vs ${image}`);
  // Wood fits the true board, sampled just inside the image and past its box.
  const fullWidth = (2 * +grid.getAttribute('x') + +grid.getAttribute('width')) * m.a;
  const fullHeight = (2 * +grid.getAttribute('y') + +grid.getAttribute('height')) * m.d;
  check(Math.abs(x - (m.e - r.left - fullWidth * .004)) < .1 && Math.abs(y - (m.f - r.top - fullHeight * .004)) < .1 &&
    Math.abs(w - fullWidth * 1.008) < .1 && Math.abs(h - fullHeight * 1.008) < .1 &&
    x <= 0 && y <= 0 && x + w >= r.width + .5 && y + h >= r.height + .5,
  `${theme}, coordinates ${coordinates}: wood covers the actual visible board and coordinate gutters ${JSON.stringify({x,y,w,h,matrix:[m.a,m.e,m.f],rect:[r.left,r.top,r.width,r.height],grid:[grid.getAttribute("x"),grid.getAttribute("y"),grid.getAttribute("width"),grid.getAttribute("height")]})}`);
  if (coordinates) check([...s.querySelectorAll('text')].every(n => {
    const native = __zenNativePresentation.glyphs.find(([text]) => text === n.textContent);
    return !native || native[1] === getComputedStyle(n).fill;
  }), `${theme}: coordinate glyph contrast is native`);
  if (button('Auto-fit').getAttribute('aria-pressed') === 'true')
    check(spacing <= 80.01, 'Auto-fit spacing stays at or below 80 CSS pixels');
  const available = q('.zen-toolbar').getBoundingClientRect().top;
  const view = s.getAttribute('viewBox').split(/[ ,]+/).map(Number);
  checks.push(...checkFiniteBoardEdges().checks);
  // Auto-fit frames the problem as set up; a solution that runs far (a chase) is followed
  // as it is played, not shown in advance. Full board shows everything.
  const root = besogo.editor.getRoot(), points = [];
  for (let y = 1; y <= size.y; y++) for (let x = 1; x <= size.x; x++)
    if (root.getStone(x, y) || root.getMarkup(x, y)) points.push({ x, y });
  check(points.every(p => {
    const x = (+grid.getAttribute('x') + (p.x - 1) * step) * m.a + m.e;
    const y = (+grid.getAttribute('y') + (p.y - 1) * step) * m.d + m.f;
    // The tight crop may show stones under the glass bar; they stay on the screen.
    const bottom = q('.besogo-board').dataset.zenFrame === 'tight' ? innerHeight : available;
    return x >= -.1 && x <= innerWidth + .1 && y >= -.1 && y <= bottom + .1;
  }), 'The problem as set up, stones and markup, stays visible (above the controls, or on screen for a tight crop)');
  // On phones the menu and hearts float over the board's top; play stays below them.
  const menu = q('.zen-toolbar .zen-nav-trigger').getBoundingClientRect(), phone = menu.top < 100;
  const band = Math.max(...[menu, q('.zen-hearts')?.getBoundingClientRect()].filter(b => b?.height).map(b => b.bottom)) + 8;
  const first = Math.min(...points.map(p => p.y)) - 1;
  const playTop = (+grid.getAttribute('y') + ((first <= 2 ? 1 : first) - 1.5) * step) * m.d + m.f;
  const framed = ['Auto-fit', 'Full board'].some(name => button(name)?.getAttribute('aria-pressed') === 'true');
  if (phone && framed) check(playTop >= band - .5, `No tap tile of the problem under the menu or hearts: ${playTop.toFixed(1)} vs ${band}`);
  // Only the physical screen edge may cut the board off. The bars are glass over it: the
  // board never shrinks or moves to avoid them. Where the crop is not the board's real edge,
  // the drawing reaches the screen edge on that side.
  const fullW = 2 * +grid.getAttribute('x') + +grid.getAttribute('width'), fullH = 2 * +grid.getAttribute('y') + +grid.getAttribute('height');
  const clipped = { top: view[1] > .01 && r.top > .5, left: view[0] > .01 && r.left > .5,
    bottom: view[1] + view[3] < fullH - .01 && r.bottom < innerHeight - .5, right: view[0] + view[2] < fullW - .01 && r.right < innerWidth - .5 };
  check(!Object.values(clipped).some(Boolean), 'Nothing is cut off before the physical screen edge: ' + JSON.stringify({ clipped, rect: [r.left, r.top, r.right, r.bottom].map(v => +v.toFixed(1)), view: [innerWidth, innerHeight], box: view }));
  check(besogo.editor.getCurrent() === __zenNativePresentation.node, 'Presentation changes preserve the native position');
  return { checks, viewport: [innerWidth, innerHeight], spacing, image: style.backgroundImage,
    texture: [x, y, w, h], board: r.toJSON(), available, box: s.getAttribute('viewBox') };
}

function checkFiniteBoardEdges() {
  const b = document.querySelector('.besogo-board'), svg = b.querySelector('svg');
  const r = svg.getBoundingClientRect(), container = b.getBoundingClientRect(), m = svg.getScreenCTM();
  const g = svg.querySelector('rect.besogo-svg-lines');
  const full = { left: m.e, top: m.f,
    right: m.e + (2 * +g.getAttribute('x') + +g.getAttribute('width')) * m.a,
    bottom: m.f + (2 * +g.getAttribute('y') + +g.getAttribute('height')) * m.d };
  const checks = [], check = (ok, label) => { if (!ok) throw Error(label); checks.push(label); };
  const mat = parseFloat(getComputedStyle(b, '::before').height);
  check(Math.abs(mat - Math.max(0, Math.min(innerHeight, full.top - container.top))) < .1,
    'Top mat ends at the finite board edge, including coordinate gutter');
  const clip = (getComputedStyle(b, '::after').clipPath.match(/-?[\d.]+px/g) || []).map(parseFloat);
  const inset = [clip[0], clip[1] ?? clip[0], clip[2] ?? clip[0], clip[3] ?? clip[1] ?? clip[0]];
  const distance = [r.top - full.top, full.right - r.right, full.bottom - r.bottom, r.left - full.left];
  const reach = parseFloat(getComputedStyle(b).getPropertyValue('--zen-grid-step'));
  check(inset.every((n, i) => Math.abs(n - (Math.abs(distance[i]) < .1 ? -reach : 0)) < .1),
    'Rim and shadow are clipped at every interior crop, exposed only at true edges');
  const [top, right, bottom, left] = distance.map(n => Math.abs(n) < .1), radius = getComputedStyle(svg);
  const fillet = Math.max(reach / 22, 1.5);
  check([[radius.borderTopLeftRadius, top && left], [radius.borderTopRightRadius, top && right],
    [radius.borderBottomRightRadius, bottom && right], [radius.borderBottomLeftRadius, bottom && left]]
    .every(([value, real]) => Math.abs(parseFloat(value) - (real ? fillet : 0)) < .01),
    'Only real board corners round off, at 1 mm on the 22 mm grid');
  const view = svg.getAttribute('viewBox').split(/[ ,]+/).map(Number);
  if (view[1] > .1 && r.height <= b.clientHeight + .1)
    check(r.top <= container.top + .1 && mat < .1, 'Interior top crop extends grid to the viewport without a mat gap');
  return { checks, view, full, surface: r.toJSON(), mat, inset };
}

async function checkEdgeMarginCase(coordinates, reach) {
  const pause = () => new Promise(resolve => setTimeout(resolve, 180));
  const button = text => [...document.querySelectorAll('.zen-toolbar button')].find(b => b.textContent === text);
  const checks = [], check = (ok, label) => { if (!ok) throw Error(label); checks.push(label); };
  // Full board makes both real edges observable regardless of site rotation.
  button('Full board').click();
  for (const margin of ['off', 'on']) {
    await checkPresentationCase('site', coordinates, reach, margin);
    const svg = document.querySelector('.besogo-board>svg'), r = svg.getBoundingClientRect();
    const grid = svg.querySelector('rect.besogo-svg-lines');
    const spacing = +grid.getAttribute('width') / (besogo.editor.getRoot().getSize().x - 1) * svg.getScreenCTM().a;
    const bottom = document.querySelector('.zen-toolbar').getBoundingClientRect().top - r.bottom;
    const rim = margin === 'on' ? spacing / 3 : 0;
    check(r.top >= rim - .1 && bottom >= rim - .1, `${margin} margin, coordinates ${coordinates}, reach ${reach}: mat is outside both real edges and coordinate gutters`);
    if (!reach) check(Math.abs(r.top - bottom) < .1, 'Full board has equal top/bottom spare space');
    if (margin === 'on') {
      button('+').click(); await pause();
      const zoom = +document.querySelector('.besogo-board').style.getPropertyValue('--zen-zoom');
      check(parseFloat(getComputedStyle(svg).marginTop) >= rim * zoom - .1, 'Manual zoom retains the scaled true-top margin');
      checks.push(...checkFiniteBoardEdges().checks);
      const board = document.querySelector('.besogo-board'); board.scrollTop = 80; await pause();
      checks.push(...checkFiniteBoardEdges().checks);
      button('Full board').click(); await pause();
    }
  }
  button('Auto-fit').click();
  const fitted = await checkPresentationCase('site', coordinates, reach, 'on');
  checks.push(...fitted.checks);
  return { checks, viewport: [innerWidth, innerHeight], coordinates, reach };
}

async function checkPresentationRestore() {
  [...document.querySelectorAll('.zen-toolbar button')].find(b => b.textContent === 'Site page').click();
  await new Promise(resolve => setTimeout(resolve, 150));
  const b = document.querySelector('.besogo-board'), s = b.querySelector('svg');
  if (getComputedStyle(b).backgroundImage !== __zenNativePresentation.image ||
      s.getAttribute('viewBox') !== __zenNativePresentation.box ||
      besogo.editor.getCurrent() !== __zenNativePresentation.node || b.hasAttribute('data-zen-fit'))
    throw Error('Native theme, framing or position was not restored');
  return 'Regular mode restores original texture, framing and position';
}
