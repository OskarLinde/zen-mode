import { collectGeometry, chooseView, followView, frameBounds, settledScale, fillViewport, fitBoard, gridFromOutline, requireHitCells, realEdges, svgMargin, EDGE_MARGIN, MIN_ACROSS, randomQuarters, MIN_GRID_STEP, drawPresentation, followFrame, boxOf, playArea } from './geometry.mjs';
import { createSiteMenus, createReviewControls, createHeartIndicator, createAchievementNotices, problemHistory, turnColor, arrowKeyIsReserved, isGuest, splitProblemTitle, composeFeedback, createNextWait, createTapTrace } from './site-ui.mjs';

// Main-world adapter. Reads BesoGo's tree to frame the board, and drives the site's own
// coordinates, rotation, Review and buttons, forwarding explicit clicks from the bar.
// It sends no requests or recording calls of its own and replaces no history.
let target, board, svg, editor, toolbar, observer, messageObserver;
let feedback, feedbackButton, feedbackDialog, feedbackText;
let siteMenus, reviewControls, heartIndicator, achievements, nextWait;
const tapTrace = createTapTrace();
let historySource, failedHere = false;
let presented = false, resume, fallbackStatus;
let active = true, framing = 'frame', zoom = 1, originalBox, lastApplied;
let scheduled = false, geometryReady = false;
let maxZoom = 2;
const buttons = {};
const originalBoardAttributes = new Map();
const listenedBoards = new WeakSet();
const originalAspects = new Map();
const coordinateStyles = new Map();
const boardResize = new ResizeObserver(schedule);
const historyObserver = new MutationObserver(schedule);
const phone = matchMedia('(max-width: 600px)');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function reviewArrow(event) {
  if (!active || !presented || !reviewControls?.hasArrowNavigation() ||
      !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
  // Run after the focused control, before native container/document shortcuts.
  // Keep its default caret/widget behavior, but never fall through into Next
  // while Review is loading or a direction is unavailable.
  event.stopImmediatePropagation();
  if (arrowKeyIsReserved(event, document)) return;
  event.preventDefault();
  if (!event.repeat && !document.documentElement.dataset.zenPreparing) reviewControls.arrow(event.key);
}
const containerArrow = event => { if (event.target === target) reviewArrow(event); };

function schedule() {
  if (scheduled || !active) return;
  scheduled = true;
  // Finish adapting the engine's DOM changes before the next paint. Scheduling
  // another animation frame here exposed its native crop for one visible frame.
  queueMicrotask(() => { scheduled = false; if (active) update(); });
}

function waitForTarget() {
  const found = document.querySelector('#target');
  if (found) return Promise.resolve(found);
  return new Promise(resolve => {
    const giveUp = () => { watch.disconnect(); resolve(null); };
    const watch = new MutationObserver(() => {
      const found = document.querySelector('#target');
      if (found) { clearTimeout(timeout); watch.disconnect(); resolve(found); }
    });
    // A slow page is not a failed one, as in content.js.
    let timeout = setTimeout(giveUp, 60000);
    const loaded = () => { clearTimeout(timeout); timeout = setTimeout(giveUp, 10000); };
    if (document.readyState === 'complete') loaded(); else addEventListener('load', loaded, { once: true });
    watch.observe(document, { childList: true, subtree: true });
  });
}

function readGrid(size, element = svg) {
  // Derive the mapping from the real full-board outline, not hard-coded pixels.
  const outline = element.querySelector('rect.besogo-svg-lines');
  if (!outline || outline.hasAttribute('transform') || element.querySelector('[transform]'))
    throw new Error('Unrecognized grid transformation');
  const numbers = (element, names) => Object.fromEntries(names.map(name => [name, Number(element.getAttribute(name))]));
  const grid = gridFromOutline(numbers(outline, ['x', 'y', 'width', 'height']), size);
  // The inspected engine attaches clicks to these actual SVG cells. It uses either transparent fill (current) or zero opacity (earlier).
  // Require every mapped cell; unknown structures retain the native site view.
  requireHitCells([...element.querySelectorAll('rect[opacity="0"], rect[fill="transparent"]')].map(cell =>
    numbers(cell, ['x', 'y', 'width', 'height'])), grid, size);
  return grid;
}

function setBox(value) {
  lastApplied = value;
  if (svg.getAttribute('viewBox') !== value) svg.setAttribute('viewBox', value);
}

function restoreBox() {
  if (svg && originalBox) setBox(originalBox);
  if (svg && originalAspects.has(svg)) {
    const aspect = originalAspects.get(svg);
    if (aspect === null) svg.removeAttribute('preserveAspectRatio');
    else svg.setAttribute('preserveAspectRatio', aspect);
  }
}

const SURFACE_FALLBACK = '#e6c38b';   // Also in zen.css and transition.js.
function readBoardSurface() {
  // Reading the theme must not temporarily paint wood across the fixed phone
  // viewport: Safari can retain that intermediate color in its browser bars.
  // A hidden, childless probe reads the site's class/inline theme rules without
  // removing the mat from the real board. Keep it outside the observed target.
  const probe = board.cloneNode(false);
  probe.removeAttribute('id');
  probe.removeAttribute('data-zen-fit');
  probe.hidden = true;
  probe.style.setProperty('display', 'none', 'important');
  probe.style.setProperty('position', 'static', 'important');
  document.body.append(probe);
  try { return getComputedStyle(probe).background.replace('rgba(0, 0, 0, 0)', SURFACE_FALLBACK); }
  finally { probe.remove(); }
}

// Native rotation, per loaded problem: it lives in page memory, so nothing is saved
// and the next problem starts from its own orientation. Only a width change asks
// again, so the keyboard and browser bars cannot toggle it.
// Without the option, one fixed direction, so each orientation the site draws keeps
// its own result. Quarters count clockwise turns from the site's own view.
const quarterTurns = new WeakMap();
function turnForViewport(geometry, grid, viewport, band, room) {
  const root = editor.getRoot(), scale = window.besogo?.scaleParameters;
  const turn = quarterTurns.get(root) ?? { quarters: 0, pick: Math.floor(Math.random() * 4) };
  quarterTurns.set(root, turn);
  // A whole board has no shape to fit, so it is never turned, by choice or by need.
  const whole = framing === 'full' || scale?.orientation === 'full-board';
  const random = document.documentElement.dataset.zenRandomTurn === 'on';
  if ((turn.width === viewport.width && turn.random === random && turn.whole === whole) || typeof editor.rotateBoard !== 'function') return false;
  Object.assign(turn, { width: viewport.width, random, whole });
  // Test hook: the checks raise data-zen-min-step to force a turn on a given screen. Unset in use.
  const minStep = Number(document.documentElement.dataset.zenMinStep) || MIN_GRID_STEP;
  // The first decision for this problem holds near the boundaries from now on, one per
  // screen shape, so a visit to landscape does not bias the way back to portrait.
  const shape = viewport.width < viewport.height ? 'portrait' : 'landscape';
  turn.views ??= {};
  const view = chooseView({ size: geometry.size, stones: geometry.stones, moves: geometry.moves, grid, viewport, band, ...room,
    touch: nextMoves(editor.getRoot()), turned: turn.quarters % 2 === 1, hold: turn.views[shape], minStep });
  turn.views[shape] ??= { turned: view.turned, source: view.source };
  const quarters = whole ? 0 : random ? randomQuarters({ size: geometry.size, pick: turn.pick, free: view.free, turn: view.turned,
    halfBoard: scale?.boardCanvasSize !== 'regular board' }) : Number(view.turned);
  if (quarters === turn.quarters) return false;
  if (!quarters) { restoreNativeTurn(); turn.width = viewport.width; return true; }
  // Native rotation and Reset both rewrite the board's inline width and margin.
  if (!turn.quarters) Object.assign(turn, { nativeWidth: board.style.width, nativeMargin: board.style.margin,
    nativeRotation: window.besogo?.scaleParameters?.rotation });
  nativeTurns((quarters - turn.quarters + 4) % 4);
  turn.quarters = quarters;
  return true;
}

// With no move made, Reset shows the problem differently: another corner, mirror and
// colour, through the site's own controls, and a quarter turn under the same rules
// as at load. Nothing is stored or sent; a reload draws from the site again.
const CORNERS = ['TL', 'TR', 'BL', 'BR'];
let reframing = false;
function presentationControls() {
  return { corners: CORNERS.map(name => document.getElementById(`boardOrientation${name}`)).filter(Boolean),
    colour: document.getElementById('colorOrientation') };
}
function canShowDifferently() {
  const { corners, colour } = presentationControls();
  return !!editor && presented && framing !== 'site' && editor.getCurrent?.() === editor.getRoot?.() && !editor.getReviewMode?.() &&
    typeof editor.getTransformationFromSgf === 'function' && (corners.length > 1 || !!colour);
}
function showDifferently() {
  const { corners, colour } = presentationControls(), root = editor.getRoot();
  const shown = () => JSON.stringify(editor.getTransformationFromSgf());
  const before = shown();
  reframing = true;
  document.dispatchEvent(new Event('zen:reframe-start'));
  for (let attempt = 0; attempt < 32 && shown() === before; attempt++) {
    const draw = drawPresentation({ corners: corners.length, colours: colour ? 2 : 1 });
    restoreNativeTurn();
    corners[draw.corner]?.click();
    if (colour && editor.getTransformationFromSgf().invertColors !== (draw.colour === 1)) colour.click();
    const turn = quarterTurns.get(root);
    if (turn) turn.pick = draw.quarters;
    try {
      const geometry = collectGeometry(root), live = board.querySelector(':scope > svg') || svg;
      turnForViewport(geometry, readGrid(geometry.size, live), fitViewport(), topBand());
    } catch {}
  }
  schedule();
}

function nativeTurns(clockwise) {
  if (clockwise === 3) editor.rotateBoard(false);
  else for (let i = 0; i < clockwise; i++) editor.rotateBoard(true);
}

function restoreNativeTurn() {
  const root = editor?.getRoot?.(), turn = root && quarterTurns.get(root);
  if (turn) delete turn.width;
  if (!turn?.quarters) return;
  nativeTurns(4 - turn.quarters);
  turn.quarters = 0;
  if (board) Object.assign(board.style, { width: turn.nativeWidth, margin: turn.nativeMargin });
  // Turning back leaves rotation at 0, not unrotated, which stops hover coordinates.
  if (window.besogo?.scaleParameters && turn.nativeRotation !== undefined) {
    window.besogo.scaleParameters.rotation = turn.nativeRotation;
    if (typeof besogoRotation !== 'undefined') besogoRotation = turn.nativeRotation;
  }
}

// iOS Safari: content.js puts two strips of page content above and below the viewport,
// which Safari draws behind its status bar and toolbar. The scene continues in them as
// if the screen were taller: the mat, and the whole board with its stones, so a crop
// carries on as wood and only a real board edge shows the rim and the mat beyond it.
const EDGE = 240;
const MAT_TINT = [179, 169, 138]; // tatami.png's mean colour under the mat's paper wash
// The live drawing at its full size, at the live board's place on screen. The site
// keeps the drawing; the copy is refreshed whenever it changes.
let copiedSvg = null, copyVersion = 0;
const copyObserver = new MutationObserver(records => {
  if (records.some(r => r.target !== copiedSvg || r.type !== 'attributes')) { copyVersion++; requestEdges(); }
});
let edgesQueued = false;
function requestEdges() {
  if (edgesQueued) return;
  edgesQueued = true;
  requestAnimationFrame(() => { edgesQueued = false; if (active && presented && geometryReady) syncEdges(); });
}
function fullBoard() {
  const outline = svg.querySelector('rect.besogo-svg-lines'), matrix = svg.getScreenCTM();
  if (!outline || !matrix) return null;
  const width = 2 * Number(outline.getAttribute('x')) + Number(outline.getAttribute('width'));
  const height = 2 * Number(outline.getAttribute('y')) + Number(outline.getAttribute('height'));
  return { width, height, left: matrix.e, top: matrix.f, right: matrix.e + width * matrix.a, bottom: matrix.f + height * matrix.d };
}
// A copy of the mat and the whole board for an element whose top sits offset px above
// the viewport's top (negative: below it), its scene inset px larger on each side.
function fillScene(scene, offset, inset, whole = fullBoard()) {
  const mat = getComputedStyle(board);
  Object.assign(scene.style, { backgroundImage: mat.backgroundImage, backgroundSize: mat.backgroundSize,
    backgroundRepeat: mat.backgroundRepeat, backgroundColor: mat.backgroundColor,
    backgroundPositionX: mat.backgroundPositionX.split(', ').map(v => `calc(${v} + ${inset - board.scrollLeft}px)`).join(', '),
    backgroundPositionY: mat.backgroundPositionY.split(', ').map(v => `calc(${v} + ${offset + inset - board.scrollTop}px)`).join(', ') });
  const piece = scene.firstChild;
  if (!whole) { piece.hidden = true; return; }
  const width = whole.right - whole.left, height = whole.bottom - whole.top;
  piece.hidden = false;
  Object.assign(piece.style, { left: `${whole.left + inset}px`, top: `${whole.top + offset + inset}px`, width: `${width}px`, height: `${height}px` });
  for (const key of ['--zen-grid-step', '--zen-surface']) piece.style.setProperty(key, board.style.getPropertyValue(key));
  piece.style.setProperty('--zen-wood-width', `${width}px`); piece.style.setProperty('--zen-wood-height', `${height}px`);
  if (piece.dataset.version === String(copyVersion) && piece.firstChild) return;
  const copy = svg.cloneNode(true);
  for (const node of [copy, ...copy.querySelectorAll('[id]')]) node.removeAttribute('id');
  copy.removeAttribute('style');
  copy.setAttribute('viewBox', `0 0 ${whole.width} ${whole.height}`); copy.setAttribute('preserveAspectRatio', 'none');
  piece.replaceChildren(copy); piece.dataset.version = copyVersion;
}
const sceneElement = className => {
  const element = document.createElement('div'); element.className = className;
  const scene = document.createElement('div'); scene.className = 'zen-edge-scene';
  const piece = document.createElement('div'); piece.className = 'zen-edge-board';
  scene.append(piece); element.append(scene); return element;
};
// WebKit's snapshot across a Next leaves out backdrop-filter, so for that moment the bar
// would show the board sharp through its tint. Just before the snapshot, paint the frost
// from a blurred copy of the mat and wood instead; a plain filter is kept.
addEventListener('pageswap', () => {
  if (!active || !presented || !board || !svg || !toolbar || document.documentElement.dataset.zenBar !== 'glass') return;
  let frost = toolbar.querySelector(':scope > .zen-bar-frost');
  if (!frost) { frost = sceneElement('zen-bar-frost'); frost.setAttribute('aria-hidden', 'true'); toolbar.prepend(frost); }
  fillScene(frost.firstChild, -toolbar.getBoundingClientRect().top, 8);
});

// Safari fades what lies under its status bar and toolbar toward the page's background
// colour; WebKit gives a page that one colour for both edges, or an opaque fill that hides
// the page. Its fade under the toolbar is nearly opaque, so the colour follows what lies
// there, and the same colour tints the top. Edge fade chooses it: Mat, always the mat's own
// colour, so wood under the toolbar never turns the top fade orange (the bottom can read a
// little off over wood); Glass, the bar's glass at its tint over what lies under the toolbar.
const woodMeans = new Map();
function woodMean(surface) {
  const url = surface.match(/url\(["']?([^"')]*)["']?\)/)?.[1];
  const fallback = (surface.match(/rgba?\(([^)]*)\)/)?.[1] || '230, 195, 139').split(',').slice(0, 3).map(Number);
  if (!url) return fallback;
  if (!woodMeans.has(url)) {
    woodMeans.set(url, null);
    const picture = new Image(); picture.src = url;
    picture.decode().then(() => {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
      const context = canvas.getContext('2d'); context.drawImage(picture, 0, 0, 1, 1);
      woodMeans.set(url, [...context.getImageData(0, 0, 1, 1).data.slice(0, 3)]); requestEdges();
    }).catch(() => {});
  }
  return woodMeans.get(url) || fallback;
}
function syncTint(whole) {
  const root = document.documentElement, toolbar = 98, paper = [244, 245, 239];
  const share = (y0, y1) => !whole ? 0 :
    Math.max(0, Math.min(whole.right, innerWidth) - Math.max(whole.left, 0)) / innerWidth *
    Math.max(0, Math.min(whole.bottom, y1) - Math.max(whole.top, y0)) / (y1 - y0);
  const bottom = share(innerHeight, innerHeight + toolbar), mat = getComputedStyle(board);
  const matTint = mat.backgroundImage.includes('url(') ? MAT_TINT : (mat.backgroundColor.match(/\d+/g) || MAT_TINT).slice(0, 3).map(Number);
  const woodTint = root.dataset.zenTheme === 'plain' ? [230, 195, 139] : woodMean(board.style.getPropertyValue('--zen-surface'));
  const scene = wood => matTint.map((m, i) => m + (woodTint[i] - m) * wood);
  const tint = Number(root.dataset.zenBarTint), glass = Number.isFinite(tint) ? tint / 100 : .5;
  let colour;
  if (root.dataset.zenBar === 'solid' || matchMedia('(prefers-reduced-transparency: reduce)').matches) colour = paper;
  else if (root.dataset.zenEdgeFade !== 'glass') colour = matTint;
  else colour = scene(bottom).map((c, i) => paper[i] * glass + c * (1 - glass)); // the bar's glass over the scene
  const hex = '#' + colour.map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
  if (root.style.getPropertyValue('--zen-edge-tint') !== hex) root.style.setProperty('--zen-edge-tint', hex);
  try { sessionStorage.setItem('zen-edge-tint', hex); } catch {}
}
// Changing Edge fade or the bar applies at once: Safari follows the colour live.
new MutationObserver(() => requestEdges()).observe(document.documentElement,
  { attributes: true, attributeFilter: ['data-zen-edge-fade', 'data-zen-bar', 'data-zen-bar-tint', 'data-zen-theme', 'data-zen-surround'] });

