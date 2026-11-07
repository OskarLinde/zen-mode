// What iOS Safari would sample at each edge, by WebKit's rule (LocalFrameView::fixedContainerEdges):
// the element at the viewport's top and bottom midpoints, 4 px in; a fixed or sticky ancestor
// at least 90% of the viewport wide there makes Safari paint a solid bar, and so does a modal
// dialog's ::backdrop. Page::updateFixedContainerEdges then keeps that colour while the element
// stays rendered, and after the first interaction it no longer re-samples the top at all.
function edgeSolidState() {
  const root = document.documentElement, width = innerWidth, height = innerHeight;
  const describe = node => node.tagName.toLowerCase() + (node.id ? '#' + node.id : '') + (node.classList.length ? '.' + [...node.classList].join('.') : '');
  const edge = y => {
    const hit = document.elementFromPoint(width / 2, y);
    if (!hit) return null;
    if (hit.matches('dialog:modal, :popover-open')) {
      const backdrop = getComputedStyle(hit, '::backdrop');
      if (backdrop.display !== 'none') return 'backdrop of ' + describe(hit);
    }
    for (let node = hit; node && node.nodeType === 1; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.position !== 'fixed' && style.position !== 'sticky') continue;
      if (style.visibility === 'hidden' || Number(style.opacity) < 0.05) continue;
      const r = node.getBoundingClientRect();
      if (r.width >= width * 0.9 && r.width > 10 && r.height > 10) return describe(node) + ` ${Math.round(r.width)}x${Math.round(r.height)} ${style.position}`;
    }
    // WebKit's hit test ignores pointer-events, which elementFromPoint honours: also find any
    // fixed or sticky layer covering the sampled point by its box alone.
    for (const node of document.querySelectorAll('body *, html > *')) {
      const style = getComputedStyle(node);
      if (style.position !== 'fixed' && style.position !== 'sticky') continue;
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      const r = node.getBoundingClientRect();
      if (r.width >= width * 0.9 && r.height > 10 && r.top <= y && r.bottom >= y && r.left <= width / 2 && r.right >= width / 2)
        return describe(node) + ` ${Math.round(r.width)}x${Math.round(r.height)} ${style.position} (by box)`;
    }
    return null;
  };
  // Open modal dialogs, for the record: only a backdrop reaching the sampled band matters.
  const modal = [...document.querySelectorAll('dialog, [popover]')].filter(d => d.matches(':modal, :popover-open')).map(describe);
  // A popover's or modal's ::backdrop covers the viewport whatever its own box, and hit tests
  // reach it through pointer-events: none.
  const backdrop = [...document.querySelectorAll('[popover]')].filter(d => d.matches(':popover-open') && getComputedStyle(d, '::backdrop').display !== 'none').map(d => 'backdrop of ' + describe(d));
  return { top: edge(4) || backdrop[0] || null, bottom: edge(height - 5) || backdrop[0] || null, modal, scroll: document.scrollingElement?.scrollTop ?? null,
    edges: root.hasAttribute('data-zen-edges') };
}
