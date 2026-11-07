// Interpret the native navigation tile's metadata, never its displayed color.
// V includes first visits because opening the page itself marks it visited.
export function problemHistory({ code, ratio = '', training = false, missed = false, failedHere = false, guest = false } = {}) {
  if (guest) return null;
  if (training) {
    if (code === 'S') return { label: 'Solved', detail: 'Solved for today’s mistake training.' };
    if (code === 'N') return missed || failedHere
      ? { label: 'Failed', detail: 'Missed today; still due in mistake training.' }
      : { label: 'Due', detail: 'Due in mistake training; this does not mean the problem is new.' };
    return null;
  }
  const known = {
    N: { label: 'New', detail: 'The site marks this problem as not visited.' },
    S: { label: 'Solved', detail: 'Previously solved.' },
    C: { label: 'Solved', detail: 'Mastered: solved and passed review.' },
    W: { label: 'Solved', detail: 'Previously solved; due for review.' },
    F: { label: 'Failed', detail: 'Previously failed; locked by the site for today.' },
    X: { label: 'Failed', detail: 'Previously solved, then failed review; locked for today.' },
    G: { label: 'Bonus', detail: 'Golden problem. This status does not establish prior solving history.' }
  };
  if (['S', 'C', 'W', 'F', 'X', 'G'].includes(code)) return known[code];
  if (!['N', 'V'].includes(code)) return null;
  if (failedHere) return { label: 'Failed', detail: 'An attempt failed on this visit.' };
  const counts = ratio.trim().match(/^(\d+)\s*\/\s*(\d+)$/);
  if (counts && Number(counts[2]) > 0) return { label: 'Failed', detail: 'Previous attempts shown by the site include failures; not marked solved.' };
  if (counts && Number(counts[1]) > 0) return { label: 'Tried', detail: 'The site shows past attempts but does not currently mark this problem solved.' };
  if (code === 'N') return known.N;
  return ratio.trim() === '-' || counts
    ? { label: 'Untried', detail: 'No attempts are shown by the site. Opening a problem already marks it visited.' }
    : { label: 'Unsolved', detail: 'Visited, but not marked solved. Attempt history is unavailable.' };
}

// Use the displayed instruction, not a hidden solver/result flag. A result or
// continuation without a stated player color must not retain a stale stone.
export function turnColor(instruction = '') {
  return instruction.trim().match(/^(black|white)\s+to\b/i)?.[1].toLowerCase() || '';
}

// Native transformations already update move.color and firstMove. Applying
// isColorInverted again would reverse the displayed player a second time.
export function replyColor(node, solver) {
  if (!node?.move || ![-1, 1].includes(solver) || node.localEdit || node.target?.localEdit) return '';
  // Virtual redirects may omit color; their resulting position contains the
  // played stone. Do not infer it by alternating turns or the solver's color.
  const { x, y, color: recorded } = node.move;
  const color = [-1, 1].includes(recorded) ? recorded : Number.isInteger(x) && Number.isInteger(y) && x > 0 && y > 0
    ? node.target?.getStone?.(x, y) : undefined;
  return color === solver ? '' : color === -1 ? 'black' : color === 1 ? 'white' : 'unknown';
}

// Mirror only the revealed native counter. Engine health/result flags can change
// before a refutation is shown; reading those would spoil the line.
// The site also marks a guest with id 0, which its own flag misses.
export const isGuest = () => window.besogoNoLogin === true || window.besogoUserId === 0;

// Draws touches for screen recordings, since iOS can't. It only watches: every listener
// is passive, nothing is prevented, and the layer takes no pointer events. It is a
// popover because sheets are in the top layer, where nothing else can sit above them.
export function createTapTrace() {
  const layer = document.createElement('div'); layer.className = 'zen-taps'; layer.setAttribute('aria-hidden', 'true');
  if ('popover' in layer) layer.popover = 'manual';
  const rings = new Map();
  let listening;
  const raise = () => {
    if (!layer.isConnected) document.documentElement.append(layer);
    if (layer.showPopover) { if (layer.matches(':popover-open')) layer.hidePopover(); layer.showPopover(); }
  };
  const place = (ring, x, y) => { ring.style.left = `${x}px`; ring.style.top = `${y}px`; };
  const begin = (id, x, y) => {
    raise();
    const ring = document.createElement('div'); ring.className = 'zen-tap'; place(ring, x, y);
    layer.append(ring); rings.set(id, ring);
  };
  const end = id => {
    const ring = rings.get(id); if (!ring) return;
    rings.delete(id); ring.classList.add('zen-tap-end');
    setTimeout(() => ring.remove(), 300);
  };
  const eachTouch = (event, act) => { for (const touch of event.changedTouches) act(`touch${touch.identifier}`, touch); };
  const handlers = {
    touchstart: event => eachTouch(event, (id, touch) => begin(id, touch.clientX, touch.clientY)),
    touchmove: event => eachTouch(event, (id, touch) => { const ring = rings.get(id); if (ring) place(ring, touch.clientX, touch.clientY); }),
    touchend: event => eachTouch(event, end),
    touchcancel: event => eachTouch(event, end),
    pointerdown: event => { if (event.pointerType !== 'touch') begin(event.pointerId, event.clientX, event.clientY); },
    pointermove: event => { const ring = rings.get(event.pointerId); if (ring) place(ring, event.clientX, event.clientY); },
    pointerup: event => end(event.pointerId),
    pointercancel: event => end(event.pointerId)
  };
  return { sync(on) {
    if (on === !!listening) return;
    if (on) {
      listening = new AbortController();
      for (const [type, handler] of Object.entries(handlers))
        addEventListener(type, handler, { capture: true, passive: true, signal: listening.signal });
    } else { listening.abort(); listening = undefined; rings.clear(); layer.replaceChildren(); layer.remove(); }
  } };
}