function syncEdges() {
  const edges = document.querySelector('.zen-edges');
  if (!edges || !board || !svg) return;
  if (copiedSvg !== svg) {
    copyObserver.disconnect(); copiedSvg = svg; copyVersion++;
    copyObserver.observe(svg, { subtree: true, childList: true, attributes: true, characterData: true });
  }
  const [top, bottom, frost] = edges.children, whole = fullBoard();
  bottom.style.top = frost.style.top = `${EDGE + innerHeight}px`;
  fillScene(top.firstChild, EDGE, 0, whole);
  fillScene(bottom.firstChild, -innerHeight, 0, whole);
  syncTint(whole);
  const scroller = document.scrollingElement;
  if (scroller && scroller.scrollTop !== EDGE) scroller.scrollTop = EDGE;
}
function syncMatEdge(element) {
  // The visible mat above the wood has its own fixed region. Keep its texture
  // in board coordinates while the native scroll container handles manual pan.
  for (const [key, value] of [['grid-x', parseFloat(element.style.getPropertyValue('--zen-grid-x')) - element.scrollLeft],
    ['grid-y', parseFloat(element.style.getPropertyValue('--zen-grid-y')) - element.scrollTop],
    ['edge-y', parseFloat(element.style.getPropertyValue('--zen-edge-y')) +
      parseFloat(element.style.getPropertyValue('--zen-wood-y')) - element.scrollTop]])
    if (Number.isFinite(value)) element.style.setProperty(`--zen-pan-${key}`, `${value}px`);
}

