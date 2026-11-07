// Browser checks for the three authored local problems; does not contact tsumego.com.
export async function checkRealSamples(frame, assert) {
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const doc = () => frame.contentDocument, state = () => frame.contentWindow.zenReal;
  const wait = async condition => {
    for (let i = 0; i < 150; i++) { if (condition()) return; await pause(40); }
    throw Error('Timed out waiting for local SGF sample');
  };
  const ready = number => state()?.number === number && [...doc().querySelectorAll('.zen-toolbar button')].some(b => b.textContent === 'Auto-fit' && !b.disabled);
  const hit = move => doc().querySelector(`[data-point="${move.x},${move.y}"]`).dispatchEvent(new MouseEvent('click', { bubbles: true }));
  for (let number = 0; number < 3; number++) {
    const before = state()?.loadedAt;
    frame.src = `harness/real.html?p=${number}`;
    await wait(() => ready(number) && state().loadedAt !== before);
    await pause(80);
    const start = state(), label = start.source.id;
    const board = doc().querySelector('.besogo-board').getBoundingClientRect();
    const nextY = doc().querySelector('.zen-next').getBoundingClientRect().y;
    assert(doc().querySelector('.zen-set').textContent + ' ' + doc().querySelector('.zen-number').textContent === start.source.title, `${label}: real collection and problem number`);
    assert(doc().querySelector('.zen-history').textContent === 'Untried' && doc().querySelector('.zen-solved').hidden && !doc().querySelector('.zen-context .zen-history'),
      `${label}: untried has no primary history row or solved check`);
    assert(doc().querySelector('.zen-hearts').textContent === '9⁄10', `${label}: illustrative local allowance starts at 9/10`);
    assert(doc().querySelector('#source-credit').textContent.includes(start.source.credit) && doc().querySelector('#sgf-link').getAttribute('href') === `problems/${start.source.sgf}`, `${label}: credit and SGF link shown`);
    const wrong = [...doc().querySelectorAll('[data-point]')].find(cell => {
      const [x, y] = cell.dataset.point.split(',').map(Number), r = cell.getBoundingClientRect();
      return !start.session.current.getStone(x, y) && !start.session.current.children.some(n => n.move.x === x && n.move.y === y) &&
        r.x + r.width / 2 > board.left && r.x + r.width / 2 < board.right && r.y + r.height / 2 > board.top && r.y + r.height / 2 < board.bottom;
    });
    if (!wrong) throw Error('No visible off-tree test point');
    wrong.dispatchEvent(new MouseEvent('click', { bubbles: true })); await pause(60);
    assert(state().session.phase === 'failure' && doc().querySelector('.zen-live-status').textContent.includes('retry'), `${label}: wrong move produces visible failure`);
    assert(doc().querySelector('.zen-history').textContent === 'Failed' && doc().querySelector('.zen-solved').hidden, `${label}: recorded failure updates the history label`);
    assert(doc().querySelector('.zen-hearts').textContent === '8⁄10', `${label}: revealed demo failure reduces the illustrative heart count once`);
    doc().querySelector('.zen-review').click(); await pause(80);
    assert(!state().api.getReviewMode() && !state().api.getReviewEnabled() && doc().querySelector('.zen-review').hidden,
      `${label}: failure on an unsolved problem does not unlock Review`);
    doc().querySelector('.zen-reset').click(); await pause(60);
    assert(state().session.phase === 'play' && state().session.current === state().problem.root, `${label}: Reset restores initial state`);
    assert(doc().querySelector('.zen-history').textContent === 'Failed' && doc().querySelector('.zen-solved').hidden, `${label}: Reset preserves prior failure history`);
    assert(doc().querySelector('.zen-hearts').textContent === '8⁄10', `${label}: Reset does not restore demo hearts`);
    if (!number) {
      hit(state().session.current.children.find(n => n.winning).move);
      doc().querySelector('.zen-reset').click(); await pause(520);
      assert(state().session.current === state().problem.root && state().session.phase === 'play', 'Reset cancels an outstanding opponent reply');
    }
    let turns = 0;
    while (state().session.phase === 'play' && turns < 8) {
      const move = state().session.current.children.find(n => n.winning)?.move;
      if (!move) throw Error('Missing winning continuation');
      hit(move); turns++;
      if (state().session.phase === 'reply') await wait(() => state().session.phase !== 'reply');
    }
    await pause(60);
    assert(state().session.phase === 'success' && turns >= 2 && state().session.current.terminal, `${label}: multi-step sequence reaches marked success`);
    assert(doc().querySelector('.zen-history').textContent === 'Solved' && !doc().querySelector('.zen-solved').hidden, `${label}: solving updates history without changing progression`);
    assert(state().loadedAt === start.loadedAt && doc().querySelector('.zen-live-status').textContent === 'Correct!', `${label}: success waits for manual advancement`);
    assert(Math.abs(doc().querySelector('.zen-next').getBoundingClientRect().y - nextY) < 1 && doc().documentElement.scrollWidth <= frame.clientWidth + 1, `${label}: stable mobile controls and no horizontal overflow`);
    const solvedNode = state().session.current;
    assert(doc().querySelector('.zen-review-controls').hidden && !doc().querySelector('.zen-review').disabled &&
      doc().querySelector('.zen-toolbar').getBoundingClientRect().height === 72,
      `${label}: solved problem offers Review without expanding the bar`);
    doc().querySelector('.zen-review').click(); await pause(80);
    if (!number) {
      const api = state().api, root = api.getRoot(), pane = doc().querySelector('.zen-review-tree');
      const target = async position => {
        const tree = doc().querySelector('.besogo-tree');
        position.navTreeMarker.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        await pause(60);
        const r = position.navTreeMarker.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2;
        return { element: doc().elementFromPoint(x, y), x, y, tree };
      };
      const pointer = (point, type, extra = {}) => point.element.dispatchEvent(new frame.contentWindow.PointerEvent(type,
        { bubbles: true, pointerType: 'touch', isPrimary: true, pointerId: 7, button: 0, clientX: point.x, clientY: point.y, ...extra }));
      const compatibilityClick = point => (doc().elementFromPoint(point.x, point.y) || pane).dispatchEvent(new MouseEvent('click',
        { bubbles: true, cancelable: true, detail: 1, clientX: point.x, clientY: point.y }));
      let point = await target(root), calls = 0, clicks = 0;
      const setCurrent = api.setCurrent, countClick = () => clicks++;
      api.setCurrent = node => { calls++; setCurrent(node); };
      pane.addEventListener('click', countClick);
      pointer(point, 'pointerdown'); pointer(point, 'pointerup'); await pause(60);
      assert(api.getCurrent() === root && root.navTreeMarker.classList.contains('zen-current-tree-node'),
        'Touch-only tree tap selects and highlights the starting position without a synthetic click');
      compatibilityClick(point); await pause(60);
      assert(calls === 1 && clicks === 0 && api.getCurrent() === root, 'A following compatibility click does not select the tree twice');
      point = await target(root.children[0]);
      pointer(point, 'pointerdown', { pointerType: 'pen' }); pointer(point, 'pointerup', { pointerType: 'pen' }); await pause(60);
      assert(api.getCurrent() === root.children[0], 'Pen tap selects a recorded tree move');
      point = await target(root);
      pointer(point, 'pointerdown'); pointer(point, 'pointermove', { clientX: point.x + 20 });
      pointer(point, 'pointermove'); pointer(point, 'pointerup'); compatibilityClick(point); await pause(60);
      assert(api.getCurrent() === root.children[0], 'Dragging away and back over a node does not select it');
      pointer(point, 'pointerdown'); point.tree.dispatchEvent(new Event('scroll')); pointer(point, 'pointerup'); compatibilityClick(point); await pause(60);
      assert(api.getCurrent() === root.children[0], 'Scrolling the tree does not select the node under the finger');
      pointer(point, 'pointerdown'); pointer(point, 'pointercancel'); pointer(point, 'pointerup'); await pause(60);
      assert(api.getCurrent() === root.children[0], 'A canceled touch leaves the review position unchanged');
      pointer(point, 'pointerdown', { isPrimary: false }); pointer(point, 'pointerup', { isPrimary: false }); await pause(60);
      assert(api.getCurrent() === root.children[0], 'A secondary touch does not select a tree node');
      pointer(point, 'pointerdown'); pointer(point, 'pointerup'); await pause(60);
      root.children[1].navTreeIcon.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 })); await pause(60);
      assert(api.getCurrent() === root.children[1], 'Keyboard-style activation still selects an alternate branch after a touch');
      assert(state().session.current === solvedNode && state().session.phase === 'success', 'Tree taps preserve the solved attempt');
      pane.removeEventListener('click', countClick); api.setCurrent = setCurrent;
      point = await target(solvedNode);
      pointer(point, 'pointerdown'); pointer(point, 'pointerup'); await pause(60);
      assert(api.getCurrent() === solvedNode, 'A deep terminal remains selectable after tree redraw and scroll');
    }
    doc().querySelector('.zen-rewind').click(); await pause(80);
    assert(state().api.getCurrent() === solvedNode.parent && state().session.current === solvedNode && state().session.phase === 'success',
      `${label}: review steps back without losing success`);
    doc().querySelector('.zen-forward').click(); await pause(80);
    assert(state().api.getCurrent() === solvedNode && doc().querySelector('.zen-forward').disabled,
      `${label}: forward restores the recorded terminal and stops`);
    while (state().api.getCurrent().parent) {
      doc().querySelector('.zen-rewind').click(); await pause(60);
    }
    assert(doc().querySelectorAll('.sample-tree path').length > 0 && !doc().querySelector('.sample-tree button') &&
      state().api.getCurrent().navTreeMarker.classList.contains('zen-current-tree-node'),
      `${label}: connected diagram highlights the current node without padded buttons`);
    assert([...doc().querySelectorAll('#nextMoveGroup circle')].every((dot, i) =>
      dot.getAttribute('fill') === (state().api.getCurrent().children[i].winning ? 'green' : 'red')) &&
      doc().querySelectorAll('#nextMoveGroup circle').length === state().api.getCurrent().children.length,
      `${label}: every recorded continuation has a board marker with its actual outcome color`);
    doc().querySelector('.zen-forward').click(); await pause(80);
    const firstBranch = state().api.getCurrent();
    assert(firstBranch.parent === start.problem.root && state().session.phase === 'success',
      `${label}: review follows recorded moves without changing the solved result`);
    const reply = firstBranch.children[0].move.color === -1 ? 'rgb(0, 0, 0)' : 'rgb(255, 255, 255)';
    assert([...doc().querySelectorAll('#nextMoveGroup circle')].every(dot =>
      frame.contentWindow.getComputedStyle(dot).fill === reply) &&
      [...doc().querySelectorAll('.sample-tree .zen-opponent-node > circle')].every(dot => frame.contentWindow.getComputedStyle(dot).stroke === reply),
      `${label}: opponent board markers and tree rings match their displayed stone color`);
    if (firstBranch.parent.children.length > 1) {
      doc().querySelector('.zen-branch-down').click(); await pause(80);
      assert(state().api.getCurrent() !== firstBranch && state().api.getCurrent().parent === firstBranch.parent,
        `${label}: Down chooses a sibling variation`);
      doc().querySelector('.zen-branch-up').click(); await pause(80);
      assert(state().api.getCurrent() === firstBranch, `${label}: Up returns to the previous variation`);
    }
    doc().querySelector('.zen-review').click(); await pause(80);
    assert(!state().api.getReviewMode() && state().session.phase === 'success', `${label}: Exit review restores the solved attempt`);
    assert(doc().querySelector('.zen-history').textContent === 'Solved' && !doc().querySelector('.zen-solved').hidden, `${label}: tree browsing preserves solved history`);
    if (number === 2) {
      assert(start.problem.root.stones.some((value, i) => value === 1 && state().session.stones[i] !== 1), 'Capture sample removes actual white stones');
      doc().querySelector('.zen-reset').click(); await pause(60);
      assert(state().session.stones.every((value, i) => value === start.problem.root.stones[i]), 'Reset restores captured stones in the rendered session');
      assert(!doc().querySelector('.zen-review').hidden && state().api.getReviewEnabled(), 'Already-solved demo retains Review after Reset');
    }
    doc().querySelector('.zen-next').click();
    await wait(() => ready((number + 1) % 3) && state().loadedAt !== start.loadedAt);
    assert(true, `${label}: Next performs ordinary local navigation`);
  }
}