// How long Next stays quiet, then how long from the press it may show it is waiting.
export const NEXT_SPINNER_DELAY = 200, NEXT_SPINNER_LIMIT = 10000;

// The wait for the site to answer Next. Nothing here touches the navigation itself. The
// button stays usable, and a press during a wait changes nothing here.
export function createNextWait(control) {
  let shown, ended;
  const clear = () => {
    clearTimeout(shown); clearTimeout(ended); shown = ended = undefined;
    control.removeAttribute('aria-busy');
  };
  return { clear, start() {
    if (ended !== undefined) return;
    shown = setTimeout(() => control.setAttribute('aria-busy', 'true'), NEXT_SPINNER_DELAY);
    ended = setTimeout(clear, NEXT_SPINNER_LIMIT);
  } };
}

// "3 / 5" from the site's counter. Anything else gives NaN.
export function parseHearts(text) {
  const match = text?.trim().match(/^(-?\d+)\s*\/\s*(\d+)$/);
  return match ? { remaining: Number(match[1]), total: Number(match[2]) } : { remaining: NaN, total: NaN };
}

// "Easy Life 93/200" as its set and number. A title without a number is all set.
export function splitProblemTitle(title) {
  const parts = title.match(/^(.*?)\s+(\d+\s*\/\s*\d+)$/);
  return parts ? { set: parts[1], number: parts[2] } : { set: title, number: '' };
}

// The site's continuation text, then any training notes under its result heading.
export const composeFeedback = (continuation, heading, notes) =>
  [continuation, ...(notes.length ? [heading, ...notes] : [])].filter(Boolean).join('\n\n');

export function createHeartIndicator(toolbar) {
  const indicator = document.createElement('div');
  indicator.className = 'zen-hearts'; indicator.hidden = true;
  indicator.setAttribute('role', 'status'); indicator.setAttribute('aria-live', 'polite');
  indicator.setAttribute('aria-atomic', 'true');
  indicator.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 21S3 15.5 3 8.5a4.5 4.5 0 0 1 9-1 4.5 4.5 0 0 1 9 1C21 15.5 12 21 12 21Z"/></svg><span class="zen-heart-count"><span class="zen-heart-remaining"></span><span class="zen-heart-slash"></span><span class="zen-heart-total"></span></span>';
  const [numerator, slash, denominator] = indicator.lastElementChild.children;
  toolbar.append(indicator);
  let source, lastValue;
  const observer = new MutationObserver(sync);
  function sync() {
    const health = document.querySelector('#health');
    const container = health?.closest('.play-header-table, .play-header') || document.querySelector('.play-header-table, .play-header') || health;
    if (container !== source) {
      observer.disconnect(); source = container;
      if (source) observer.observe(source, { childList: true, characterData: true, subtree: true });
    }
    const { remaining, total } = parseHearts(health?.querySelector('#health-counter')?.textContent);
    const known = !isGuest() && Number(window.mode) !== 5 &&
      Number.isSafeInteger(remaining) && Number.isSafeInteger(total) && total > 0 && remaining <= total;
    const value = known ? `${Math.max(0, remaining)}/${total}` : '';
    indicator.hidden = !known;
    if (lastValue !== value) {
      lastValue = value;
      numerator.textContent = known ? String(Math.max(0, remaining)) : '';
      slash.textContent = known ? '⁄' : '';
      denominator.textContent = known ? String(total) : '';
      indicator.setAttribute('aria-label', known ? `${Math.max(0, remaining)} of ${total} hearts remaining` : 'Hearts');
    }
  }
  return { sync, destroy() { observer.disconnect(); indicator.remove(); } };
}