function update() {
  if (!active) return;
  if (!syncZenState()) return;
  syncBar();
  syncBoardElement();
  syncEditor();
  reviewControls.sync(editor, true);
  if (syncCoordinates()) return;
  if (!fitToView()) return;
  if (svg && editor) document.dispatchEvent(new Event('zen:prepared'));
  for (const name of ['frame', 'full']) buttons[name].disabled = !geometryReady;
  for (const name of ['frame', 'full', 'site']) buttons[name].setAttribute('aria-pressed', String(framing === name));
  publishBoardMetrics();
  buttons.zoomOut.disabled = zoom <= 1;
  buttons.zoomIn.disabled = zoom >= maxZoom;
  toolbar.querySelector('output').textContent = `${Math.round(zoom * 100)}%`;
  mirrorSiteText();
}

// Whether Zen mode applies here. If not, hand the page back.
function syncZenState() {
  const supportedMode = (window.mode === undefined || [1, 5].includes(Number(window.mode))) &&
    !target.querySelector('#besogo-pass-button, [id^="besogo-multipleChoice"], [id^="besogo-se-"]');
  if (!supportedMode) document.documentElement.dataset.zenMode = 'off';
  const zenOn = supportedMode && document.documentElement.dataset.zenMode === 'on';
  // The saved view arrives after this script starts. Site view stays per page.
  if (framing !== 'site') framing = document.documentElement.dataset.zenView === 'full' ? 'full' : 'frame';
  tapTrace.sync(zenOn && document.documentElement.dataset.zenShowTaps === 'on');
  if (!zenOn) {
    achievements?.sync(false);
    siteMenus?.sync(false);
    reviewControls?.sync(window.besogo?.editor, false);
    if (presented) { restorePresentation(); svg = undefined; board = undefined; }
    presented = false; toolbar.hidden = true; resume.hidden = !supportedMode;
    document.documentElement.dataset.zen = 'off';
    document.dispatchEvent(new Event('zen:disabled'));
    document.dispatchEvent(new Event('zen:prepared'));
  }
  return zenOn;
}

function syncBar() {
  presented = true; toolbar.hidden = false; resume.hidden = true;
  document.documentElement.dataset.zen = 'on';
  siteMenus?.sync(true);
  heartIndicator?.sync();
  achievements?.sync(true);
  for (const [label, value] of [['Board appearance', document.documentElement.dataset.zenTheme || 'site'],
    ['Outside board', document.documentElement.dataset.zenSurround || 'auto'],
    ['Board transition', document.documentElement.dataset.zenMotion || 'on'],
    ['Board edge margin', document.documentElement.dataset.zenMargin || 'on'],
    ['Bottom bar', document.documentElement.dataset.zenBar || 'glass'],
    ['Edge fade', document.documentElement.dataset.zenEdgeFade || 'mat'],
    ['Show taps (for recording)', document.documentElement.dataset.zenShowTaps || 'off'],
    ['Random ±90° rotation', document.documentElement.dataset.zenRandomTurn || 'off']]) {
    const select = toolbar.querySelector(`select[aria-label="${label}"]`);
    if (select && select.value !== value) select.value = value;
  }
  const tintRange = toolbar.querySelector('input[aria-label="Bar tint"]'), tint = document.documentElement.dataset.zenBarTint ?? '50';
  if (tintRange && tintRange.value !== tint && document.activeElement !== tintRange) {
    tintRange.value = tint; tintRange.nextElementSibling.textContent = `${tint}%`; tintRange.setAttribute('aria-valuetext', `${tint} percent`);
  }
  const more = toolbar.querySelector('.zen-more');
  if (buttons.frame.parentNode !== more) more.prepend(buttons.frame, buttons.full);
  const reach = document.documentElement.dataset.zenReach !== 'off';
  buttons.reach.setAttribute('aria-pressed', String(reach));
  buttons.reach.disabled = !phone.matches;
  buttons.reach.title = phone.matches ? 'Place the puzzle within easier reach' : 'Thumb placement applies to narrow viewports';
}

// Find the current board and SVG, keeping the native crop to restore later.
function syncBoardElement() {
  const nextBoard = target.querySelector('.besogo-board');
  const nextSVG = nextBoard?.querySelector('svg');
  if (nextSVG !== svg) {
    restoreBox();
    board = nextBoard;
    svg = nextSVG;
    originalBox = svg?.getAttribute('viewBox');
    lastApplied = originalBox;
  } else if (svg && svg.getAttribute('viewBox') !== lastApplied) {
    // Rotation/review may set a new native crop. Retain it for Site view/disable.
    originalBox = svg.getAttribute('viewBox');
  }
  if (board && !originalBoardAttributes.has(board)) {
    originalBoardAttributes.set(board, [board.getAttribute('tabindex'), board.getAttribute('aria-label')]);
    boardResize.observe(board);
    board.tabIndex = 0;
    board.setAttribute('aria-label', 'Puzzle board. When zoomed, scroll to pan.');
    if (!listenedBoards.has(board)) {
      listenedBoards.add(board);
      board.addEventListener('scroll', event => { if (active && presented) { syncMatEdge(event.currentTarget); syncEdges(); } }, { passive: true });
      for (const type of ['keydown', 'keyup', 'keypress']) board.addEventListener(type, event => {
        if (type === 'keydown') reviewArrow(event);
        if (active && presented && event.target === board && event.key.startsWith('Arrow')) event.stopPropagation();
      });
    }
  }
}

