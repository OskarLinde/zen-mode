// Test-only. Raises the threshold on chosen pages through the documented override,
// so real problems turn. Records the native state before any turn. No account use.
function observeTurn(paths) {
  if (paths.includes(location.pathname)) {
    const raise = () => { if (document.documentElement) { document.documentElement.dataset.zenMinStep = '70'; watch.disconnect(); } };
    const watch = new MutationObserver(raise);
    watch.observe(document, { childList: true });
    raise();
  }
  let engine;
  Object.defineProperty(window, 'besogo', { configurable: true, get: () => engine, set(value) {
    engine = value;
    let create = value?.create;
    if (value) Object.defineProperty(value, 'create', { configurable: true,
      get: () => create && ((...args) => {
        const result = create.apply(value, args), board = document.querySelector('.besogo-board');
        window.__zenNativeTurn = JSON.stringify([value.editor.getTransformationFromSgf(), value.scaleParameters.rotation, board?.style.width]);
        window.__zenNativeBox = document.querySelector('.besogo-board > svg')?.getAttribute('viewBox');
        window.__zenNativeStones = window.__zenStonesInSgf?.();
        return result;
      }), set(next) { create = next; } });
  } });
  const trace = window.__zenTurnTrace = { views: [] };
  window.__zenTurnState = () => {
    const board = document.querySelector('.besogo-board');
    const facing = JSON.stringify([besogo.editor.getTransformationFromSgf(), besogo.scaleParameters.rotation]);
    return { facing, step: parseFloat(getComputedStyle(board).getPropertyValue('--zen-grid-step')),
      native: facing.slice(0, -1) + ',' + JSON.stringify(board.style.width) + ']' };
  };
  window.__zenPointFor = (x, y) => {
    const svg = document.querySelector('.besogo-board > svg'), line = svg.querySelector('rect.besogo-svg-lines'), m = svg.getScreenCTM();
    const size = besogo.editor.getRoot().getSize(), step = +line.getAttribute('width') / (size.x - 1);
    return { x: m.e + (+line.getAttribute('x') + (x - 1) * step) * m.a, y: m.f + (+line.getAttribute('y') + (y - 1) * step) * m.d };
  };
  // The setup stones as points of the stored SGF. Whatever turns the board, these must not change.
  window.__zenStonesInSgf = () => {
    const editor = besogo.editor, root = editor.getRoot(), size = root.getSize(), points = [];
    for (let x = 1; x <= size.x; x++) for (let y = 1; y <= size.y; y++) if (root.getStone(x, y)) points.push(editor.viewLabelToSgf(editor.coordXYToLabel(x, y)));
    const walk = node => { if (node.move) points.push(editor.makeCommentPosition(node)); node.children.forEach(walk); };
    walk(root);
    return points.sort().join(' ');
  };
  // What the site and Zen mode show as the problem comment, against the authored text.
  window.__zenCommentText = () => {
    const node = besogo.editor.getCurrent(), raw = node.comment || '', shown = document.querySelector('#theComment')?.textContent ?? '';
    return { raw, shown, expected: besogo.boardInverted ? besogo.swapColorWords(raw) : raw, panel: document.querySelector('.zen-review-comment:not([hidden])')?.textContent ?? null };
  };
  // Where the problem landed and whether anything playable sits under a control.
  window.__zenPlacement = () => {
    const board = document.querySelector('.besogo-board'), root = besogo.editor.getRoot(), size = root.getSize();
    const stones = [], moves = new Set(), walk = node => { if (node.move?.x > 0) moves.add(`${node.move.x},${node.move.y}`); node.children.forEach(walk); };
    walk(root);
    for (let x = 1; x <= size.x; x++) for (let y = 1; y <= size.y; y++) if (root.getStone(x, y)) stones.push({ x, y });
    // The tight crop: every stone on the physical screen, under the bar or the band
    // too; only the moves playable next must be in the touch region.
    const tight = board.dataset.zenFrame === 'tight';
    const next = (besogo.editor.getCurrent?.() || root).children.map(child => child.move).filter(m => m?.x > 0).map(({ x, y }) => ({ x, y }));
    const top0 = document.querySelector('.zen-toolbar').getBoundingClientRect().top;
    const wanted = (tight ? next : [...moves].map(key => { const [x, y] = key.split(',').map(Number); return { x, y }; })).concat(stones);
    const blocked = [], outside = [], outsideStones = [];
    for (const { x, y } of wanted) {
      const p = window.__zenPointFor(x, y);
      // Under the touch fallback only the stones that play touches must stay in view.
      const touched = [...moves].some(key => { const [mx, my] = key.split(',').map(Number); return Math.abs(mx - x) + Math.abs(my - y) === 1; });
      const needed = root.getStone(x, y) && (board.dataset.zenFrame !== 'play' || touched);
      const stone = !!root.getStone(x, y), bottom = tight && stone ? innerHeight : top0;
      if (p.x < 0 || p.x > innerWidth || p.y < 0 || p.y > bottom) { outside.push(`${x},${y}`); if (needed) outsideStones.push(`${x},${y}`); continue; }
      if (tight && stone) continue;
      if (!document.elementFromPoint(p.x, p.y)?.closest('.besogo-board')) blocked.push(`${x},${y}`);
    }
    const flag = name => board.style.getPropertyValue(`--zen-true-${name}`), rect = el => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; };
    const hearts = document.querySelector('.zen-hearts'), wasHidden = hearts?.hidden;
    if (hearts) hearts.hidden = false;
    const heartBox = hearts && rect(hearts);
    if (hearts) hearts.hidden = wasHidden;
    const mean = stones.reduce((sum, stone) => sum + stone.x, 0) / stones.length;
    // The tap tile of every stone and possible move against the lower edge of ☰ and
    // the hearts row. The hearts take no taps, so elementFromPoint cannot see them.
    const step = parseFloat(getComputedStyle(board).getPropertyValue('--zen-grid-step'));
    const menu = rect(document.querySelector('.zen-nav-trigger')), controls = Math.max(menu.bottom, heartBox?.bottom ?? 0);
    // Auto-fit frames the problem as set up and follows a chase as it is played, so a move
    // outside the view is allowed; what is on screen must be clear of the controls.
    // Only the play area must stay clear of the controls: the moves inside Auto-fit's crop and
    // its stones (under the touch fallback, the stones play touches). The fill may show more.
    const crop = (board.dataset.zenCrop || '').split(',').map(Number), inCrop = ({ x, y }) => crop.length !== 4 || (x >= crop[0] && x <= crop[2] && y >= crop[1] && y <= crop[3]);
    const moveList = [...moves].map(key => { const [x, y] = key.split(',').map(Number); return { x, y }; });
    const touches = ({ x, y }) => moveList.some(m => Math.abs(m.x - x) + Math.abs(m.y - y) === 1);
    const play = tight ? next : moveList.filter(inCrop).concat(stones.filter(st => inCrop(st) && (board.dataset.zenFrame !== 'play' || touches(st))));
    const shown = play.filter(({ x, y }) => { const p = window.__zenPointFor(x, y); return p.x >= 0 && p.x <= innerWidth && p.y >= 0; });
    const under = shown.filter(({ x, y }) => window.__zenPointFor(x, y).y - step / 2 < controls - .5).map(({ x, y }) => `${x},${y}`);
    const first = Math.min(...shown.map(({ y }) => y)) - 1, problemTop = window.__zenPointFor(1, first <= 2 ? 1 : first).y - step / 2;
    const boardBox = board.getBoundingClientRect();
    return { corner: besogo.boardParameters.corner, rotation: besogo.scaleParameters.rotation, side: mean < (size.x + 1) / 2 ? 'left' : 'right',
      edges: ['top', 'right', 'bottom', 'left'].map(flag).join(''), menu, hearts: heartBox, controls, under, problemTop,
      boardTop: boardBox.top, toolbarTop: top0, blocked, outside, outsideStones, frame: board.dataset.zenFrame, crop: board.dataset.zenCrop, firstRow: first + 1, shownCount: shown.length, width: innerWidth, height: innerHeight, step };
  };
  // Empty points at the root that the tree plays, topmost on screen first, for real clicks.
  window.__zenTopMoves = (count = 3) => {
    const root = besogo.editor.getRoot(), seen = new Map(), walk = node => { if (node.move?.x > 0 && !root.getStone(node.move.x, node.move.y)) seen.set(`${node.move.x},${node.move.y}`, node.move); node.children.forEach(walk); };
    walk(root);
    return [...seen.values()].map(({ x, y }) => ({ col: x, row: y, at: window.__zenPointFor(x, y) })).sort((a, b) => a.at.y - b.at.y || a.at.x - b.at.x).slice(0, count);
  };
  let marked = false;
  function tick() {
    const root = document.documentElement;
    const phase = root?.dataset.zenHandoff;
    if (phase === 'moving' && !marked) { marked = true; performance.mark('zen-moving'); }
    if (window.besogo?.editor && root?.dataset.zenReady === 'on' && !root.dataset.zenPreparing && !root.dataset.zenHandoff) {
      const view = `${besogo.scaleParameters?.rotation}`;
      if (trace.views.at(-1) !== view) trace.views.push(view);
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}