// Adapt only the native achievement toast, retaining its content and close
// handler. No achievement state, requests, award rules or timers are created.
export function createAchievementNotices({ toolbar }) {
  let zenOn = false;
  const records = new Map(), host = document.createElement('div');
  host.className = 'zen-achievements';
  function position() {
    if (!zenOn) return;
    const viewport = window.visualViewport, top = viewport?.offsetTop || 0;
    const height = Math.max(0, Math.min(top + (viewport?.height || innerHeight), toolbar.getBoundingClientRect().top) - top);
    host.style.left = `${viewport?.offsetLeft || 0}px`;
    host.style.top = `${top}px`; host.style.width = `${viewport?.width || innerWidth}px`;
    host.style.setProperty('--zen-notice-height', `${height}px`);
    host.toggleAttribute('data-compact', height < 300);
  }
  function enhance(toast) {
    if (records.has(toast)) return;
    const banner = toast.querySelector('.toast__banner'), nativeClose = toast.querySelector('.toast__close');
    if (!banner || !nativeClose) return; // Unknown notification structures stay native.
    const marker = document.createComment('Zen Mode: original achievement location'); toast.before(marker);
    const attributes = ['role', 'tabindex', 'aria-label'].map(name => [name, toast.getAttribute(name)]);
    toast.dataset.zenAchievement = ''; toast.setAttribute('role', 'status'); toast.tabIndex = 0;
    toast.setAttribute('aria-label', 'Achievement notification. Tap or press Enter to dismiss.');
    const close = document.createElement('button'); close.type = 'button'; close.className = 'zen-achievement-dismiss';
    close.textContent = '×'; close.setAttribute('aria-label', 'Dismiss achievement notification'); banner.append(close);
    let dismissing = false, start, dragged = false;
    const dismiss = event => {
      event.preventDefault(); event.stopPropagation();
      if (dismissing || !toast.isConnected) return;
      dismissing = true; nativeClose.click();
      if (toast.contains(document.activeElement)) document.querySelector('.besogo-board')?.focus({ preventScroll: true });
    };
    const click = event => {
      event.stopPropagation(); // Never deliver dismissal to solved-page navigation.
      if (event.defaultPrevented || dragged || event.target.closest('a, button, input, select, textarea, .toast__close')) return;
      const selected = window.getSelection();
      if (selected && !selected.isCollapsed && toast.contains(selected.anchorNode)) return;
      dismiss(event);
    };
    const key = event => {
      if (event.target === toast && ['Enter', ' ', 'Escape'].includes(event.key) && !event.isComposing &&
          !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) dismiss(event);
    };
    const down = event => { start = [event.clientX, event.clientY]; dragged = false; };
    const move = event => { if (start && Math.hypot(event.clientX - start[0], event.clientY - start[1]) > 8) dragged = true; };
    const cancel = () => { dragged = true; };
    close.addEventListener('click', dismiss);
    const listeners = { click, keydown: key, pointerdown: down, pointermove: move, pointercancel: cancel };
    for (const [type, listener] of Object.entries(listeners)) toast.addEventListener(type, listener);
    records.set(toast, { marker, attributes, close, listeners }); host.append(toast);
  }
  function restore() {
    for (const [toast, record] of records) {
      for (const [type, listener] of Object.entries(record.listeners)) toast.removeEventListener(type, listener);
      record.close.remove(); delete toast.dataset.zenAchievement;
      for (const [name, value] of record.attributes) value === null ? toast.removeAttribute(name) : toast.setAttribute(name, value);
      // Do not resurrect notifications the site removed while Zen mode was active.
      if (toast.isConnected && record.marker.isConnected) record.marker.replaceWith(toast);
      else record.marker.remove();
    }
    records.clear(); host.remove();
  }
  const observer = new MutationObserver(changes => {
    for (const change of changes) for (const node of change.addedNodes)
      if (node.nodeType === 1 && node.matches('.toast.toast--achievement')) enhance(node);
    position();
  });
  const size = new ResizeObserver(position); size.observe(toolbar);
  window.addEventListener('resize', position);
  window.visualViewport?.addEventListener('resize', position);
  window.visualViewport?.addEventListener('scroll', position);
  return {
    sync(on) {
      if (zenOn === on) return;
      zenOn = on;
      if (!on) { observer.disconnect(); restore(); return; }
      document.body.append(host);
      for (const toast of document.querySelectorAll('body > .toast.toast--achievement')) enhance(toast);
      observer.observe(document.body, { childList: true }); position();
    },
    destroy() {
      zenOn = false; observer.disconnect(); size.disconnect(); restore();
      window.removeEventListener('resize', position);
      window.visualViewport?.removeEventListener('resize', position);
      window.visualViewport?.removeEventListener('scroll', position);
    }
  };
}

// The site shows its comment section only on a solved problem, and not to guests.
const conversationAvailable = () => { const section = document.querySelector('#commentSpace'); return !!section && section.style.display !== 'none'; };