function syncEditor() {
  const nextEditor = window.besogo?.editor;
  if (nextEditor !== editor) {
    if (typeof editor?.removeListener === 'function') editor.removeListener(schedule);
    editor = nextEditor;
    if (typeof editor?.addListener === 'function') editor.addListener(schedule);
  }
}

// True if the style changed, which redraws the board and schedules another update.
function syncCoordinates() {
  const canSetCoordinates = typeof editor?.getCoordStyle === 'function' && typeof editor?.setCoordStyle === 'function';
  buttons.coordinates.disabled = !canSetCoordinates;
  if (canSetCoordinates) {
    if (!coordinateStyles.has(editor)) coordinateStyles.set(editor, editor.getCoordStyle());
    const preference = document.documentElement.dataset.zenCoordinates || (phone.matches ? 'off' : 'on');
    const desired = preference === 'off' ? 'none' : coordinateStyles.get(editor) === 'none' ? 'western' : coordinateStyles.get(editor);
    buttons.coordinates.setAttribute('aria-pressed', String(desired !== 'none'));
    if (editor.getCoordStyle() !== desired) {
      editor.setCoordStyle(desired);
      schedule();
      return true;
    }
  }
  return false;
}

// The solving area: the board, less a glass bar that floats over it.
function fitViewport() {
  const glass = document.documentElement.dataset.zenBar === 'glass';
  return { width: board.clientWidth, height: board.clientHeight - (glass ? toolbar.getBoundingClientRect().height : 0) };
}

// On phones the menu and the hearts float over the top of the board and never move.
// Play stays below them: the band runs from the board's top to their lower edge plus
// a tap margin. Wider screens keep the menu in the bar, so they have no band.
const TAP_MARGIN = 8;
function topBand() {
  if (!phone.matches) return 0;
  const lows = [...document.querySelectorAll('.zen-toolbar .zen-nav-trigger, .zen-hearts')]
    .map(el => el.getBoundingClientRect()).filter(r => r.height > 0).map(r => r.bottom);
  return lows.length ? Math.max(0, Math.max(...lows) + TAP_MARGIN - board.getBoundingClientRect().top) : 0;
}

// The cells a tap can play next: the recorded moves from the position shown.
function nextMoves(node = editor.getCurrent?.() || editor.getRoot()) {
  return (node?.children || []).map(child => child.move).filter(move => move?.x && move?.y).map(({ x, y }) => ({ x, y }));
}
// Every stone the problem has shown so far: the setup and those on the board now.
function stonesSoFar(geometry) {
  const root = editor.getRoot(), current = editor.getCurrent?.() || root, size = geometry.size, seen = new Set(), stones = [];
  for (const p of geometry.stones) { seen.add(`${p.x},${p.y}`); stones.push(p); }
  if (current !== root) for (let x = 1; x <= size.x; x++) for (let y = 1; y <= size.y; y++)
    if (current.getStone(x, y) && !seen.has(`${x},${y}`)) stones.push({ x, y });
  return stones;
}
// Auto-fit's crop for this problem in the orientation shown (geometry.mjs chooseView), under
// the same decision and hold as the turn. The tight crop follows play itself: it holds
// every stone shown so far and the moves playable next.
// After the first move, the crop keeps its kind and the grid never grows past the step
// shown (geometry.mjs followView): the view may zoom out or pan, never zoom in.
const stepHold = new WeakMap();
function autoFrame(geometry, grid, viewport, band, room) {
  const root = editor.getRoot(), node = editor.getCurrent?.() || root, turn = quarterTurns.get(root);
  // Review browses every branch, not the next tap: it keeps the stones' crop.
  const reviewing = !!editor.getReviewMode?.();
  const hold = turn?.views?.[viewport.width < viewport.height ? 'portrait' : 'landscape'];
  const options = { size: geometry.size, stones: stonesSoFar(geometry), moves: geometry.moves, grid, viewport, band, ...room,
    screen: reviewing ? undefined : room.screen, touch: nextMoves(), turned: (turn?.quarters ?? 0) % 2 === 1, hold };
  if (node !== root && hold) return followView(options, { hold: reviewing ? { ...hold, source: 'stones' } : hold, cap: stepHold.get(root) }).frame;
  return chooseView(options).frame;
}
// As play moves outward the crop grows to hold every stone now on the board; it never
// shrinks during a problem, and the problem's starting position (load, Reset) shows the
// initial crop again. Kept per problem in page memory.
const follows = new WeakMap();
function followOn(geometry, frame) {
  if (frame.source === 'tight') return frame;
  const root = editor.getRoot(), current = editor.getCurrent?.() || root, size = geometry.size;
  if (current === root || !follows.has(root)) follows.set(root, frame.bounds);
  if (current === root) return frame;
  const stones = [];
  for (let x = 1; x <= size.x; x++) for (let y = 1; y <= size.y; y++) if (current.getStone(x, y)) stones.push({ x, y });
  const bounds = followFrame(follows.get(root), stones, size);
  follows.set(root, bounds);
  const played = boxOf(stones), core = frame.problem;
  const grown = played ? { left: Math.min(core.left, played.left), top: Math.min(core.top, played.top),
    right: Math.max(core.right, played.right), bottom: Math.max(core.bottom, played.bottom) } : core;
  return { ...frame, bounds, problem: playArea(grown, geometry.moves, bounds, size) };
}

// Applies a fitted view to the SVG and sets the sizes the look reads. surface: also read
// the board's surface, which needs a probe; camera frames reuse the last one.
function applyFitted(fitted, geometry, grid, viewport, { surface = true } = {}) {
  if (framing === 'site') restoreBox();
  else {
    if (!originalAspects.has(svg)) originalAspects.set(svg, svg.getAttribute('preserveAspectRatio'));
    svg.setAttribute('preserveAspectRatio', `x${fitted.alignX}Y${fitted.alignY} meet`);
    setBox(fitted.box.join(' '));
  }
  const view = svg.getAttribute('viewBox').split(/[ ,]+/).map(Number);
  maxZoom = Math.max(1, Math.min(2, view[2] / (grid.step * Math.min(MIN_ACROSS, geometry.size.x))));
  zoom = Math.min(zoom, maxZoom);
  const scale = settledScale({ ...fitted, box: view }, viewport);
  // Native image-only themes have a transparent fallback; the mat must not
  // shine through while their wood image is decoding.
  if (surface) board.style.setProperty('--zen-surface', readBoardSurface());
  board.dataset.zenFit = 'on';
  board.style.setProperty('--zen-svg-width', `${view[2] * scale}px`);
  board.style.setProperty('--zen-svg-height', `${view[3] * scale}px`);
  const edgeMargin = document.documentElement.dataset.zenMargin === 'on' && framing !== 'site' ? grid.step * scale * EDGE_MARGIN : 0;
  board.style.setProperty('--zen-svg-margin', svgMargin({ fitted, view, grid, size: geometry.size, scale, viewport, edgeMargin, zoom }));
}

// The follow-on camera. When play moves the crop, the view glides there over CAMERA_MS
// instead of jumping. A view is the grid step and where line 1 sits on screen; each frame
// is a real fit of the view in between, so board, rim, mat, tatami and the edge strips
// agree throughout. Steady and Reduced Motion land at once; Next, Reset and Show
// differently cancel a glide. A tap during a glide is held, mapped to the intersection
// that was under it, and played on that intersection once the view has landed.
const CAMERA_MS = 300;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let camera = null, shownView = null;
const cameraOf = (fitted, grid) => ({ step: grid.step * fitted.scale,
  x: fitted.offsetLeft + (grid.x - fitted.box[0]) * fitted.scale, y: fitted.offsetTop + (grid.y - fitted.box[1]) * fitted.scale });
