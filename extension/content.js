(() => {
  'use strict';
  const demo = ['authored', 'local-selection'].includes(document.documentElement?.dataset.zenDemo);
  const isPuzzlePath = path => /^\/(?:\d+|tsumegos\/play\/\d+|mistake-training(?:\/play\/\d+)?)\/?$/.test(path);
  if (!demo && (location.hostname !== 'tsumego.com' || !isPuzzlePath(location.pathname))) return;
  const trainingRoute = !demo && location.pathname.startsWith('/mistake-training');
  // Saved Zen mode preferences. Each lives in dataset[key], in extension storage under key,
  // and changes through the zen:key event. name is an older short form, kept so saved
  // demo values still load. Those
  // with resets go back to initial if nothing valid is saved. Those with carried cross
  // the handoff, because the next page paints before storage answers.
  const PREFERENCES = [
    { key: 'zenMode', values: ['on', 'off'], initial: 'on' },
    { key: 'zenTheme', name: 'theme', values: ['site', 'plain'], initial: 'site', resets: true, carried: true },
    { key: 'zenSurround', name: 'surround', values: ['auto', 'woven', 'natural', 'solid'], initial: 'auto', resets: true, carried: true },
    { key: 'zenMotion', name: 'motion', values: ['on', 'off'], initial: 'on', carried: true },
    { key: 'zenMargin', values: ['on', 'off'], initial: 'on', carried: true },
    { key: 'zenBar', values: ['glass', 'solid'], initial: 'glass', carried: true },
    { key: 'zenEdgeFade', values: ['mat', 'glass'], initial: 'mat', carried: true },
    // Paper tint of the glass bar, in percent, 22 to 64.
    // 22% is the least tint at which the bar's text keeps WCAG AA over wood and mat; a lower
    // saved value is raised to it.
    { key: 'zenBarTint', values: Array.from({ length: 43 }, (_, i) => String(i + 22)), initial: '50', carried: true, floor: '22' },
    { key: 'zenRandomTurn', values: ['off', 'on'], initial: 'off', carried: true },
    { key: 'zenView', values: ['frame', 'full'], initial: 'frame', carried: true },
    { key: 'zenShowTaps', values: ['off', 'on'], initial: 'off', carried: true },
    { key: 'zenCoordinates', name: 'coordinates', values: ['on', 'off'] },
    { key: 'zenReach', name: 'reach', values: ['on', 'off'] }
  ];
  // The standalone demo uses a normal module tag. It must not depend on an
  // extension runtime exposed by another browser add-on or dynamic injection.
  const runtime = demo ? undefined : globalThis.browser?.runtime || globalThis.chrome?.runtime;
  function start() {
    // The training entry URL also renders its overview when nothing is due.
    // Do not restyle or hide that page while waiting for a board that won't exist.
    if (!document.documentElement || (trainingRoute && !document.querySelector('#target'))) return false;
    document.documentElement.dataset.zen = 'on';
    for (const { key, initial } of PREFERENCES) if (initial) document.documentElement.dataset[key] = initial;
    // Content-script CSS resolves relative URLs against the page in some
    // browsers. Keep the texture inside the installed extension's resources.
    if (runtime) document.documentElement.style.setProperty('--zen-tatami-image', `url("${runtime.getURL('tatami.png')}")`);
    // Shown at the foot of the menu, so anyone can tell which version is running.
    try { if (runtime) document.documentElement.dataset.zenVersion = runtime.getManifest().version; } catch {}
    // Opt in only solving pages in Zen mode; regular/non-target pages retain
    // their native navigation presentation. No global stylesheet opt-in.
    const navigationStyle = document.createElement('style');
    navigationStyle.textContent = '@view-transition { navigation: auto; }';
    const syncZen = () => {
      const on = document.documentElement.dataset.zenMode !== 'off';
      document.documentElement.dataset.zen = on ? 'on' : 'off';
      if (on && !navigationStyle.isConnected) document.documentElement.append(navigationStyle);
      if (!on) navigationStyle.remove();
    };
    // iOS Safari draws page content, but not full-width fixed layers, behind its status bar
    // and its toolbar, and settles how to fill those areas as the page first paints. So from
    // the start, two strips of page content sit above and below the viewport (bridge.mjs
    // continues the mat and the whole board in them), the page stays scrolled by their size,
    // and zen.css makes the full-width layers absolute instead of fixed. The frost over the
    // bottom strip is its own layer, so it also covers the board moving across a Next.
    // Safari fades whatever is under its bars toward the page's background colour, so that
    // colour is the scene's own (bridge.mjs), kept across Next so the fade does not change.
    const EDGE = 240, TINT = 'zen-edge-tint';
    const device = globalThis.navigator;
    const edgesWanted = !demo && !!device && (/iP(hone|ad|od)/.test(device.platform) || (device.platform === 'MacIntel' && device.maxTouchPoints > 1));
    const pinEdges = () => {
      const scroller = document.scrollingElement;
      if (document.documentElement.hasAttribute('data-zen-edges') && scroller && scroller.scrollTop !== EDGE) scroller.scrollTop = EDGE;
    };
    const syncEdges = () => {
      if (!edgesWanted) return;
      const root = document.documentElement, on = root.dataset.zen === 'on';
      let edges = root.querySelector(':scope > .zen-edges');
      if (on && !edges) {
        edges = document.createElement('div'); edges.className = 'zen-edges'; edges.setAttribute('aria-hidden', 'true');
        for (const side of ['top', 'bottom']) {
          const strip = document.createElement('div'), scene = document.createElement('div'), piece = document.createElement('div');
          strip.className = `zen-edge-${side}`; scene.className = 'zen-edge-scene'; piece.className = 'zen-edge-board';
          scene.append(piece); strip.append(scene); edges.append(strip);
        }
        const frost = document.createElement('div'); frost.className = 'zen-edge-frost'; edges.append(frost);
        let tint = null;
        try { tint = sessionStorage.getItem(TINT); } catch {}
        if (tint && /^#[0-9a-f]{6}$/.test(tint)) root.style.setProperty('--zen-edge-tint', tint);
        root.append(edges); root.style.setProperty('--zen-edge', `${EDGE}px`); root.dataset.zenEdges = 'on'; pinEdges();
      } else if (!on && edges) {
        edges.remove(); delete root.dataset.zenEdges; root.style.removeProperty('--zen-edge-tint');
        if (document.scrollingElement) document.scrollingElement.scrollTop = 0;
      }
    };
    if (edgesWanted) {
      new MutationObserver(syncEdges).observe(document.documentElement, { attributes: true, attributeFilter: ['data-zen'] });
      for (const type of ['scroll', 'resize', 'load', 'pageshow']) addEventListener(type, pinEdges, { passive: true });
      document.addEventListener('DOMContentLoaded', pinEdges);
    }
    syncZen();
    syncEdges();
    // The bar's tint is a number the CSS needs as a variable, from the first paint onward.
    const syncBarTint = () => {
      const root = document.documentElement, tint = Number(root.dataset.zenBarTint);
      if (Number.isInteger(tint) && tint >= 22 && tint <= 64) root.style.setProperty('--zen-bar-tint', String(tint / 100));
    };
    new MutationObserver(syncBarTint).observe(document.documentElement, { attributes: true, attributeFilter: ['data-zen-bar-tint'] });
    syncBarTint();
    document.addEventListener('zen:preferences', syncZen);
    document.addEventListener('zen:zenMode', syncZen);
    document.addEventListener('zen:disabled', () => navigationStyle.remove());
    const handoff = globalThis.ZenModeHandoff?.create({ isPuzzlePath, preferences: PREFERENCES.filter(preference => preference.carried) });
    // The page can create its SVG before the extension module finishes loading.
    // The first adapter update can precede saved preferences and the engine's
    // final layout pass. Keep only the SVG covered until its rendered geometry
    // settles; never hold an error or the rest of the page behind this gate.
    document.documentElement.dataset.zenPreparing = 'on';
    let prepareTimer, paintFrame, previousSVG, previousGeometry, stableFrames = 0;
    let prepared = false, preferencesReady = !runtime;
    // Start this before waiting for an SVG: the site or adapter can stall
    // before creating one. Also check on resume, when timers may have paused.
    // A slow page is not a failed one: while the site is still loading, keep waiting, up
    // to a limit for a page that never finishes. Patience runs out only once it has.
    const STARTUP_PATIENCE = 10000, STARTUP_LIMIT = 60000, startupBegan = Date.now();
    let startupDeadline = startupBegan + STARTUP_PATIENCE, startupTimer;
    const armStartup = delay => { clearTimeout(startupTimer); startupTimer = setTimeout(checkDeadline, delay); };
    function checkDeadline() {
      if (Date.now() < startupDeadline) return;
      if (document.readyState === 'complete' || Date.now() - startupBegan >= STARTUP_LIMIT) failStartup();
      else armStartup(1000);
    }
    const siteLoaded = () => { startupDeadline = Date.now() + STARTUP_PATIENCE; armStartup(STARTUP_PATIENCE); };
    armStartup(STARTUP_PATIENCE);
    addEventListener('load', siteLoaded);
    const markPrepared = () => {
      if (!document.querySelector('#target .besogo-board > svg')) return;
      prepared = true;
      stopStartupWatch();
    };
    function stopStartupWatch() {
      clearTimeout(startupTimer);
      document.removeEventListener('zen:prepared', markPrepared);
      document.removeEventListener('visibilitychange', checkDeadline);
      removeEventListener('pageshow', checkDeadline);
      removeEventListener('load', siteLoaded);
    }
    function failStartup() {
      stopStartupWatch();
      revealBoard();
      if (document.documentElement.dataset.zen !== 'on') return;
      // Let an already-running adapter restore relocated native controls.
      document.dispatchEvent(new Event('zen:startup-failed'));
      document.documentElement.removeAttribute('data-zen');
      if (document.body) {
        const notice = document.createElement('p');
        notice.className = 'zen-startup-error';
        notice.setAttribute('role', 'status');
        notice.textContent = 'Zen Mode could not finish starting. Site view restored; reload to try again.';
        document.body.prepend(notice);
      }
    }
    document.addEventListener('visibilitychange', checkDeadline);
    addEventListener('pageshow', checkDeadline);
    function checkFrame() {
      const svg = document.querySelector('#target .besogo-board > svg');
      if (prepared && preferencesReady && document.readyState !== 'loading' && svg) {
        // Include stones, not just the viewBox: an engine can finish placing
        // its children on a later frame without changing the outer board.
        const geometry = JSON.stringify([svg.getAttribute('viewBox'),
          ...[svg, ...svg.querySelectorAll('image, circle')].map(element => {
            const r = element.getBoundingClientRect();
            return [r.x, r.y, r.width, r.height];
          })]);
        stableFrames = svg === previousSVG && geometry === previousGeometry ? stableFrames + 1 : 0;
        previousSVG = svg;
        previousGeometry = geometry;
        if (stableFrames >= 2) { revealBoard(); return; }
      }
      paintFrame = requestAnimationFrame(checkFrame);
    }
    const preparing = new MutationObserver(watchForBoard);
    function watchForBoard() {
      if (!document.querySelector('#target .besogo-board > svg')) return;
      preparing.disconnect();
      prepareTimer = setTimeout(revealBoard, 1000); // Bounded, even if the adapter fails.
      paintFrame = requestAnimationFrame(checkFrame);
    }
    function revealBoard() {
      clearTimeout(prepareTimer);
      cancelAnimationFrame(paintFrame);
      preparing.disconnect();
      document.documentElement.removeAttribute('data-zen-preparing');
      handoff?.ready();
    }
    preparing.observe(document, { childList: true, subtree: true });
    watchForBoard();
    document.addEventListener('zen:prepared', markPrepared);
    const apply = (preference, value) => {
      if (preference.floor && /^\d+$/.test(value ?? '') && Number(value) < Number(preference.floor)) value = preference.floor;
      if (preference.values.includes(value)) document.documentElement.dataset[preference.key] = value;
      else if (preference.resets) document.documentElement.dataset[preference.key] = preference.initial;
    };
    const onChange = (preference, save) => document.addEventListener(`zen:${preference.key}`, event => {
      if (preference.values.includes(event.detail)) save(event.detail);
    });
    if (runtime) {
      const storage = (globalThis.browser || globalThis.chrome).storage.local;
      storage.get(PREFERENCES.map(preference => preference.key)).then(saved => {
        for (const preference of PREFERENCES) apply(preference, saved[preference.key]);
        document.dispatchEvent(new Event('zen:preferences'));
      }).catch(() => {}).finally(() => { preferencesReady = true; });
      for (const preference of PREFERENCES)
        onChange(preference, value => { storage.set({ [preference.key]: value }).catch(() => {}); });
    } else {
      for (const preference of PREFERENCES) {
        const demoKey = `zen-demo-${preference.name ?? preference.key}`;
        try { apply(preference, localStorage.getItem(demoKey)); } catch {}
        onChange(preference, value => { try { localStorage.setItem(demoKey, value); } catch {} });
      }
    }
    if (!demo) {
      const script = document.createElement('script');
      script.type = 'module';
      script.src = runtime.getURL('bridge.mjs');
      script.onload = () => script.remove();
      script.onerror = () => {
        failStartup();
        script.remove();
      };
      document.documentElement.append(script);
    }
    return true;
  }
  if (!start()) {
    const observer = new MutationObserver(() => { if (start()) observer.disconnect(); });
    observer.observe(document, { childList: true });
    // #target can be parsed inside an existing body on the training route.
    if (trainingRoute) observer.observe(document, { childList: true, subtree: true });
    document.addEventListener('DOMContentLoaded', () => observer.disconnect(), { once: true });
  }
  // Native transitions are short and never wait for the board, so a late board or a
  // site error stays visible. The handoff cover in transition.js has its own time limit.
  addEventListener('pagereveal', event => {
    event.viewTransition?.ready.catch(() => {}); // A skipped/unsupported snapshot is normal.
  });
  addEventListener('pageshow', () => {
    if (!document.querySelector('#target')) document.documentElement.removeAttribute('data-zen');
  });
})();
