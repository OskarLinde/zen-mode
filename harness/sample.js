(() => {
  'use strict';
  // Original fixtures. This tiny scripted engine models only the observed DOM/
  // reader contract; it is deliberately not a copy of BesoGo or a Go rules engine.
  const fixture = Number(new URLSearchParams(location.search).get('p')) || 0;
  const training = new URLSearchParams(location.search).has('training');
  const framing = new URLSearchParams(location.search).has('framing');
  window.mode = training ? 5 : 1;
  const capture = (x, y) => ({ black: [[x - 1, y], [x, y - 1], [x + 1, y]], white: [[x, y]], answer: [x, y + 1] });
  const samples = [
    { title: '01 · A little room in the corner', size: [19, 19], ...capture(2, 2), note: 'Capture at B17. A small position on a full 19 × 19 grid.' },
    { title: '02 · Find the last liberty', size: [9, 9], ...capture(5, 5), note: 'Capture at E4. The complete 9 × 9 board remains visible.' },
    { title: '03 · A taller canvas', size: [9, 13], ...capture(4, 7), note: 'Capture at D6. Rectangular geometry fixture: the cells stay square.' },
    { title: '04 · Leave room for the whole line', size: [19, 19], ...capture(3, 3), far: [17, 16], label: [18, 18], note: 'Capture at C15. This geometry stress fixture has a distant variation and label. Framing must retain both, even before they appear as stones.' }
  ];
  const enclosure = [];
  if (framing) for (let x = 14; x <= 19; x++) for (let y = 11; y <= 18; y++)
    if (x === 14 || x === 19 || y === 11 || y === 18) enclosure.push([x, y]);
  const sample = framing ? { title: 'Enclosed framing', size: [19, 19],
    black: [...enclosure, [16,15], [17,14], [18,15]], white: [[17,15]], answer: [17,16],
    note: 'Authored 8-row, 6-column enclosure. Keep the horizontal crop tight and extend the real board upward. Capture at R4.' } : samples[fixture] || samples[0];
  const [nx, ny] = sample.size;
  let solved = false, failed = false, review = false, reviewUnlocked = false, resultTimer, root, current, svg, board, coordStyle = 'western';
  const listeners = new Set();
  const startupFrames = [];
  const loadedAt = performance.timeOrigin;
  const visits = Number(sessionStorage.getItem('zen-demo-visits') || 0) + 1;
  sessionStorage.setItem('zen-demo-visits', visits);
  document.querySelector('#playTitle').textContent = `Sample captures ${fixture + 1}/7`;
  if (framing) document.querySelector('#playTitle').textContent = 'Enclosed framing · sample';
  if (training) {
    document.querySelector('#playTitle').textContent = `Mistake Training ${fixture + 1}/2`;
    document.querySelector('#sample-note').textContent = 'Authored training fixture: retry after failure and a delayed result that enables Next. No server or account is involved.';
  }
  if (!training) document.querySelector('#sample-note').textContent = sample.note;
  document.querySelector('#status2').textContent = `Sample visit ${visits}`;
  const pointKey = (x, y) => `${x},${y}`;
  const stoneMap = new Map([...sample.black.map(([x, y]) => [pointKey(x, y), -1]), ...sample.white.map(([x, y]) => [pointKey(x, y), 1])]);
  function node(move = null, points = stoneMap) {
    return { children: [], move, getSize: () => ({ x: nx, y: ny }),
      getStone: (x, y) => points.get(pointKey(x, y)) || 0,
      getMarkup: (x, y) => sample.label?.[0] === x && sample.label?.[1] === y ? 'A' : 0 };
  }
  root = node(); current = root;
  const correct = node({ x: sample.answer[0], y: sample.answer[1] });
  correct.parent = root;
  root.children.push(correct);
  if (sample.far) correct.children.push(node({ x: sample.far[0], y: sample.far[1] }));
  const api = { getRoot: () => root, getCurrent: () => current, getReviewMode: () => review, getReviewEnabled: () => reviewUnlocked,
    addListener: fn => listeners.add(fn), removeListener: fn => listeners.delete(fn),
    getCoordStyle: () => coordStyle, setCoordStyle: value => { coordStyle = value; margin = value === 'none' ? 16 : 30; mount(); emit(); } };
  const emit = () => listeners.forEach(fn => fn({ stoneChange: true }));
  const ns = 'http://www.w3.org/2000/svg';
  function element(name, attrs = {}, text) {
    const el = document.createElementNS(ns, name);
    for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
    if (text) el.textContent = text;
    return el;
  }
  const step = 32; let margin = 30; const pos = n => margin + (n - 1) * step;
  const nextURL = `puzzle.html?p=${(fixture + 1) % (training ? 2 : 4)}${training ? '&training=1' : ''}`;
  const goNext = () => {
    if (!training || document.querySelector('#besogo-next-button')) location.href = nextURL;
  };
  function play(x, y) {
    if (solved && !review) { goNext(); return; }
    if (review) return;
    if (failed) return;
    if (x !== sample.answer[0] || y !== sample.answer[1]) {
      if (training) {
        failed = true;
        document.querySelector('#status').innerHTML = '<h2>Incorrect!</h2><p class="mistake-training-note">Press Reset to try again.</p>';
      } else document.querySelector('#status').textContent = 'Try another liberty.';
      return;
    }
    solved = true; reviewUnlocked = true;
    document.querySelector('#besogo-review-button').disabled = false;
    document.querySelector('#status').textContent = 'Correct!';
    document.querySelector('#theComment').textContent = training ? '' : 'Take your time. Click the board again or Next.';
    current = correct;
    renderStones(true);
    emit();
    if (training) resultTimer = setTimeout(() => {
      document.querySelector('#status').innerHTML = '<h2>Correct!</h2><p class="mistake-training-outcome">Next review in 2 days.</p><p class="mistake-training-outcome">All clear today.</p>';
      const next = document.querySelector('#besogo-next-button-inactive');
      if (next) { next.id = 'besogo-next-button'; next.href = nextURL; }
    }, 180);
  }
  let stoneLayer;
  function renderStones(done = false) {
    stoneLayer.replaceChildren();
    for (const [color, points] of [[-1, sample.black], [1, done ? [] : sample.white], [-1, done ? [sample.answer] : []]])
      for (const [x, y] of points) stoneLayer.append(element('circle', { class: 'zen-demo-stone', cx: pos(x), cy: pos(y), r: 14, fill: color === -1 ? '#26312d' : '#fffdf5', stroke: color === -1 ? '#18231e' : '#b4a68d', 'stroke-width': 1.4 }));
  }
  function mount() {
    // The real site clears its board container during initialization.
    document.querySelector('#target').replaceChildren();
    board = document.createElement('div'); board.className = 'besogo-board';
    svg = element('svg', { viewBox: `0 0 ${2 * margin + (nx - 1) * step} ${2 * margin + (ny - 1) * step}` });
    svg.append(element('rect', { class: 'besogo-svg-lines', x: margin, y: margin, width: (nx - 1) * step, height: (ny - 1) * step }));
    for (let x = 2; x < nx; x++) svg.append(element('line', { x1: pos(x), x2: pos(x), y1: margin, y2: pos(ny), class: 'besogo-svg-lines' }));
    for (let y = 2; y < ny; y++) svg.append(element('line', { x1: margin, x2: pos(nx), y1: pos(y), y2: pos(y), class: 'besogo-svg-lines' }));
    if (coordStyle !== 'none') for (let x = 1; x <= nx; x++) svg.append(element('text', { x: pos(x), y: 14, 'text-anchor': 'middle', 'font-size': 10, fill: '#6d5634' }, 'ABCDEFGHJKLMNOPQRSTUVWXYZ'[x - 1]));
    if (coordStyle !== 'none') for (let y = 1; y <= ny; y++) svg.append(element('text', { x: 12, y: pos(y) + 3, 'text-anchor': 'middle', 'font-size': 10, fill: '#6d5634' }, String(ny - y + 1)));
    stoneLayer = element('g'); svg.append(stoneLayer); renderStones(current !== root);
    if (sample.label) svg.append(element('text', { x: pos(sample.label[0]), y: pos(sample.label[1]) + 5, 'text-anchor': 'middle', 'font-size': 16 }, 'A'));
    for (let x = 1; x <= nx; x++) for (let y = 1; y <= ny; y++) {
      const hit = element('rect', { x: pos(x) - step / 2, y: pos(y) - step / 2, width: step, height: step, opacity: 0, 'data-point': `${x},${y}` });
      hit.addEventListener('click', () => play(x, y));
      svg.append(hit);
    }
    board.append(svg);
    const panel = document.createElement('div'); panel.className = 'besogo-bottom-panels';
    const controls = document.createElement('div'); controls.className = 'besogo-tsumegoPlayTool';
    panel.append(controls);
    const back = document.createElement('a'); back.id = 'besogo-back-button'; back.textContent = 'Back'; back.href = `puzzle.html?p=${(fixture + 3) % 4}`;
    const reset = document.createElement('button'); reset.id = 'besogo-reset-button'; reset.textContent = 'Reset';
    reset.onclick = () => {
      clearTimeout(resultTimer); solved = false; failed = false; review = false; current = root; renderStones();
      navigation.hidden = true;
      document.querySelector('#status').textContent = 'Ready to play'; document.querySelector('#theComment').textContent = '';
      if (training) { next.id = 'besogo-next-button-inactive'; next.removeAttribute('href'); }
      emit();
    };
    const reviewButton = document.createElement('button'); reviewButton.id = 'besogo-review-button'; reviewButton.textContent = 'Review'; reviewButton.disabled = !reviewUnlocked;
    reviewButton.onclick = () => { if (!reviewUnlocked) return; review = !review; navigation.hidden = !review; document.querySelector('#status').textContent = review ? 'Review' : solved ? 'Correct!' : 'Ready to play'; emit(); };
    const next = document.createElement('a'); next.id = training && !solved ? 'besogo-next-button-inactive' : 'besogo-next-button'; next.textContent = 'Next';
    if (!training || solved) next.href = nextURL;
    controls.append(back, reset, reviewButton, next);
    if (fixture === 4) {
      // Model the live site's editor controls appearing before its late
      // stylesheet hides them. They must not move the play controls.
      const transient = document.createElement('div');
      transient.className = 'besogo-panels';
      transient.style.height = '42px';
      transient.textContent = 'Temporary editor controls';
      document.querySelector('#target').append(board, transient, panel);
      setTimeout(() => { transient.style.display = 'none'; }, 80);
      const mountedBoard = board;
      const mountedSVG = svg;
      // A staged engine render: a stone has an intermediate position for one
      // paint, and explicitly visible SVG children can override hidden parents.
      const stone = stoneLayer.firstElementChild;
      const finalX = stone.getAttribute('cx');
      stone.setAttribute('visibility', 'visible');
      stone.setAttribute('cx', Number(finalX) + 16);
      requestAnimationFrame(() => requestAnimationFrame(() => stone.setAttribute('cx', finalX)));
      startupFrames.length = 0;
      const samplePaint = () => {
        if (board !== mountedBoard) return; // Coordinate changes can remount before paint.
        const stoneRect = stone.getBoundingClientRect();
        startupFrames.push({ boardY: board.getBoundingClientRect().y,
          nextY: next.getBoundingClientRect().y, box: mountedSVG.getAttribute('viewBox'),
          visible: getComputedStyle(mountedSVG).visibility,
          opacity: getComputedStyle(mountedSVG).opacity,
          stoneVisible: getComputedStyle(stone).visibility,
          stoneRect: [stoneRect.x, stoneRect.y, stoneRect.width, stoneRect.height] });
        if (startupFrames.length < 12) requestAnimationFrame(samplePaint);
      };
      requestAnimationFrame(samplePaint);
    } else document.querySelector('#target').append(board, panel);
    const navigation = document.createElement('div'); navigation.className = 'besogo-panels';
    navigation.hidden = !review;
    const moves = document.createElement('div'); moves.className = 'besogo-control';
    const previous = document.createElement('button'); previous.title = 'Previous node'; previous.textContent = '←';
    previous.onclick = () => {
      if (!current.parent) return;
      current = current.parent;
      renderStones(current !== root);
      emit();
    };
    const forward = document.createElement('button'); forward.title = 'Next node'; forward.textContent = '→';
    forward.onclick = () => {
      if (!current.children.length) return;
      current = current.children[0]; renderStones(current !== root); emit();
    };
    const tree = document.createElement('div'); tree.className = 'besogo-tree';
    for (const [label, position] of [['Start', root], ['Capture', correct]]) {
      const select = document.createElement('button'); select.textContent = label;
      select.onclick = () => { current = position; renderStones(current !== root); emit(); };
      tree.append(select);
    }
    moves.append(previous, forward); navigation.append(tree, moves); document.querySelector('#target').append(navigation);
    if (fixture !== 5) window.besogo = { editor: api };
    else document.querySelector('#status').textContent = 'Unknown engine · site view';
  }
  if (fixture === 6) {
    document.querySelector('#errorMessage').textContent = 'Sample load failed. This message remains visible. Use Original layout or return to the first sample.';
  } else if (fixture === 4) setTimeout(mount, 2000);
  else mount();
  document.querySelector('#move-form').addEventListener('submit', event => {
    event.preventDefault();
    const coordinate = new FormData(event.target).get('coordinate').toUpperCase().trim();
    const x = 'ABCDEFGHJKLMNOPQRSTUVWXYZ'.indexOf(coordinate[0]) + 1;
    const y = ny - Number(coordinate.slice(1)) + 1;
    if (board) play(x, y);
  });
  // Observable fixture state for local regression checks, never used by extension.
  window.zenSample = { fixture, framing, loadedAt, visits, sample, api, startupFrames, get solved() { return solved; }, get review() { return review; } };
  if (fixture === 4) requestAnimationFrame(() => {
    window.zenSample.placeholderFooterY = document.querySelector('.sample-details').getBoundingClientRect().y;
  });
  document.querySelector('#browser-back').onclick = () => history.back();
  document.querySelector('#browser-forward').onclick = () => history.forward();
})();