const sameView = (a, b) => Math.abs(a.step - b.step) < .05 && Math.abs(a.x - b.x) < .5 && Math.abs(a.y - b.y) < .5;
function fittedFor(view, { geometry, grid, viewport, glassHeight }) {
  const placed = fillViewport({ box: [grid.x, grid.y, grid.step, grid.step], alignX: 'Min', alignY: 'Min', scale: view.step / grid.step,
    offsetLeft: view.x, offsetTop: view.y }, geometry.size, grid, viewport);
  return glassHeight === undefined ? placed : fillViewport(placed, geometry.size, grid, { ...viewport, height: glassHeight });
}
function startCamera(from, to, final) {
  const glide = camera = { from, to, final, now: from, start: performance.now(), held: camera?.held ?? null };
  applyFitted(fittedFor(from, final), final.geometry, final.grid, final.viewport, { surface: false });
  const ease = t => t < .5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
  const tick = time => {
    if (camera !== glide) return;
    const t = Math.min(1, (time - glide.start) / CAMERA_MS), e = ease(t);
    glide.now = { step: from.step + (to.step - from.step) * e, x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e };
    if (t >= 1) { landCamera(); return; }
    applyFitted(fittedFor(glide.now, final), final.geometry, final.grid, final.viewport, { surface: false });
    publishBoardMetrics(); requestEdges();
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
function landCamera() {
  const glide = camera;
  if (!glide) return;
  camera = null;
  const { fitted, geometry, grid, viewport } = glide.final;
  applyFitted(fitted, geometry, grid, viewport);
  publishBoardMetrics(); requestEdges();
  if (glide.held) playHeld(glide.held, glide.to);
}
// Next, Reset and other instant changes: the view lands where it is going now, and a
// held tap is dropped, since what it aimed at is no longer there.
function stopCamera() { if (camera) { camera.held = null; landCamera(); } }
function playHeld({ x, y }, view) {
  const box = board.getBoundingClientRect();
  const clientX = box.left + board.clientLeft + view.x + (x - 1) * view.step, clientY = box.top + board.clientTop + view.y + (y - 1) * view.step;
  const target = document.elementFromPoint(clientX, clientY);
  if (!target || !board.contains(target)) return;
  const init = { bubbles: true, cancelable: true, clientX, clientY, view: window, button: 0, isPrimary: true, pointerType: 'touch' };
  for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'])
    target.dispatchEvent(type.startsWith('pointer') ? new PointerEvent(type, init) : new MouseEvent(type, init));
}
function holdTap(event) {
  if (!camera || !board?.contains(event.target) || event.isTrusted === false) return;
  event.preventDefault(); event.stopImmediatePropagation();
  if (event.type !== 'pointerdown' || !event.isPrimary) return;
  const box = board.getBoundingClientRect(), view = camera.now, size = editor.getRoot().getSize();
  const x = Math.round((event.clientX - box.left - board.clientLeft - view.x) / view.step) + 1;
  const y = Math.round((event.clientY - box.top - board.clientTop - view.y) / view.step) + 1;
  if (x >= 1 && x <= size.x && y >= 1 && y <= size.y) camera.held = { x, y };
}
for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'click']) document.addEventListener(type, holdTap, { capture: true, passive: false });
for (const type of ['pageswap', 'pagehide']) addEventListener(type, stopCamera);
document.addEventListener('zen:reframe-start', stopCamera);

// Fits the board to the view. False if it turned, which schedules another update.
function fitToView() {
  geometryReady = false;
  try {
    if (!svg || !editor) throw new Error('Board not ready');
    const geometry = collectGeometry(editor.getRoot());
    const grid = readGrid(geometry.size);
    geometryReady = true;
    fallbackStatus.hidden = true; resume.textContent = 'Zen mode';
    // Re-read every branch on each update, including local exploration added
    // during review. Review keeps the selected framing mode above its panel.
    board.style.setProperty('--zen-review-dot', `${grid.step * .28}px`);
    const viewport = fitViewport(), glass = document.documentElement.dataset.zenBar === 'glass';
    const band = topBand(), thumb = phone.matches && document.documentElement.dataset.zenReach !== 'off';
    // The whole board area, under the glass bar too, where stones may show but taps may not.
    const room = { screen: glass ? { width: viewport.width, height: board.clientHeight } : viewport,
      bar: glass ? board.clientHeight - viewport.height : 0, reach: thumb };
    if (turnForViewport(geometry, grid, viewport, band, room)) { geometryReady = false; schedule(); return false; }
    const frame = framing === 'full' ? null : followOn(geometry, autoFrame(geometry, grid, viewport, band, room));
    // Which crop Auto-fit chose: the stones, or (touch fallback) where play happens.
    if (frame) { board.dataset.zenFrame = frame.source; board.dataset.zenCrop = [frame.bounds.left, frame.bounds.top, frame.bounds.right, frame.bounds.bottom].join(','); }
    else { delete board.dataset.zenFrame; delete board.dataset.zenCrop; }
    const bounds = frame ? frame.bounds : frameBounds(geometry.size, []);
    const playing = (editor.getCurrent?.() || editor.getRoot()) !== editor.getRoot();
    const fitted = fitBoard({ planned: frame?.source === 'tight' ? frame.fitted : undefined, maxStep: playing ? stepHold.get(editor.getRoot()) : undefined, bounds, problem: frame ? frame.problem : frameBounds(geometry.size, geometry.points), size: geometry.size, grid, viewport,
      framing, thumb, zoom, band, margin: document.documentElement.dataset.zenMargin === 'on', glassHeight: glass ? board.clientHeight : undefined });
    // Follow-on re-fits within a problem glide; everything else lands at once.
    const root = editor.getRoot(), node = editor.getCurrent?.() || root, target = cameraOf(fitted, grid);
    const key = [viewport.width, viewport.height, board.clientHeight, framing, zoom, quarterTurns.get(root)?.quarters ?? 0].join();
    const motion = document.documentElement.dataset.zenMotion !== 'off' && !reducedMotion.matches;
    const glide = motion && framing === 'frame' && zoom === 1 && shownView?.root === root && shownView.key === key &&
      node !== root && shownView.node !== node && !sameView(camera?.now ?? shownView.view, target);
    if (glide) startCamera(camera?.now ?? shownView.view, target, { fitted, geometry, grid, viewport, glassHeight: glass ? board.clientHeight : undefined });
    else { stopCamera(); applyFitted(fitted, geometry, grid, viewport); }
    shownView = { root, node, key, view: target };
    if (framing === 'frame' && zoom === 1) stepHold.set(root, node === root ? target.step : Math.min(stepHold.get(root) ?? target.step, target.step));
    // The new presentation is laid out: the handoff can now move to it.
    if (reframing) { reframing = false; requestAnimationFrame(() => document.dispatchEvent(new Event('zen:reframe-end'))); }
  } catch {
    restoreBox();
    if (board) board.removeAttribute('data-zen-fit');
    if (svg) {
      fallbackStatus.textContent = 'Zen mode could not safely fit this board. The original page remains available.';
      fallbackStatus.hidden = false; resume.textContent = 'Retry Zen mode';
      document.documentElement.dataset.zenMode = 'off';
      schedule();
    }
  }
  return true;
}

