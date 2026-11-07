// Test-only. Review enabled through a hook on the real engine; no account use.
function observeTree() {
  let engine;
  Object.defineProperty(window, 'besogo', { configurable: true, get: () => engine, set(value) {
    engine = value;
    let create = value?.create;
    if (value) Object.defineProperty(value, 'create', { configurable: true,
      get: () => create && ((target, options) => {
        options.reviewEnabled = true;
        // A synthetic tree past the Zen mode budget, on the real engine.
        if (sessionStorage.getItem('zen-test-huge')) { delete options.sgfID; const at = n => `${'abcdefghijklmnopqrs'[n % 19]}${'abcdefghijklmnopqrs'[Math.floor(n / 19) % 19]}`; options.sgf2 = `(;GM[1]FF[4]SZ[19]${Array.from({ length: 340 }, (_, i) => `(;B[${at(i)}];W[${at(i + 1)}];B[${at(i + 2)}];W[${at(i + 3)}];B[${at(i + 4)}]C[+])`).join('')})`; }
        return create.call(value, target, options);
      }),
      set(next) { create = next; } });
  } });
  const rect = el => { const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, height: r.height }; };
  window.__zenTreeRect = rect;
  window.__zenNodeCount = () => { let count = 0; const walk = node => { count++; node.children.forEach(walk); }; walk(besogo.editor.getRoot()); return count; };
  window.__zenTree = () => {
    const tree = document.querySelector('.besogo-tree'), pane = document.querySelector('.zen-review-tree'), current = besogo.editor.getCurrent();
    const box = rect(tree), cell = current.navTreeMarker && rect(current.navTreeMarker);
    const top = box.top + tree.clientTop, left = box.left + tree.clientLeft;
    return { st: tree.scrollTop, sl: tree.scrollLeft, sh: tree.scrollHeight, ch: tree.clientHeight, sw: tree.scrollWidth, cw: tree.clientWidth, box, pane: pane && rect(pane),
      inPane: pane?.contains(tree), page: document.scrollingElement.scrollTop, view: document.querySelector('.besogo-board > svg').getAttribute('viewBox'),
      visible: !!cell && cell.top >= top - .5 && cell.bottom <= top + tree.clientHeight + .5 && cell.left >= left - .5 && cell.right <= left + tree.clientWidth + .5,
      legend: pane && rect(pane.querySelector('.zen-review-legend')), note: (n => n && !n.hidden ? rect(n) : null)(document.querySelector('.zen-review-comment')),
      arrows: rect(document.querySelector('.zen-review-controls')), next: rect(document.querySelector('.zen-next')), height: innerHeight, born: performance.timeOrigin,
      node: nodeKey(current), noteText: document.querySelector('.zen-review-comment:not([hidden])')?.textContent ?? '' };
  };
  const nodeKey = node => { const path = []; for (let n = node; n; n = n.parent) path.unshift(n.move ? `${n.move.x},${n.move.y}` : 'root'); return path.join('+'); };
  // A node on screen in the tree other than the current one, as a tap target.
  window.__zenTreeTarget = () => {
    const tree = document.querySelector('.besogo-tree'), box = rect(tree), found = [], walk = node => { found.push(node); node.children.forEach(walk); };
    walk(besogo.editor.getRoot());
    const node = found.filter(n => n !== besogo.editor.getCurrent() && n.navTreeMarker).find(n => { const r = rect(n.navTreeMarker); return r.top > box.top + 2 && r.bottom < box.top + tree.clientHeight - 2 && r.left > box.left + 2 && r.right < box.left + tree.clientWidth - 2; });
    if (!node) return null;
    const r = rect(node.navTreeMarker);
    return { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2, key: nodeKey(node) };
  };
  window.__zenTreeSiblings = () => { const c = besogo.editor.getCurrent(); return c.parent?.children.length ?? 0; };
  window.__zenNextVisible = direction => {
    const c = besogo.editor.getCurrent(), s = c.parent?.children ?? [], next = s[s.indexOf(c) + direction];
    if (!next?.navTreeMarker) return null;
    const tree = document.querySelector('.besogo-tree'), box = rect(tree), r = rect(next.navTreeMarker);
    return r.top >= box.top + tree.clientTop && r.bottom <= box.top + tree.clientTop + tree.clientHeight && r.left >= box.left + tree.clientLeft && r.right <= box.left + tree.clientLeft + tree.clientWidth;
  };
  window.__zenPointFor = (x, y) => {
    const svg = document.querySelector('.besogo-board > svg'), line = svg.querySelector('rect.besogo-svg-lines'), m = svg.getScreenCTM();
    const size = besogo.editor.getRoot().getSize(), step = +line.getAttribute('width') / (size.x - 1);
    return { x: m.e + (+line.getAttribute('x') + (x - 1) * step) * m.a, y: m.f + (+line.getAttribute('y') + (y - 1) * step) * m.d };
  };
  window.__zenDeepest = wanted => { let best; const walk = n => { if (wanted(n) && (!best || n.moveNumber > best.moveNumber)) best = n; n.children.forEach(walk); }; walk(besogo.editor.getRoot()); return best; };
}