// Present the site's own UI without cloning forms, IDs, state or listeners.
// Elements return to their original locations when a sheet closes. No links
// are fetched and no native actions run merely because a menu opens.
export function createSiteMenus({ toolbar, target, options, update }) {
  let zenOn = false;
  const content = target.parentElement;
  const records = new Map();
  const keyboardActions = new WeakSet();
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'zen-nav-trigger';
  trigger.setAttribute('aria-label', 'Site navigation');
  trigger.setAttribute('aria-haspopup', 'dialog');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.innerHTML = '<span></span><span></span><span></span>';
  toolbar.append(trigger);
  const summary = options.querySelector('summary');
  // Dialog focus restoration can make a tapped opener :focus-visible in
  // Safari. Keep keyboard focus return, but do not leave a ring after touch.
  let keyboardInteraction = false;
  const pointerInteraction = () => {
    keyboardInteraction = false;
    if ([trigger, summary].includes(document.activeElement)) document.activeElement.blur();
  };
  const keyInteraction = event => {
    if (!['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) keyboardInteraction = true;
  };
  document.addEventListener('pointerdown', pointerInteraction, true);
  document.addEventListener('keydown', keyInteraction, true);

  function sheet(name, title) {
    const dialog = document.createElement('dialog');
    dialog.className = `zen-site-sheet zen-${name}-sheet`;
    dialog.id = `zen-${name}-sheet`;
    const heading = document.createElement('header');
    const label = document.createElement('h2'); label.id = `${dialog.id}-title`; label.textContent = title;
    dialog.setAttribute('aria-labelledby', label.id);
    const close = document.createElement('button'); close.type = 'button'; close.textContent = 'Close';
    close.setAttribute('aria-label', `Close ${title.toLowerCase()}`);
    close.onclick = () => dialog.close();
    heading.append(label, close); dialog.append(heading);
    const native = document.createElement('div'); native.className = `zen-native-ui zen-native-${name}`;
    native.addEventListener('keydown', event => {
      if (keyboardActions.has(event.target) && ['Enter', ' '].includes(event.key)) {
        event.preventDefault(); event.stopPropagation(); event.target.click();
      }
    });
    dialog.append(native); toolbar.append(dialog);
    dialog.addEventListener('close', () => {
      restore(dialog);
      const opener = name === 'navigation' ? trigger : summary;
      opener.setAttribute('aria-expanded', 'false');
      if (zenOn && !navigation.dialog.open && !problem.dialog.open) {
        if (keyboardInteraction) opener.focus({ preventScroll: true });
        else if (document.activeElement === opener) opener.blur();
      }
      update();
    });
    dialog.addEventListener('click', event => {
      const r = dialog.getBoundingClientRect();
      if (event.target === dialog && (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom)) dialog.close();
    });
    return { dialog, native };
  }
  const navigation = sheet('navigation', 'Site navigation');
  const problem = sheet('problem', 'Problem & options');
  const version = document.documentElement.dataset.zenVersion;
  if (version) {
    const foot = document.createElement('p'); foot.className = 'zen-sheet-version';
    foot.textContent = `Zen Mode ${version}`; problem.dialog.append(foot);
  }
  trigger.setAttribute('aria-controls', navigation.dialog.id);
  summary.setAttribute('aria-controls', problem.dialog.id);

  function move(element, destination, dialog) {
    if (!element || records.has(element)) return;
    const marker = document.createComment('Zen Mode: original UI location');
    element.before(marker);
    const attributes = [];
    for (const action of element.querySelectorAll('.besogo-tsumegoPlayTool > img[id], a.selectable-text:not([href]), a[onclick]:not([href]), #boardsInMenu')) {
      keyboardActions.add(action);
      for (const [name, value] of [['tabindex', '0'], ['role', 'button'], ['aria-label', action.title || action.textContent.trim() || 'Board appearance']]) {
        if (action.hasAttribute(name)) continue;
        attributes.push({ action, name, value }); action.setAttribute(name, value);
      }
    }
    records.set(element, { marker, dialog, attributes });
    destination.append(element);
  }
  function restore(dialog) {
    for (const [element, record] of records) {
      if (record.dialog !== dialog) continue;
      for (const { action, name, value } of record.attributes) {
        if (action.getAttribute(name) === value) action.removeAttribute(name);
        keyboardActions.delete(action);
      }
      // Engine initialization may have replaced its original container. Never
      // resurrect an obsolete panel or duplicate its control IDs in that case.
      if (record.marker.isConnected) record.marker.replaceWith(element);
      else element.remove();
      records.delete(element);
    }
  }
  function collect() {
    for (const [element, record] of records) {
      if (!record.marker.isConnected) { element.remove(); records.delete(element); }
    }
    if (navigation.dialog.open) {
      move(document.querySelector('.whitebox1, .sample-header'), navigation.native, navigation.dialog);
    }
    if (problem.dialog.open) {
      for (const control of [...options.children]) {
        if (control === summary) continue;
        move(control, problem.dialog, problem.dialog);
        problem.dialog.insertBefore(control, problem.native);
      }
      move(target.querySelector('.besogo-bottom-panels'), problem.native, problem.dialog);
      for (const element of [...content.children]) {
        if ([target, toolbar].includes(element) || element.matches('script, style, link, audio, template, #targetLockOverlay')) continue;
        move(element, problem.native, problem.dialog);
      }
      move(document.querySelector('#footer'), problem.native, problem.dialog);
      showMore();
    }
  }
  // More is the site's last section, and this sheet is already scrolled to it, so
  // show it in place of its toggle, once the site itself would offer the toggle.
  function showMore() {
    const more = document.querySelector('#editToggle'), section = document.querySelector('#editSection');
    if (!more || !section) return;
    const offered = !more.classList.contains('play-edit-toggle--after-solve') || more.style.display === 'inline';
    more.classList.toggle('zen-more-shown', offered);
    section.classList.toggle('zen-more-shown', offered);
  }
  function open(menu, opener) {
    if (!zenOn) return;
    for (const other of [navigation, problem]) {
      if (other.dialog.open) { other.dialog.close(); restore(other.dialog); }
    }
    options.open = false;
    menu.dialog.showModal();
    collect();
    opener.setAttribute('aria-expanded', 'true');
  }
  trigger.onclick = () => open(navigation, trigger);
  summary.addEventListener('click', event => {
    if (!zenOn) return;
    event.preventDefault();
    open(problem, summary);
  });
  const additions = new MutationObserver(records => {
    collect();
    // Training can enable Next after its result arrives, including while the
    // original control is temporarily in this sheet instead of #target.
    if (records.some(record => record.type === 'attributes' && record.target.matches('[id^="besogo-"]'))) update();
  });
  // Capture native panels or page sections arriving after the board/module.
  additions.observe(content, { childList: true, subtree: true, attributes: true, attributeFilter: ['id', 'disabled', 'href'] });
  return {
    close() {
      for (const menu of [navigation, problem]) {
        if (menu.dialog.open) menu.dialog.close();
        restore(menu.dialog);
      }
    },
    sync(on) {
      zenOn = on;
      if (zenOn) {
        summary.setAttribute('aria-haspopup', 'dialog');
        summary.setAttribute('aria-controls', problem.dialog.id);
        summary.setAttribute('aria-expanded', String(problem.dialog.open));
      } else {
        for (const name of ['aria-haspopup', 'aria-controls', 'aria-expanded']) summary.removeAttribute(name);
      }
      if (!zenOn) for (const menu of [navigation, problem]) {
        if (menu.dialog.open) menu.dialog.close();
        restore(menu.dialog);
      }
    },
    findControl(selector) { return target.querySelector(selector) || problem.native.querySelector(selector); },
    // Only the site's own actions: its event opens the tab and loads the comments,
    // and its Here & ahead filter narrows them to this node of the tree.
    async openConversation() {
      if (!zenOn || !conversationAvailable()) return;
      open(problem, summary);
      const section = document.querySelector('#commentSpace');
      window.dispatchEvent(new Event('comments-open'));
      const deadline = performance.now() + 4000;
      let here;
      while (problem.dialog.open && !here && performance.now() < deadline) {
        here = [...section.querySelectorAll('.tsumego-comments__anchor-btn')].find(button => /^Here\b/.test(button.textContent.trim()));
        if (!here) await new Promise(resolve => setTimeout(resolve, 80));
      }
      here?.click();
      section.scrollIntoView({ block: 'start' });
    },
    destroy() {
      additions.disconnect();
      document.removeEventListener('pointerdown', pointerInteraction, true);
      document.removeEventListener('keydown', keyInteraction, true);
      for (const menu of [navigation, problem]) { menu.dialog.close(); restore(menu.dialog); menu.dialog.remove(); }
      trigger.remove();
    }
  };
}

// Run after the focused control has handled its keys, but before the site's
// container/document shortcuts (which do not check a control's prevented/default state).
export function arrowKeyIsReserved(event, document) {
  return event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey ||
    event.isComposing || event.keyCode === 229 ||
    event.composedPath().some(el => el?.isContentEditable || el?.matches?.(
      'input, textarea, select, summary, [role="textbox"], [role="combobox"], [role="listbox"], ' +
      '[role="menu"], [role="menubar"], [role="slider"], [role="spinbutton"], [role="tablist"], ' +
      '[role="tree"], [role="grid"], .zen-native-ui, .zen-achievements')) ||
    !!document.querySelector('dialog[open], [role="dialog"][aria-modal="true"], .zen-options[open]');
}

// Reuse the native review handler, navigation buttons and live game-tree DOM.
// Review availability belongs to the site: the only state is the native button's
// id, set from the server's solved state when it is built and changed on a solve.
// The site's controls are reached through findControl, which also looks inside the open
// sheets; Review does not hold the menu object itself.
export function createReviewControls({ toolbar, target, findControl, closeMenus, openConversation, update, openComment }) {
  let editor, tree, marker, highlighted, pending, coloredTree, coloredSolver;
  let treeNodes = new WeakMap(), tap, tapped;
  const opponentIcons = new Set();
  const commentMarks = new Map();
  const replyMarkers = new Set();
  const root = document.documentElement;
  const row = document.createElement('div'); row.className = 'zen-review-controls'; row.hidden = true;
  row.setAttribute('role', 'group'); row.setAttribute('aria-label', 'Review and move navigation');
  const pane = document.createElement('div'); pane.className = 'zen-review-tree'; pane.hidden = true;
  pane.setAttribute('role', 'region'); pane.setAttribute('aria-label', 'Game tree');
  const legend = document.createElement('div'); legend.className = 'zen-review-legend';
  legend.title = 'Green/red describe your candidate moves. Opponent replies use their displayed stone color. Blue is local, ungraded exploration.';
  for (const [color, label] of [['green', '✓ Your line'], ['red', '× Fails'], ['blue', '+ Local'], ['#29352f', '◐ Reply'], ['grey', '? Unknown'], ['#b5761a', '● Comment']]) {
    const item = document.createElement('span'); item.style.color = color; item.textContent = label; legend.append(item);
  }
  // The problem's own comment on this node. Player comments stay in the site's section.
  const note = document.createElement('button'); note.type = 'button'; note.className = 'zen-review-comment'; note.hidden = true;
  note.title = 'Read the full comment'; note.setAttribute('aria-live', 'polite'); note.onclick = openComment;
  const conversation = document.createElement('button'); conversation.type = 'button'; conversation.className = 'zen-review-conversation'; conversation.hidden = true;
  conversation.onclick = () => openConversation();
  pane.append(legend, note, conversation);
  const notice = document.createElement('div'); notice.className = 'zen-review-message'; notice.hidden = true;
  notice.setAttribute('role', 'alert');
  const noticeText = document.createElement('span'), dismiss = document.createElement('button');
  dismiss.type = 'button'; dismiss.textContent = 'Dismiss'; dismiss.onclick = () => { notice.hidden = true; };
  notice.append(noticeText, dismiss);
  const nativeReview = () => findControl('[id^="besogo-review-button"]');
  const enabled = control => control && !control.disabled && !control.id.endsWith('-inactive');
  const reviewing = () => editor?.getReviewMode?.() === true;
  const reviewAllowed = () => enabled(nativeReview());
  // The button may sit in the moved native menu, outside the board's observer.
  const nativeState = new MutationObserver(update);
  let watched;
  const watchNative = native => {
    if (native === watched) return;
    nativeState.disconnect(); watched = native;
    if (native) nativeState.observe(native, { attributes: true, attributeFilter: ['id', 'disabled'] });
  };
  const moveControl = title => findControl(`.besogo-control button[title="${title}"]`);
  // By position, with a margin: the site's bubble is small and may take no pointer events.
  const onBubble = (x, y) => [...pane.querySelectorAll('.besogo-tree-comment-badge__bubble')].some(bubble => {
    const box = bubble.getBoundingClientRect();
    return x >= box.left - 6 && x <= box.right + 6 && y >= box.top - 6 && y <= box.bottom + 6;
  });
  const tappedNode = element => {
    for (; element && element !== pane; element = element.parentElement) {
      const node = treeNodes.get(element);
      if (node) return node;
    }
  };
  // The native SVG uses mouse hover/click handlers. Resolve touch/pen taps
  // directly through the same editor API, without depending on Safari's
  // synthesized mouse events. Leave scrolling and mouse/keyboard clicks native.
  pane.addEventListener('pointerdown', event => {
    tap = tapped = undefined;
    const node = tappedNode(event.target);
    if (!event.isPrimary || !['touch', 'pen'].includes(event.pointerType) || event.button !== 0 ||
        pending || !reviewing() || !node || typeof editor?.setCurrent !== 'function') return;
    tap = { id: event.pointerId, node, editor, tree, x: event.clientX, y: event.clientY, time: performance.now(), bubble: onBubble(event.clientX, event.clientY) };
  }, { passive: true });
  pane.addEventListener('pointermove', event => {
    if (tap?.id === event.pointerId && Math.hypot(event.clientX - tap.x, event.clientY - tap.y) > 10) tap.dragged = true;
  }, { passive: true });
  pane.addEventListener('scroll', () => { if (tap) tap.dragged = true; }, true);
  pane.addEventListener('pointercancel', () => { tap = undefined; }, { passive: true });
  pane.addEventListener('pointerup', event => {
    const start = tap; tap = undefined;
    if (!start || start.id !== event.pointerId) return;
    // Swallow only the compatibility click from this gesture, including a drag
    // that some browsers still turn into a click. Never swallow keyboard clicks.
    tapped = { x: event.clientX, y: event.clientY, time: performance.now() };
    if (pending || !reviewing() || pane.hidden || editor !== start.editor || tree !== start.tree || start.dragged ||
        performance.now() - start.time > 800 || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10 ||
        tappedNode(document.elementFromPoint(event.clientX, event.clientY)) !== start.node) return;
    editor.setCurrent(start.node);
    update();
    if (start.bubble) openConversation();
  }, { passive: true });
  pane.addEventListener('click', event => {
    if (!tapped && onBubble(event.clientX, event.clientY)) setTimeout(() => openConversation());
    if (!tapped || event.detail === 0 || performance.now() - tapped.time > 700 ||
        Math.hypot(event.clientX - tapped.x, event.clientY - tapped.y) > 16) return;
    tapped = undefined;
    event.preventDefault(); event.stopImmediatePropagation();
  }, true);
  function revealCurrent() {
    if (!tree?.contains(highlighted)) return;
    const cell = highlighted.getBoundingClientRect(), box = tree.getBoundingClientRect();
    const viewport = { top: box.top + tree.clientTop, bottom: box.top + tree.clientTop + tree.clientHeight,
      left: box.left + tree.clientLeft, right: box.left + tree.clientLeft + tree.clientWidth };
    if (cell.top < viewport.top) tree.scrollTop -= viewport.top - cell.top;
    else if (cell.bottom > viewport.bottom) tree.scrollTop += cell.bottom - viewport.bottom;
    if (cell.left < viewport.left) tree.scrollLeft -= viewport.left - cell.left;
    else if (cell.right > viewport.right) tree.scrollLeft += cell.right - viewport.right;
  }
  // A comment appearing or changing length resizes the tree under the current node.
  const treeSize = new ResizeObserver(revealCurrent);
  function restoreTree() {
    tap = undefined;
    treeSize.disconnect();
    if (marker?.isConnected) marker.replaceWith(tree);
    else tree?.remove();
    tree = marker = undefined;
  }
  function finishPending(message = '') {
    if (!pending) return;
    clearTimeout(pending.timeout); clearTimeout(pending.poll); cancelAnimationFrame(pending.frame);
    pending = undefined;
    review.removeAttribute('aria-busy');
    noticeText.textContent = message; notice.hidden = !message;
    update();
  }
  function ready(attempt) {
    return editor === attempt.editor && reviewing() === attempt.open &&
      (!attempt.open || !!(tree || target.querySelector('.besogo-tree'))?.childElementCount);
  }
  function awaitReview(attempt) {
    if (pending !== attempt) return;
    if (ready(attempt)) {
      update(); // Fit the board and relocate the tree before removing the spinner.
      attempt.frame = requestAnimationFrame(() => {
        if (pending !== attempt) return;
        if (ready(attempt)) finishPending();
        else awaitReview(attempt);
      });
    } else attempt.poll = setTimeout(() => awaitReview(attempt), 100);
  }
  function button(name, label, text, action) {
    const el = document.createElement('button'); el.type = 'button'; el.className = `zen-${name}`;
    el.textContent = text; el.title = label; el.setAttribute('aria-label', label);
    el.onclick = () => { closeMenus(); action(); if (!pending) update(); };
    row.append(el); return el;
  }
  const review = button('review', 'Review problem', 'Review', () => {
    if (pending || !nativeReview() || (!reviewing() && !reviewAllowed())) return;
    const attempt = { editor, open: !reviewing(), invoked: false };
    pending = attempt; notice.hidden = true;
    review.disabled = true; review.setAttribute('aria-busy', 'true');
    review.setAttribute('aria-label', attempt.open ? 'Opening review' : 'Closing review');
    const spinner = document.createElement('span'); spinner.className = 'zen-review-spinner'; spinner.setAttribute('aria-hidden', 'true');
    review.replaceChildren(spinner);
    attempt.timeout = setTimeout(() => {
      if (pending === attempt) finishPending(attempt.invoked && ready(attempt) ? '' :
        'Review did not finish within 5 seconds. Try again, or choose Site page under •••.');
    }, 5000);
    // Two frames give the busy state a paint before the native synchronous tree
    // renderer runs. Timers cannot preempt a blocked JavaScript event loop.
    attempt.frame = requestAnimationFrame(() => {
      attempt.frame = requestAnimationFrame(() => {
        if (pending !== attempt) return;
        const native = nativeReview();
        if (editor !== attempt.editor || !native?.isConnected) { finishPending(); return; }
        try {
          if (attempt.open && !reviewAllowed()) { finishPending(); return; }
          native.click(); attempt.invoked = true;
          awaitReview(attempt);
        } catch {
          finishPending('Review could not open. Try again, or choose Site page under •••.');
        }
      });
    });
  });
  const back = button('rewind', 'Back one move', '←', () => {
    if (reviewing()) moveControl('Previous node')?.click();
  });
  const forward = button('forward', 'Forward one move', '→', () => {
    if (reviewing()) moveControl('Next node')?.click();
  });
  const branch = direction => {
    if (reviewing() && typeof editor?.nextSibling === 'function') editor.nextSibling(direction);
  };
  const up = button('branch-up', 'Previous variation', '↑', () => branch(-1));
  const down = button('branch-down', 'Next variation', '↓', () => branch(1));
  toolbar.append(review, row, pane, notice);
  const cancelOnReset = event => {
    if (event.target.closest('.zen-reset, [id^="besogo-reset-button"]')) finishPending();
  };
  const cancelOnLeave = () => finishPending();
  toolbar.addEventListener('click', cancelOnReset, true); target.addEventListener('click', cancelOnReset, true);
  window.addEventListener('pagehide', cancelOnLeave);
  function clearColors() {
    for (const icon of opponentIcons) { icon.classList.remove('zen-opponent-node'); delete icon.dataset.zenReply; }
    for (const dot of replyMarkers) delete dot.dataset.zenReply;
    for (const mark of commentMarks.values()) mark.remove();
    commentMarks.clear();
    replyMarkers.clear(); opponentIcons.clear(); coloredTree = coloredSolver = undefined; treeNodes = new WeakMap();
  }
  return {
    hasArrowNavigation() { return !!pending || reviewing(); },
    // Returns whether the Review panel is showing this text.
    showComment(text) {
      const shown = !pane.hidden && !!text;
      note.hidden = !shown;
      if (shown && note.textContent !== text) note.textContent = text;
      note.classList.toggle('zen-review-comment-more', shown && note.scrollHeight > note.clientHeight + 1);
      return shown;
    },
    // The site's own count for this node, shown where it would show the comments.
    showConversation() {
      const count = !pane.hidden && conversationAvailable() ? editor?.getAnchoredCommentCount?.(editor.getCurrent()) ?? 0 : 0;
      conversation.hidden = !count;
      if (count) conversation.textContent = `${count} player comment${count === 1 ? '' : 's'}`;
      return !!count;
    },
    arrow(key) {
      // A loading or unavailable Review direction never becomes problem Next.
      if (pending) return;
      ({ ArrowLeft: back, ArrowRight: forward, ArrowUp: up, ArrowDown: down })[key]?.click();
    },
    sync(currentEditor, zenOn) {
      if (currentEditor !== editor) { finishPending(); restoreTree(); editor = currentEditor; }
      const inReview = reviewing(), native = nativeReview();
      watchNative(native);
      const canReview = !!native && (reviewAllowed() || inReview);
      row.hidden = !inReview;
      review.hidden = !canReview;
      review.disabled = !!pending || !canReview;
      if (!pending) {
        review.textContent = inReview ? 'Exit review' : 'Review';
        review.setAttribute('aria-label', inReview ? 'Exit review' : 'Review problem');
      }
      review.setAttribute('aria-pressed', String(inReview));
      const current = editor?.getCurrent?.();
      back.disabled = !!pending || !inReview || !current?.parent || !enabled(moveControl('Previous node'));
      forward.disabled = !!pending || !inReview || !current ||
        !(current.children?.length || current.virtualChildren?.length) || !enabled(moveControl('Next node'));
      up.disabled = down.disabled = !!pending || !inReview || typeof editor?.nextSibling !== 'function' ||
        !(current?.parent?.children?.length > 1);
      root.toggleAttribute('data-zen-review-available', !!(zenOn && canReview));
      root.toggleAttribute('data-zen-review', !!(zenOn && inReview));
      root.toggleAttribute('data-zen-in-review', inReview);
      const game = editor?.getRoot?.(), solver = game?.firstMove ?? game?.children?.find(n => n.move)?.move.color;
      let moved = false;
      if (tree && !marker?.isConnected) restoreTree();
      if (zenOn && inReview) {
        const found = target.querySelector('.besogo-tree');
        if (!tree && found) {
          tree = found; marker = document.createComment('Zen Mode: original game tree');
          tree.before(marker); pane.append(tree); moved = true;
          treeSize.observe(tree);
        }
      } else restoreTree();
      pane.hidden = !(zenOn && inReview && tree);
      if (!zenOn) {
        finishPending(); clearColors();
        highlighted?.classList.remove('zen-current-tree-node'); highlighted = undefined;
        return;
      }
      const treeSVG = (tree || target.querySelector('.besogo-tree'))?.querySelector('svg');
      // The native tree has no mark for a problem comment. A root icon is a bare
      // circle, so the mark sits beside the icon rather than inside it.
      const markComment = (node, icon) => {
        if (!node.comment?.trim() || commentMarks.get(icon)?.isConnected) return;
        const stone = icon.matches('circle') ? icon : icon.querySelector('circle');
        if (!stone) return;
        const radius = Number(stone.getAttribute('r')), mark = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        mark.classList.add('zen-comment-mark');
        mark.setAttribute('cx', Number(stone.getAttribute('cx')) + radius * .72);
        mark.setAttribute('cy', Number(stone.getAttribute('cy')) + radius * .72);
        mark.setAttribute('r', 15);
        icon.after(mark); commentMarks.set(icon, mark);
      };
      const colorIcon = node => {
        for (const hit of [node?.navTreeMarker, node?.navTreeIcon]) {
          if (hit) treeNodes.set(hit, node);
        }
        if (node?.navTreeIcon) {
          const color = replyColor(node, solver), icon = node.navTreeIcon;
          icon.classList.toggle('zen-opponent-node', !!color);
          if (color) { icon.dataset.zenReply = color; opponentIcons.add(icon); }
          else { delete icon.dataset.zenReply; opponentIcons.delete(icon); }
          markComment(node, icon);
        }
      };
      if (!inReview) clearColors();
      else if (treeSVG !== coloredTree || coloredSolver !== solver) {
        clearColors(); coloredTree = treeSVG; coloredSolver = solver;
        const nodes = [game], seen = new Set();
        while (nodes.length && seen.size < 2000) {
          const node = nodes.pop(); if (!node || seen.has(node)) continue;
          seen.add(node); colorIcon(node); nodes.push(...(node.children || []));
        }
      } else colorIcon(current); // Native stone edits may replace this icon only.
      for (const dot of replyMarkers) delete dot.dataset.zenReply;
      replyMarkers.clear();
      if (inReview) {
        const grid = target.querySelector('.besogo-board svg rect.besogo-svg-lines');
        const step = grid && Number(grid.getAttribute('width')) / (game.getSize().x - 1);
        const branches = [...(current?.children || []), ...(current?.virtualChildren || [])];
        // Native markers list direct children then virtual redirects. Verify
        // their coordinates too; extra hover/diff markers keep native styling.
        target.querySelectorAll('#nextMoveGroup > circle').forEach((dot, i) => {
          const branch = branches[i], move = branch?.move, color = replyColor(branch, solver);
          if (!color || !step || dot.getAttribute('fill') === 'blue' || Number(dot.getAttribute('r')) === 0) return;
          if (Math.abs(Number(dot.getAttribute('cx')) - Number(grid.getAttribute('x')) - (move.x - 1) * step) > .01 ||
              Math.abs(Number(dot.getAttribute('cy')) - Number(grid.getAttribute('y')) - (move.y - 1) * step) > .01) return;
          dot.dataset.zenReply = color; replyMarkers.add(dot);
        });
      }
      const selected = inReview ? current?.navTreeMarker : undefined;
      if (selected !== highlighted || moved) {
        highlighted?.classList.remove('zen-current-tree-node');
        highlighted = selected;
        highlighted?.classList.add('zen-current-tree-node');
        revealCurrent();
      }
    },
    destroy() {
      nativeState.disconnect(); finishPending(); clearColors();
      restoreTree(); review.remove(); row.remove(); pane.remove(); notice.remove();
      toolbar.removeEventListener('click', cancelOnReset, true); target.removeEventListener('click', cancelOnReset, true);
      window.removeEventListener('pagehide', cancelOnLeave);
      highlighted?.classList.remove('zen-current-tree-node');
      root.removeAttribute('data-zen-review');
      root.removeAttribute('data-zen-review-available');
      root.removeAttribute('data-zen-in-review');
    }
  };
}