// The metrics the look in zen.css and the handoff in transition.js both read.
function publishBoardMetrics() {
  if (board) {
    board.style.setProperty('--zen-zoom', zoom);
    if (geometryReady && svg) {
      const surface = svg.getBoundingClientRect(), container = board.getBoundingClientRect();
      for (const [key, value] of [['x', surface.left - container.left + board.scrollLeft],
        ['y', surface.top - container.top + board.scrollTop], ['width', surface.width], ['height', surface.height]])
        board.style.setProperty(`--zen-edge-${key}`, `${value}px`);
      // A camera over one physical board/mat: textures use the same origin and
      // scale as the intersections, even with motion disabled or manual zoom.
      const outline = svg.querySelector('rect.besogo-svg-lines'), matrix = svg.getScreenCTM();
      const size = editor.getRoot().getSize(), step = Number(outline.getAttribute('width')) / (size.x - 1) * matrix.a;
      const fullWidth = (2 * Number(outline.getAttribute('x')) + Number(outline.getAttribute('width'))) * matrix.a;
      const fullHeight = (2 * Number(outline.getAttribute('y')) + Number(outline.getAttribute('height'))) * matrix.d;
      // The frame follows the clipped SVG, but may cast a rim/shadow only at
      // real outer edges. Clipping avoids expanding the board's scroll range.
      const [top, right, bottom, left] = realEdges(surface, matrix, fullWidth, fullHeight);
      board.style.setProperty('--zen-rim-clip', [top, right, bottom, left].map(real => real ? `${-step}px` : '0px').join(' '));
      for (const [key, value] of [['tl', top && left], ['tr', top && right], ['br', bottom && right], ['bl', bottom && left]])
        board.style.setProperty(`--zen-corner-${key}`, value ? 1 : 0);
      for (const [key, value] of [['top', top], ['right', right], ['bottom', bottom], ['left', left]])
        board.style.setProperty(`--zen-true-${key}`, value ? 1 : 0);
      for (const [key, value] of [['x', Number(outline.getAttribute('x')) * matrix.a + matrix.e - container.left + board.scrollLeft],
        ['y', Number(outline.getAttribute('y')) * matrix.d + matrix.f - container.top + board.scrollTop],
        ['step', step], ['span', Math.max(size.x, size.y) * step]])
        board.style.setProperty(`--zen-grid-${key}`, `${value}px`);
      // The wood includes the native coordinate gutter, which is wider than
      // half a cell. Anchor the texture to the actual full-board SVG bounds.
      for (const [key, value] of [['x', matrix.e - surface.left], ['y', matrix.f - surface.top],
        ['width', fullWidth], ['height', fullHeight]])
        board.style.setProperty(`--zen-wood-${key}`, `${value}px`);
      syncMatEdge(board);
      syncEdges();
    }
  }
}

// Carry the site's status, title and comments into the bar.
function mirrorSiteText() {
  const nativeStatus = document.querySelector('#status');
  const status = nativeStatus?.textContent.trim();
  const navigationItem = document.querySelector('#currentNavigationButton')?.closest('.problem-nav__item');
  if (navigationItem !== historySource) {
    historyObserver.disconnect(); historySource = navigationItem;
    if (historySource) historyObserver.observe(historySource, { attributes: true, attributeFilter: ['class'], childList: true, characterData: true, subtree: true });
  }
  // lineLost/failAlreadyReported are deliberately not read: they can expose a
  // refutation before the site's visible result. Remember only a revealed fail.
  if (!editor?.getReviewMode?.() && nativeStatus && !nativeStatus.hidden && nativeStatus.style.display !== 'none' &&
      nativeStatus.querySelector('h2')?.textContent.trim() === 'Incorrect!') failedHere = true;
  const training = Number(window.mode) === 5;
  const tileCode = [...(navigationItem?.classList || [])].map(name => name.match(/^problem-nav__item--([A-Z])$/)?.[1]).find(Boolean);
  const history = problemHistory({ code: tileCode || (training ? undefined : window.tStatus), training,
    ratio: navigationItem?.querySelector('.problem-nav__ratio')?.textContent || '',
    missed: !!navigationItem?.querySelector('.problem-nav__rung--missed'), failedHere, guest: isGuest() });
  const historyLabel = toolbar.querySelector('.zen-history');
  historyLabel.hidden = !history;
  historyLabel.textContent = history?.label || '';
  historyLabel.title = history?.detail || '';
  historyLabel.setAttribute('aria-label', history ? `Problem history: ${history.label}. ${history.detail}` : 'Problem history');
  const solved = toolbar.querySelector('.zen-solved');
  solved.hidden = history?.label !== 'Solved';
  solved.title = history?.detail || '';
  solved.setAttribute('aria-label', history?.label === 'Solved' ? `Solved. ${history.detail}` : 'Solved');
  const description = document.querySelector('#descriptionText, #titleDescription')?.textContent.trim();
  const title = document.querySelector('#playTitle')?.textContent.replace(/\s+/g, ' ').trim() || '';
  const parts = splitProblemTitle(title);
  const problem = toolbar.querySelector('.zen-problem');
  problem.title = title;
  problem.querySelector('.zen-set').textContent = parts.set;
  problem.querySelector('.zen-number').textContent = parts.number;
  const liveStatus = toolbar.querySelector('.zen-live-status');
  liveStatus.textContent = status && status !== 'Ready to play' ? status : description || (svg ? 'Ready' : 'Board loading…');
  liveStatus.dataset.turn = turnColor(liveStatus.textContent);
  // Continuation prompts and explanations use a different native channel from
  // the result. Its inline display state also matters: Reset can hide old text.
  const nativeComment = document.querySelector('#theComment');
  const continuation = nativeComment && !nativeComment.hidden && nativeComment.style.display !== 'none'
    ? nativeComment.textContent.trim() : '';
  const trainingNotes = Number(window.mode) === 5 ?
    [...document.querySelectorAll('.mistake-training-replay, #status .mistake-training-note, #status .mistake-training-outcome')]
      .filter(element => !element.hidden && element.style.display !== 'none')
      .map(element => element.textContent.trim()).filter(Boolean) : [];
  const comment = composeFeedback(continuation, nativeStatus?.querySelector('h2')?.textContent.trim(), trainingNotes);
  const inReviewPanel = reviewControls.showComment(comment);
  reviewControls.showConversation();
  feedback.hidden = !comment || inReviewPanel;
  toolbar.querySelector('.zen-live-status').hidden = !!comment && !inReviewPanel;
  if (feedbackButton.textContent !== comment) {
    feedbackButton.textContent = comment;
    feedbackText.textContent = comment;
    feedbackText.scrollTop = 0;
  }
  if (!comment && feedbackDialog.open) feedbackDialog.close();
  for (const [name, selector] of [['back', '[id^="besogo-back-button"]'], ['reset', '[id^="besogo-reset-button"]'], ['next', '[id^="besogo-next-button"]']]) {
    const native = siteMenus?.findControl(selector) || target.querySelector(selector);
    buttons[name].disabled = !native || native.id.endsWith('-inactive') || native.disabled;
  }
  const differently = canShowDifferently(), resetLabel = differently ? 'Show differently' : 'Reset problem';
  if (buttons.reset.title !== resetLabel) { buttons.reset.title = resetLabel; buttons.reset.setAttribute('aria-label', resetLabel); }
  if (differently) buttons.reset.disabled = false;
}

function restorePresentation() {
  restoreBox();
  restoreNativeTurn();
  for (const [el, attrs] of originalBoardAttributes) {
    el.style.removeProperty('--zen-zoom');
    for (const key of ['--zen-surface', '--zen-svg-width', '--zen-svg-height', '--zen-svg-margin', '--zen-review-dot',
      '--zen-edge-x', '--zen-edge-y', '--zen-edge-width', '--zen-edge-height', '--zen-rim-clip',
      '--zen-corner-tl', '--zen-corner-tr', '--zen-corner-br', '--zen-corner-bl',
      '--zen-true-top', '--zen-true-right', '--zen-true-bottom', '--zen-true-left',
      '--zen-grid-x', '--zen-grid-y', '--zen-grid-step', '--zen-grid-span',
      '--zen-wood-x', '--zen-wood-y', '--zen-wood-width', '--zen-wood-height',
      '--zen-pan-grid-x', '--zen-pan-grid-y', '--zen-pan-edge-y']) el.style.removeProperty(key);
    el.removeAttribute('data-zen-fit');
    ['tabindex', 'aria-label'].forEach((name, i) => attrs[i] === null ? el.removeAttribute(name) : el.setAttribute(name, attrs[i]));
  }
  if (coordinateStyles.has(editor) && typeof editor.setCoordStyle === 'function') editor.setCoordStyle(coordinateStyles.get(editor));
  coordinateStyles.delete(editor); originalBoardAttributes.clear();
}

