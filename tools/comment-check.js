// Run on a real problem with authored comments, with Review available.
// Hosts drive it: a yielded key is pressed for real, a yielded shot is captured.
async function* checkReviewComment() {
  const q = selector => document.querySelector(selector), e = besogo.editor, checks = [];
  const check = (ok, label) => { if (!ok) throw Error(label); checks.push(label); };
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const note = q('.zen-review-comment'), shown = () => !!note && note.getClientRects().length > 0;
  const native = () => q('#theComment').style.display === 'none' ? '' : q('#theComment').textContent.trim();
  const commented = [], plain = [];
  (function walk(node) { (node.comment?.trim() ? commented : plain).push(node); node.children.forEach(walk); })(e.getRoot());
  check(commented.length > 0, 'Problem has an authored comment');
  check(!q('.zen-comment-mark') && !shown(), 'No comment mark or panel outside Review');
  q('.zen-review').click();
  for (let i = 0; i < 60 && !(e.getReviewMode() && !q('.zen-review').hasAttribute('aria-busy')); i++) await pause(80);
  check(e.getReviewMode(), 'Review opened through the native button');
  await pause(200);
  check(document.querySelectorAll('.zen-comment-mark').length === commented.length, 'Every commented node is marked in the tree');
  const target = [...commented].sort((a, b) => b.comment.length - a.comment.length)[0];
  e.setCurrent(target); await pause(250);
  check(shown() && note.textContent.trim() === native(), 'Panel shows the native comment for this node');
  const box = note.getBoundingClientRect(), bar = q('.zen-toolbar').getBoundingClientRect(), pane = q('.zen-review-tree').getBoundingClientRect();
  check(box.top >= pane.top && box.bottom <= pane.bottom && box.left >= pane.left && box.right <= pane.right, 'Comment stays inside the Review panel');
  const actions = [...document.querySelectorAll('.zen-review-controls button, .zen-next, .zen-reset, .zen-review')].map(n => n.getBoundingClientRect());
  check(actions.every(r => !r.width || r.top >= box.bottom || r.bottom <= box.top || r.left >= box.right || r.right <= box.left), 'Comment clear of the bottom controls');
  check(q('.zen-review-tree > .besogo-tree').clientHeight >= 40, 'Tree keeps usable height');
  check(!q('.zen-live-status').hidden && q('.zen-feedback').hidden, 'Bar keeps the turn prompt, without a duplicate');
  yield { shot: 'node' };
  const moveBy = target.parent;
  if (moveBy) {
    const before = e.getCurrent();
    yield { key: 'ArrowLeft', code: 37 };
    if (window.__zenNoRealKeys && e.getCurrent() === before) q('.zen-rewind').click();
    await pause(250);
    check(e.getCurrent() === moveBy, window.__zenNoRealKeys ? 'Moved to the previous node' : 'Real Left arrow moved to the previous node');
    check(note.hidden === !native() && (note.hidden || note.textContent.trim() === native()), 'Panel follows the node');
    yield { key: 'ArrowRight', code: 39 };
    if (window.__zenNoRealKeys && e.getCurrent() !== target) e.setCurrent(target);
    await pause(250);
    check(e.getCurrent() === target && shown() && note.textContent.trim() === native(), 'Right arrow returns, and the panel with it');
  }
  const empty = plain.find(n => n !== e.getRoot() || !commented.includes(n));
  if (empty) { e.setCurrent(empty); await pause(250); check(!shown(), 'No panel on a node without a comment'); }
  const original = target.comment;
  target.comment = 'A long multi-line note used only to test layout.\n\n' + 'Second paragraph of the note. '.repeat(14) + '\nLast line.';
  e.setCurrent(e.getRoot()); await pause(120); e.setCurrent(target); await pause(250);
  check(note.classList.contains('zen-review-comment-more') && note.getBoundingClientRect().height <= 70, 'Long text is clamped and marked');
  note.click(); await pause(200);
  const dialog = q('.zen-feedback-dialog');
  check(dialog.open && dialog.textContent.includes('Last line.') && dialog.textContent.includes('\n\n'), 'Dialog shows the whole multi-line comment');
  yield { shot: 'dialog' };
  dialog.close(); target.comment = original; e.setCurrent(e.getRoot()); await pause(120); e.setCurrent(target); await pause(200);
  q('.zen-review').click();
  for (let i = 0; i < 60 && (e.getReviewMode() || q('.zen-review').hasAttribute('aria-busy')); i++) await pause(80);
  await pause(250);
  check(!e.getReviewMode() && !shown() && !q('.zen-comment-mark'), 'Exit Review removes the panel and marks');
  check(q('.zen-feedback button').getClientRects().length > 0 === !!native(), 'Comment returns to the bar outside Review');
  return checks;
}
