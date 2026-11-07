import { loadProblem, ProblemSession } from './go-problem.mjs';

try {
  const response = await fetch('problems/sources.json');
  if (!response.ok) throw Error('Could not load local sample list');
  const sources = await response.json();
  const params = new URLSearchParams(location.search);
  const requested = Number(params.get('p') || 0);
  const number = Number.isInteger(requested) && requested >= 0 && requested < sources.length ? requested : 0;
  // A wide problem, for portrait rotation.
  const wide = params.has('wide');
  const source = wide ? { id: 'wide', title: 'Wide problem', instruction: 'Black to live.', credit: 'Authored for Zen Mode', sgf: 'wide.sgf' } : sources[number];
  if (params.has('minStep')) document.documentElement.dataset.zenMinStep = params.get('minStep');
  const record = await fetch(`problems/${source.sgf}`);
  if (!record.ok) throw Error('Could not load local SGF');
  // Rotate/mirror the entire parsed record, including all alternatives and
  // labels. Pick once per page, so Reset and Review keep the same coordinates.
  // A deterministic query is useful when reproducing a framing/transition bug.
  const fixed = params.get('orientation');
  const orientation = fixed !== null && /^[0-7]$/.test(fixed) ? Number(fixed)
    : Math.floor(Math.random() * 4) + (Math.random() < .5 ? 4 : 0);
  const text = await record.text();
  let turned = orientation, problem = loadProblem(text, turned), session = new ProblemSession(problem);
  let { size, root, solver } = problem;
  const letters = 'ABCDEFGHJKLMNOPQRSTUVWXYZ';
  let coordinates = 'western', review = false, reviewUnlocked = false, reviewNode = root, replyTimer;
  let wins = 0, failures = 0, attemptCounted = false;
  const listeners = new Set(), emit = () => listeners.forEach(listener => listener({ stoneChange: true }));
  const nextURL = wide ? 'real.html?p=0' : number === sources.length - 1 ? 'real.html?wide=1' : `real.html?p=${number + 1}`;
  document.querySelector('#playTitle').textContent = source.title;
  document.title = `${source.title} · local demo`;
  document.querySelector('#titleDescription').textContent = source.instruction;
  document.querySelector('#source-credit').textContent = `${source.title} · ${source.credit}. Demo view: ${(orientation % 4) * 90}°${orientation >= 4 ? ', mirrored' : ''}.`;
  document.querySelector('#sgf-link').href = `problems/${source.sgf}`;

  function reset() {
    clearTimeout(replyTimer); replyTimer = undefined; review = false; attemptCounted = false; session.reset(); draw(); emit();
  }
  function play(x, y) {
    if (review) {
      const child = reviewNode.children.find(n => n.move.x === x && n.move.y === y);
      if (child) selectReview(child);
      return;
    }
    if (session.phase === 'success') { location.href = nextURL; return; }
    session.play(x, y); draw(); emit();
    if (session.phase === 'reply' && !replyTimer) replyTimer = setTimeout(() => {
      replyTimer = undefined; session.reply(); draw(); emit();
    }, 420);
  }
  function node(name, attributes = {}, text) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', name);
    for (const [key, value] of Object.entries(attributes)) el.setAttribute(key, value);
    if (text !== undefined) el.textContent = text;
    return el;
  }
  function draw() {
    if (session.phase === 'success') reviewUnlocked = true;
    if (!attemptCounted && ['success', 'failure'].includes(session.phase)) {
      if (session.phase === 'success') wins++; else failures++;
      attemptCounted = true;
    }
    // Local demonstration of the site's navigation metadata, not account sync.
    const history = document.querySelector('#demo-history');
    history.className = `problem-nav__item problem-nav__item--${reviewUnlocked ? 'S' : 'V'}`;
    history.querySelector('.problem-nav__ratio').textContent = wins || failures ? `${wins}/${failures}` : '-';
    document.querySelector('#health-counter').textContent = `${Math.max(0, 9 - failures)} / 10`;
    const current = review ? reviewNode : session.current;
    const stones = review ? reviewNode.stones : session.stones;
    const lastMove = review ? reviewNode.move : session.lastMove;
    const margin = coordinates === 'none' ? 16 : 30, step = 32, position = n => margin + (n - 1) * step;
    const board = document.createElement('div'); board.className = 'besogo-board';
    const svg = node('svg', { viewBox: `0 0 ${2 * margin + (size.x - 1) * step} ${2 * margin + (size.y - 1) * step}` });
    svg.append(node('rect', { class: 'besogo-svg-lines', x: margin, y: margin, width: (size.x - 1) * step, height: (size.y - 1) * step }));
    for (let x = 2; x < size.x; x++) svg.append(node('line', { class: 'besogo-svg-lines', x1: position(x), x2: position(x), y1: margin, y2: position(size.y) }));
    for (let y = 2; y < size.y; y++) svg.append(node('line', { class: 'besogo-svg-lines', x1: margin, x2: position(size.x), y1: position(y), y2: position(y) }));
    if (coordinates !== 'none') {
      for (let x = 1; x <= size.x; x++) svg.append(node('text', { x: position(x), y: 14, 'text-anchor': 'middle', 'font-size': 10 }, letters[x - 1]));
      for (let y = 1; y <= size.y; y++) svg.append(node('text', { x: 12, y: position(y) + 3, 'text-anchor': 'middle', 'font-size': 10 }, size.y - y + 1));
    }
    for (let y = 1; y <= size.y; y++) for (let x = 1; x <= size.x; x++) {
      const stone = stones[(y - 1) * size.x + x - 1];
      if (stone) svg.append(node('circle', { class: 'zen-demo-stone', cx: position(x), cy: position(y), r: 14, fill: stone === -1 ? '#26312d' : '#fffdf5', stroke: stone === -1 ? '#18231e' : '#b4a68d', 'stroke-width': 1.4 }));
      const mark = current.getMarkup(x, y);
      if (mark) svg.append(node('text', { x: position(x), y: position(y) + 5, 'text-anchor': 'middle', 'font-size': 16 }, mark));
    }
    if (lastMove) svg.append(node('circle', { cx: position(lastMove.x), cy: position(lastMove.y), r: 4, fill: 'none', stroke: lastMove.color === -1 ? '#fff' : '#333', 'stroke-width': 1.5 }));
    if (review) {
      const alternatives = node('g', { id: 'nextMoveGroup', 'pointer-events': 'none' });
      for (const child of current.children) alternatives.append(node('circle', {
        cx: position(child.move.x), cy: position(child.move.y), r: 5, fill: child.winning ? 'green' : 'red'
      }));
      svg.append(alternatives);
    }
    for (let x = 1; x <= size.x; x++) for (let y = 1; y <= size.y; y++) {
      const hit = node('rect', { x: position(x) - step / 2, y: position(y) - step / 2, width: step, height: step, opacity: 0, 'data-point': `${x},${y}` });
      hit.addEventListener('click', () => play(x, y)); svg.append(hit);
    }
    board.append(svg);
    const panel = document.createElement('div'); panel.className = 'besogo-bottom-panels';
    const controls = document.createElement('div'); controls.className = 'besogo-tsumegoPlayTool'; panel.append(controls);
    const back = document.createElement('a'); back.id = 'besogo-back-button'; back.textContent = 'Back'; back.href = `real.html?p=${(number + sources.length - 1) % sources.length}`;
    const resetButton = document.createElement('button'); resetButton.id = 'besogo-reset-button'; resetButton.textContent = 'Reset'; resetButton.onclick = reset;
    const reviewButton = document.createElement('button'); reviewButton.id = 'besogo-review-button'; reviewButton.textContent = 'Review'; reviewButton.disabled = !reviewUnlocked || session.phase === 'reply';
    reviewButton.onclick = () => {
      if (!reviewUnlocked) return;
      if (!review) reviewNode = session.current;
      review = !review; draw(); emit();
    };
    const next = document.createElement('a'); next.id = 'besogo-next-button'; next.textContent = 'Next'; next.href = nextURL;
    controls.append(back, resetButton, reviewButton, next);
    const navigation = document.createElement('div'); navigation.className = 'besogo-panels';
    navigation.hidden = !review;
    const tree = document.createElement('div'); tree.className = 'besogo-tree sample-tree';
    // Original compact diagram: one column per move, with connected branch
    // lanes. The production extension keeps the site's own SVG tree instead.
    const points = new Map(); let lane = 0, deepest = 0;
    function layout(position, depth) {
      points.set(position, { x: 22 + depth * 44, y: 22 + lane * 44, depth }); deepest = Math.max(deepest, depth);
      position.children.forEach((child, i) => { if (i) lane++; layout(child, depth + 1); });
    }
    layout(root, 0);
    const diagram = node('svg', { width: (deepest + 1) * 44, height: (lane + 1) * 44, role: 'group', 'aria-label': 'Recorded move tree' });
    for (const [position, point] of points) if (position.parent) {
      const parent = points.get(position.parent), bend = parent.x + 22;
      diagram.append(node('path', { d: `M${parent.x},${parent.y}H${bend}V${point.y}H${point.x}`, fill: 'none', stroke: '#7b887e', 'stroke-width': 1.5 }));
    }
    for (const [position, point] of points) {
      const move = position.move, selected = position === current;
      const group = node('g', { role: 'button', tabindex: 0, 'aria-current': String(selected),
        'aria-label': move ? `Move ${point.depth}: ${move.color === -1 ? 'Black' : 'White'} ${letters[move.x - 1]}${size.y - move.y + 1}` : 'Starting position' });
      const marker = node('rect', { x: point.x - 19, y: point.y - 19, width: 38, height: 38, rx: 5, fill: selected ? '#f6d875' : 'transparent' });
      position.navTreeMarker = marker;
      group.append(marker, node('circle', { cx: point.x, cy: point.y, r: 14, fill: !move ? '#b9c4bb' : move.color === -1 ? '#26312d' : '#fffdf5',
        stroke: move && move.color !== solver ? '#29352f' : position.winning ? 'green' : 'red', 'stroke-width': 2, 'data-review-ring': '' }),
      node('text', { x: point.x, y: point.y + 4, 'text-anchor': 'middle', 'font-size': 12, fill: move?.color === -1 ? 'white' : '#18251e' }, move ? point.depth : '+'),
      node('rect', { x: point.x - 22, y: point.y - 22, width: 44, height: 44, fill: 'transparent' }));
      group.onclick = () => selectReview(position);
      group.onkeydown = event => { if (['Enter', ' '].includes(event.key)) { event.preventDefault(); selectReview(position); } };
      position.navTreeIcon = group;
      diagram.append(group);
    }
    tree.append(diagram);
    const moves = document.createElement('div'); moves.className = 'besogo-control';
    for (const [title, text, destination] of [
      ['Previous node', '←', () => reviewNode.parent], ['Next node', '→', () => reviewNode.children[0]]
    ]) {
      const button = document.createElement('button'); button.title = title; button.textContent = text;
      button.onclick = () => selectReview(destination()); moves.append(button);
    }
    navigation.append(tree, moves);
    document.querySelector('#target').replaceChildren(board, navigation, panel);
    const status = review ? 'Review · recorded moves' : session.phase === 'success' ? 'Correct!' : session.phase === 'failure' ? session.message : session.phase === 'reply'
      ? `${solver === -1 ? 'White' : 'Black'} is replying…` : session.message || `${solver === -1 ? 'Black' : 'White'} to play`;
    document.querySelector('#status').textContent = status;
  }
  function selectReview(position) {
    if (!review || !position) return;
    reviewNode = position; draw(); emit();
  }
  const api = { getRoot: () => root, getCurrent: () => review ? reviewNode : session.current, getReviewMode: () => review,
    getReviewEnabled: () => reviewUnlocked, setCurrent: selectReview,
    nextSibling: direction => {
      const siblings = reviewNode.parent?.children;
      if (siblings) selectReview(siblings[(siblings.indexOf(reviewNode) + direction + siblings.length) % siblings.length]);
    },
    // The site's rotation keeps an attempt; this local stand-in starts it again.
    rotateBoard: clockwise => {
      turned = (turned & 4) + ((turned & 3) + (clockwise ? 1 : 3)) % 4;
      problem = loadProblem(text, turned); session = new ProblemSession(problem); ({ size, root, solver } = problem);
      review = false; reviewNode = root; Object.assign(window.zenReal, { problem, session }); draw(); emit();
    },
    addListener: listener => listeners.add(listener), removeListener: listener => listeners.delete(listener),
    getCoordStyle: () => coordinates, setCoordStyle: value => { coordinates = value; draw(); emit(); } };
  window.besogo = { editor: api };
  window.zenReal = { source, problem, session, api, number, loadedAt: performance.timeOrigin };
  draw();
  document.querySelector('#move-form').onsubmit = event => {
    event.preventDefault();
    const value = new FormData(event.target).get('coordinate').trim().toUpperCase();
    play(letters.indexOf(value[0]) + 1, size.y - Number(value.slice(1)) + 1);
  };
  function addSourceControl() {
    const options = document.querySelector('.zen-options');
    if (!options || options.querySelector('.zen-demo-info')) return !!options;
    const info = document.createElement('div'); info.className = 'zen-demo-info';
    const label = document.createElement('small'); label.textContent = 'Local selection · no progress sync';
    const button = document.createElement('button'); button.textContent = 'Source & details'; button.type = 'button';
    button.onclick = () => {
      document.documentElement.dataset.zenMode = 'off'; options.open = false;
      const details = document.querySelector('#sample-details'); details.open = true;
      document.dispatchEvent(new Event('zen:preferences'));
      requestAnimationFrame(() => { details.querySelector('summary').focus(); details.scrollIntoView({ block: 'nearest' }); });
    };
    info.append(label, document.createElement('br'), button); options.append(info); return true;
  }
  if (!addSourceControl()) {
    const observer = new MutationObserver(() => { if (addSourceControl()) observer.disconnect(); });
    observer.observe(document.body, { childList: true, subtree: true });
  }
} catch (error) {
  document.querySelector('#errorMessage').textContent = `Local problem could not load: ${error.message}`;
}