function disable() {
  active = false;
  document.dispatchEvent(new Event('zen:disabled'));
  document.body.removeEventListener('keydown', reviewArrow);
  target?.removeEventListener('keydown', containerArrow, true);
  reviewControls?.destroy();
  heartIndicator?.destroy();
  achievements?.destroy();
  siteMenus?.destroy();
  observer?.disconnect();
  messageObserver?.disconnect();
  boardResize.disconnect();
  historyObserver.disconnect();
  if (typeof editor?.removeListener === 'function') editor.removeListener(schedule);
  restorePresentation();
  toolbar?.remove(); resume?.remove(); fallbackStatus?.remove();
  document.documentElement.removeAttribute('data-zen');
  document.documentElement.style.removeProperty('--zen-tatami-image');

}

function buildToolbar() {
  toolbar = document.createElement('section');
  toolbar.className = 'zen-toolbar';
  toolbar.setAttribute('aria-label', 'Zen Mode view controls');
  const controls = document.createElement('div');
  controls.className = 'zen-controls';
  toolbar.append(controls);
  function button(name, title, action, parent = controls) {
    const el = document.createElement('button');
    el.type = 'button';
    el.textContent = title;
    el.addEventListener('click', action);
    parent.append(el);
    buttons[name] = el;
    return el;
  }
  for (const [name, title] of [['frame', 'Auto-fit'], ['full', 'Full board']]) {
    button(name, title, () => {
      framing = name; zoom = 1;
      document.documentElement.dataset.zenView = name;
      document.dispatchEvent(new CustomEvent('zen:zenView', { detail: name }));
      update(); board?.scrollTo(0, 0);
    });
  }
  const options = document.createElement('details');
  options.className = 'zen-options';
  const summary = document.createElement('summary'); summary.textContent = 'View options';
  options.append(summary); controls.append(options);
  const more = document.createElement('div'); more.className = 'zen-more'; options.append(more);
  button('site', 'Site view', () => { framing = 'site'; zoom = 1; update(); board?.scrollTo(0, 0); }, more);
  button('coordinates', 'Coordinates', () => {
    const value = editor.getCoordStyle() === 'none' ? 'on' : 'off';
    document.documentElement.dataset.zenCoordinates = value;
    document.dispatchEvent(new CustomEvent('zen:zenCoordinates', { detail: value }));
    update();
  }, more);
  button('reach', 'Thumb reach', () => {
    const value = document.documentElement.dataset.zenReach === 'off' ? 'on' : 'off';
    document.documentElement.dataset.zenReach = value;
    document.dispatchEvent(new CustomEvent('zen:zenReach', { detail: value }));
    update();
  }, more);
  const chooseZen = value => {
    siteMenus?.close();
    if (value === 'off') { fallbackStatus.hidden = true; resume.textContent = 'Zen mode'; }
    document.documentElement.dataset.zenMode = value;
    document.dispatchEvent(new CustomEvent('zen:zenMode', { detail: value }));
    options.open = false;
    schedule();
  };
  button('sitePage', 'Site page', () => chooseZen('off'), more);
  resume = document.createElement('button'); resume.type = 'button';
  resume.className = 'zen-resume'; resume.textContent = 'Zen mode'; resume.hidden = true;
  resume.onclick = event => { event.stopPropagation(); chooseZen('on'); };
  fallbackStatus = document.createElement('p'); fallbackStatus.className = 'zen-mode-fallback';
  fallbackStatus.id = 'zen-mode-fallback'; fallbackStatus.hidden = true; fallbackStatus.setAttribute('role', 'status');
  resume.setAttribute('aria-describedby', fallbackStatus.id);
  target.before(resume, fallbackStatus);
  for (const [name, title, selector] of [['back', 'Previous problem', '[id^="besogo-back-button"]']]) {
    button(name, title, () => {
      const native = siteMenus.findControl(selector);
      siteMenus.close();
      native?.click();
      options.open = false;
    }, more);
  }
  button('zoomOut', '−', () => { zoom = Math.max(1, zoom - 0.25); update(); }, more).setAttribute('aria-label', 'Zoom out');
  const output = document.createElement('output');
  output.setAttribute('aria-label', 'Board zoom');
  more.append(output);
  button('zoomIn', '+', () => { zoom = Math.min(maxZoom, zoom + 0.25); update(); }, more).setAttribute('aria-label', 'Zoom in');
  buildSettings(options);
  buildBarText(options);
  for (const [name, title, selector] of [['reset', 'Reset', '[id^="besogo-reset-button"]'], ['next', 'Next', '[id^="besogo-next-button"]']]) {
    const control = button(name, title, () => {
      if (name === 'reset' && canShowDifferently()) { showDifferently(); return; }
      const native = siteMenus.findControl(selector);
      if (name === 'next' && native && !native.id.endsWith('-inactive')) nextWait.start();
      native?.click();
    }, toolbar);
    control.className = `zen-bar-action zen-${name}`;
    if (name === 'reset') {
      control.setAttribute('aria-label', 'Reset problem'); control.title = 'Reset problem';
    }
  }
  nextWait = createNextWait(buttons.next);
  // The site's arrow key and locked-account board tap go straight to its Next link.
  window.navigation?.addEventListener('navigate', event => {
    if (active && presented && window.nextButtonLink && event.destination.url === new URL(window.nextButtonLink, location.href).href) nextWait.start();
  });
  window.navigation?.addEventListener('navigateerror', nextWait.clear);
  for (const type of ['pageswap', 'pagehide', 'pageshow']) addEventListener(type, nextWait.clear);
  wireToolbar(options);
}

// The ••• sheet's settings: board look, bar, motion and their saved values.
function buildSettings(options) {
  const themeLabel = document.createElement('label');
  themeLabel.className = 'zen-theme';
  themeLabel.textContent = 'Board ';
  const theme = document.createElement('select');
  theme.setAttribute('aria-label', 'Board appearance');
  for (const [value, text] of [['plain', 'Plain · steady'], ['site', 'Site theme']]) {
    const option = document.createElement('option'); option.value = value; option.textContent = text; theme.append(option);
  }
  theme.value = document.documentElement.dataset.zenTheme || 'site';
  theme.onchange = () => {
    document.documentElement.dataset.zenTheme = theme.value;
    document.dispatchEvent(new CustomEvent('zen:zenTheme', { detail: theme.value }));
    update();
  };
  themeLabel.append(theme);
  options.append(themeLabel);
  const surroundLabel = document.createElement('label');
  surroundLabel.className = 'zen-theme'; surroundLabel.textContent = 'Outside board ';
  const surround = document.createElement('select'); surround.setAttribute('aria-label', 'Outside board');
  for (const [value, text] of [['auto', 'Auto · match board'], ['woven', 'Woven · subtle'], ['natural', 'Natural tatami'], ['solid', 'Solid · sage']]) {
    const option = document.createElement('option'); option.value = value; option.textContent = text; surround.append(option);
  }
  surround.value = document.documentElement.dataset.zenSurround || 'auto';
  surround.onchange = () => {
    document.documentElement.dataset.zenSurround = surround.value;
    document.dispatchEvent(new CustomEvent('zen:zenSurround', { detail: surround.value }));
    update();
  };
  surroundLabel.append(surround); options.append(surroundLabel);
  for (const [key, title, choices] of [
    ['zenMargin', 'Board edge margin', [['on', 'Small · ⅓ grid'], ['off', 'None']]],
    ['zenBar', 'Bottom bar', [['glass', 'Frosted glass'], ['solid', 'Solid']]],
    ['zenEdgeFade', 'Edge fade', [['mat', 'Mat'], ['glass', 'Glass']]],
    ['zenShowTaps', 'Show taps (for recording)', [['off', 'Off'], ['on', 'On']]],
    ['zenRandomTurn', 'Random ±90° rotation', [['off', 'Off'], ['on', 'On']]]
  ]) {
    const label = document.createElement('label'); label.className = key === 'zenEdgeFade' ? 'zen-theme zen-edge-fade' : 'zen-theme'; label.textContent = `${title} `;
    const select = document.createElement('select'); select.setAttribute('aria-label', title);
    for (const [value, text] of choices) { const option = document.createElement('option'); option.value = value; option.textContent = text; select.append(option); }
    select.value = document.documentElement.dataset[key] || choices[0][0];
    select.onchange = () => {
      document.documentElement.dataset[key] = select.value;
      document.dispatchEvent(new CustomEvent(`zen:${key}`, { detail: select.value })); update();
    };
    label.append(select); options.append(label);
  }
  // Bar tint: how much paper the glass bar adds over the board, live while dragging.
  const tintLabel = document.createElement('label'); tintLabel.className = 'zen-theme zen-bar-tint'; tintLabel.textContent = 'Bar tint ';
  const tintRange = document.createElement('input'); tintRange.type = 'range'; tintRange.min = '22'; tintRange.max = '64'; tintRange.step = '1';
  tintRange.setAttribute('aria-label', 'Bar tint');
  const tintValue = document.createElement('output'); tintValue.className = 'zen-bar-tint-value';
  const showTint = () => { tintValue.textContent = `${tintRange.value}%`; tintRange.setAttribute('aria-valuetext', `${tintRange.value} percent`); };
  tintRange.value = document.documentElement.dataset.zenBarTint ?? '50'; showTint();
  tintRange.oninput = () => { document.documentElement.dataset.zenBarTint = tintRange.value; showTint(); };
  tintRange.onchange = () => { document.dispatchEvent(new CustomEvent('zen:zenBarTint', { detail: tintRange.value })); };
  tintLabel.append(tintRange, tintValue); options.append(tintLabel);
  const randomHelp = document.createElement('div'); randomHelp.className = 'zen-option-help';
  randomHelp.textContent = 'Adds a random quarter turn on each problem when the board still fits. It also applies if your site setting is Original. Before your first move, Reset shows the problem differently: another corner, mirror and colour, and a quarter turn when this is on, whatever your site setting.';
  options.append(randomHelp);
  const motionLabel = document.createElement('label');
  motionLabel.className = 'zen-theme'; motionLabel.textContent = 'Board transition ';
  const motion = document.createElement('select'); motion.setAttribute('aria-label', 'Board transition');
  for (const [value, text] of [['off', 'Steady · no animation'], ['on', 'Pan & crossfade']]) {
    const option = document.createElement('option'); option.value = value; option.textContent = text; motion.append(option);
  }
  const canAnimate = typeof window.PageSwapEvent === 'function' && typeof window.PageRevealEvent === 'function';
  motion.disabled = !canAnimate;
  if (!canAnimate) {
    motion.title = 'This browser uses ordinary navigation; board transitions are unavailable.';
    motion.options[1].textContent += ' · unavailable';
  }
  motion.value = document.documentElement.dataset.zenMotion || 'on';
  motion.onchange = () => {
    document.documentElement.dataset.zenMotion = motion.value;
    document.dispatchEvent(new CustomEvent('zen:zenMotion', { detail: motion.value }));
  };
  motionLabel.append(motion); options.append(motionLabel);
}

// The bar's text: the problem's set and number, the live status and the feedback dialog.
function buildBarText(options) {
  const context = document.createElement('div'); context.className = 'zen-context';
  const problem = document.createElement('div'); problem.className = 'zen-problem';
  for (const name of ['zen-set', 'zen-number']) {
    if (problem.childNodes.length) problem.append(' ');
    const part = document.createElement('span'); part.className = name; problem.append(part);
  }
  const solved = document.createElement('span'); solved.className = 'zen-solved'; solved.hidden = true; solved.setAttribute('role', 'img');
  problem.append(solved);
  const liveStatus = document.createElement('span'); liveStatus.className = 'zen-live-status'; liveStatus.setAttribute('role', 'status');
  feedback = document.createElement('div'); feedback.className = 'zen-feedback'; feedback.hidden = true;
  feedback.setAttribute('role', 'status'); feedback.setAttribute('aria-live', 'polite'); feedback.setAttribute('aria-atomic', 'true');
  feedbackButton = document.createElement('button'); feedbackButton.type = 'button';
  feedbackButton.title = 'Read full problem feedback'; feedbackButton.setAttribute('aria-haspopup', 'dialog');
  feedback.append(feedbackButton);
  const history = document.createElement('span'); history.className = 'zen-history'; history.hidden = true;
  options.append(history);
  context.append(problem, liveStatus, feedback); toolbar.append(context);
  feedbackDialog = document.createElement('dialog'); feedbackDialog.className = 'zen-feedback-dialog';
  const feedbackHeading = document.createElement('h2'); feedbackHeading.id = 'zen-feedback-title'; feedbackHeading.textContent = 'Problem feedback';
  feedbackDialog.setAttribute('aria-labelledby', feedbackHeading.id);
  feedbackText = document.createElement('p');
  const closeFeedback = document.createElement('button'); closeFeedback.type = 'button'; closeFeedback.textContent = 'Close';
  closeFeedback.onclick = () => feedbackDialog.close();
  feedbackButton.onclick = () => feedbackDialog.showModal();
  feedbackDialog.append(feedbackHeading, feedbackText, closeFeedback); toolbar.append(feedbackDialog);
}

// Event guards, menus, Review, hearts and notices around the finished bar.
function wireToolbar(options) {
  // View controls must never count as the site's click-after-success gesture.
  for (const event of ['click', 'dblclick', 'keydown', 'keyup', 'keypress'])
    toolbar.addEventListener(event, e => {
      if (event === 'keydown') reviewArrow(e);
      // Native UI keeps ancestor/document delegation for forms and widgets.
      // It is never inside the board, so these events cannot be board taps.
      if (!e.target.closest('.zen-native-ui')) e.stopPropagation();
    });
  // BesoGo clears #target while initializing. Keep view controls beside it.
  target.before(toolbar);
  siteMenus = createSiteMenus({ toolbar, target, options, update: schedule });
  reviewControls = createReviewControls({ toolbar, target, update: schedule, openComment: () => feedbackDialog.showModal(),
    findControl: selector => siteMenus.findControl(selector), closeMenus: () => siteMenus.close(), openConversation: () => siteMenus.openConversation() });
  heartIndicator = createHeartIndicator(toolbar);
  achievements = createAchievementNotices({ toolbar });
  document.body.addEventListener('keydown', reviewArrow);
  // The engine's focusable container handles at-target keys before body.
  target.addEventListener('keydown', containerArrow, true);
}

// Observe parser progress instead of polling: a 100ms poll could let the site
// render the board before the reserved toolbar and framing were installed.
document.addEventListener('zen:startup-failed', disable, { once: true });
target = await waitForTarget();
if (target && active && ['on', 'off'].includes(document.documentElement.dataset.zen)) {
  buildToolbar();
  document.documentElement.dataset.zenReady = 'on';
  document.dispatchEvent(new Event('zen:ready'));
  observer = new MutationObserver(records => {
    if (records.some(r => !toolbar.contains(r.target) &&
        !(r.type === 'attributes' && r.target === svg && svg.getAttribute('viewBox') === lastApplied))) schedule();
  });
  observer.observe(target, { childList: true, subtree: true, attributes: true, attributeFilter: ['viewBox', 'id', 'disabled', 'href'] });
  messageObserver = new MutationObserver(schedule);
  for (const source of document.querySelectorAll('#xpDisplayDiv, #theComment, .mistake-training-replay'))
    messageObserver.observe(source, { childList: true, characterData: true, subtree: true,
      attributes: true, attributeFilter: ['style', 'hidden'] });
  // Preferences can arrive during the bounded engine retries. Listen before
  // the first update so the initial reveal cannot use a stale coordinate style.
  document.addEventListener('zen:preferences', schedule);
  update();
  // An engine can arrive after the DOM. Bounded retries; DOM/engine listeners
  // handle subsequent board replacement, orientation and review changes.
  for (let attempt = 0; (attempt < 100 || (document.readyState !== 'complete' && attempt < 600)) && active && !geometryReady && document.documentElement.dataset.zenMode === 'on'; attempt++) {
    await sleep(100);
    update();
  }
  addEventListener('pageshow', schedule); // BFCache needs no reload or history rewrite.
  phone.addEventListener('change', schedule);
  addEventListener('resize', schedule);
  window.visualViewport?.addEventListener('resize', schedule);
} else document.documentElement.removeAttribute('data-zen');
