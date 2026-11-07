// Single-use presentation handoff: board geometry and currently visible stones,
// never solution trees or HTML. Native navigation and the engine stay in charge.
(() => {
  const KEY = 'zen-mode-handoff-v1', LIMIT = 1500, DURATION = 360, OUT = 160, HOLD = 50, IN = 200;
  const SURFACE_FALLBACK = '#e6c38b';   // Also in zen.css and bridge.mjs.
  const namespace = 'http://www.w3.org/2000/svg';
  function buildOrder(pieces) {
    const shuffled = [...pieces];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const colorOf = stone => {
      if (stone[6]) {
        const name = stone[6].split('/').pop().split(/[?#]/)[0].toLowerCase();
        const black = name.includes('black'), white = name.includes('white');
        return black !== white ? (black ? 0 : 1) : -1;
      }
      const rgb = stone[3].match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
      return rgb ? (Number(rgb[1]) + Number(rgb[2]) + Number(rgb[3]) < 384 ? 0 : 1) : -1;
    };
    const colors = shuffled.map(colorOf);
    // Unknown custom image themes still get a random build. Do not guess their
    // colors from the SVG image element's unrelated fallback fill.
    if (colors.includes(-1)) return shuffled;
    const groups = [shuffled.filter((_, i) => colors[i] === 0), shuffled.filter((_, i) => colors[i] === 1)];
    const result = [];
    let color = Math.random() < .5 ? 0 : 1;
    while (groups[0].length || groups[1].length) {
      if (!groups[color].length) color = 1 - color;
      result.push(groups[color].pop()); color = 1 - color;
    }
    return result;
  }
  function validCoordinates(labels, size) {
    return Array.isArray(labels) && labels.length <= 2 * (size[0] + size[1]) && labels.every(label =>
      label && ['x', 'y', 'size', 'dy'].every(key => Number.isFinite(label[key])) &&
      label.x >= -10 && label.x <= size[0] + 9 && label.y >= -10 && label.y <= size[1] + 9 &&
      (((label.y <= -.5 || label.y >= size[1] - .5) && label.x >= 0 && label.x <= size[0] - 1) ||
       ((label.x <= -.5 || label.x >= size[0] - .5) && label.y >= -.25 && label.y <= size[1] - .75)) &&
      label.size > 0 && label.size <= 2 && Math.abs(label.dy) <= 2 &&
      ['text', 'fill', 'font', 'weight', 'anchor'].every(key => typeof label[key] === 'string') &&
      label.text.length > 0 && label.text.length <= 8 && label.fill.length <= 80 &&
      label.font.length <= 120 && /^(normal|bold|[1-9]00)$/.test(label.weight) &&
      ['start', 'middle', 'end'].includes(label.anchor));
  }
  function validShadows(shadows, stones) {
    return shadows && Number.isFinite(shadows.blur) && shadows.blur > 0 && shadows.blur < .15 &&
      Array.isArray(stones) && Array.isArray(shadows.pieces) && shadows.pieces.length <= stones.length * 2 &&
      shadows.pieces.every(s => Array.isArray(s) && s.length === 7 &&
        stones.some(p => p[0] === s[0] && p[1] === s[1]) &&
        [s[2], s[3]].every(n => Number.isFinite(n) && Math.abs(n) < .15) &&
        Number.isFinite(s[4]) && s[4] >= .3 && s[4] <= .6 &&
        typeof s[5] === 'string' && s[5].length < 80 &&
        Number.isFinite(s[6]) && s[6] >= 0 && s[6] <= 1);
  }
  function valid(frame) {
    return frame && ['clip', 'surface', 'grid', 'size', 'viewport'].every(key =>
      Array.isArray(frame[key]) && frame[key].length === ({ clip: 4, surface: 4, grid: 3, size: 2, viewport: 2 })[key] &&
      frame[key].every(n => Number.isFinite(n) && Math.abs(n) < 20000)) &&
      frame.size.every(n => Number.isInteger(n) && n >= 2 && n <= 25) &&
      frame.grid[2] > 0 && frame.clip[2] > 0 && frame.clip[3] > 0 && frame.surface[2] > 0 && frame.surface[3] > 0 &&
      Number.isFinite(frame.lineWidth) && frame.lineWidth > 0 && frame.lineWidth < 20 &&
      (frame.inset === undefined || (Array.isArray(frame.inset) && frame.inset.length === 2 &&
        frame.inset.every(n => Number.isFinite(n) && n >= .5 && n < 10))) &&
      (frame.coordinates === undefined || validCoordinates(frame.coordinates, frame.size)) &&
      (frame.shadows === undefined || validShadows(frame.shadows, frame.stones)) &&
      boardBounds(frame).every(n => Number.isFinite(n) && Math.abs(n) < 20000) &&
      (frame.stones === undefined || (Array.isArray(frame.stones) && frame.stones.length <= frame.size[0] * frame.size[1] &&
        frame.stones.every(s => Array.isArray(s) && s.length === 7 &&
          s.slice(0, 2).every((n, i) => Number.isInteger(n) && n >= 0 && n < frame.size[i]) &&
          Number.isFinite(s[2]) && s[2] >= .3 && s[2] <= .6 &&
          [s[3], s[4], s[6]].every(v => typeof v === 'string' && v.length < 600) &&
          Number.isFinite(s[5]) && s[5] >= 0 && s[5] < .2))) &&
      (frame.stars === undefined || (Array.isArray(frame.stars) && frame.stars.length <= 25 &&
        frame.stars.every(point => Array.isArray(point) && point.length === 2 &&
          point.every((n, i) => Number.isInteger(n) && n >= 0 && n < frame.size[i])) &&
        Number.isFinite(frame.starRadius) && frame.starRadius > 0 && frame.starRadius < 20));
  }
  function safeImage(value) {
    if (typeof value !== 'string' || !value) return '';
    try { const url = new URL(value, location.href); return url.origin === location.origin &&
      ['http:', 'https:'].includes(url.protocol) && /\.(png|jpe?g|webp|avif|gif)$/i.test(url.pathname) ? url.href : ''; }
    catch { return ''; }
  }
  // The camera crop is not a physical board edge. Paint the complete finite
  // board beneath the viewport clip, including while the camera interpolates.
  function boardBounds(frame) {
    const [gx, gy, step] = frame.grid, [nx, ny] = frame.size;
    const [ix, iy] = frame.inset || [.5, .5];
    return [gx - ix * step, gy - iy * step,
      (nx - 1 + 2 * ix) * step, (ny - 1 + 2 * iy) * step];
  }
  // The bar as painted: visible elements, their zen- classes, text, and the few
  // attributes the stylesheet reads. A browser reload gets no cross-document
  // snapshot, unlike Next, so this copy covers the bar until the live one is ready.
  const BAR_TAGS = new Set(['section', 'div', 'span', 'strong', 'button', 'details', 'summary', 'svg', 'path', 'circle', 'rect', 'g', 'line']);
  const BAR_ATTRIBUTES = new Set(['type', 'aria-pressed', 'aria-busy', 'aria-expanded', 'aria-disabled', 'disabled', 'data-turn',
    'viewBox', 'd', 'cx', 'cy', 'r', 'x', 'y', 'width', 'height', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin',
    'x1', 'y1', 'x2', 'y2', 'transform', 'aria-hidden', 'focusable']);
  const BAR_STYLE = ['font-family', 'font-size', 'font-weight', 'line-height', 'color', 'letter-spacing'];
  function captureBar() {
    const bar = document.querySelector('.zen-toolbar:not(.zen-bar-copy)');
    let count = 0;
    const walk = element => {
      const style = getComputedStyle(element);
      if (++count > 300 || !BAR_TAGS.has(element.localName) || element.hidden || style.display === 'none') return null;
      const node = [element.localName, [...element.classList].filter(name => /^zen-[a-z-]+$/.test(name)).join(' '),
        Object.fromEntries([...element.attributes].filter(a => BAR_ATTRIBUTES.has(a.name)).map(a => [a.name, a.value.slice(0, 2000)])), []];
      for (const child of element.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) node[3].push(child.data.slice(0, 300));
        else if (child.nodeType === Node.ELEMENT_NODE && (element.localName !== 'details' || element.open || child.localName === 'summary')) {
          const copy = walk(child); if (copy) node[3].push(copy);
        }
      }
      return node;
    };
    const tree = bar && walk(bar);
    return tree && count <= 300 ? { tree, style: BAR_STYLE.map(name => getComputedStyle(bar).getPropertyValue(name).slice(0, 300)) } : undefined;
  }
  // Built only with createElement and textContent, from the allowed tags and attributes.
  function buildBar(bar) {
    let count = 0;
    const make = (node, svg) => {
      if (typeof node === 'string') return document.createTextNode(node.slice(0, 300));
      const [tag, classes, attributes, children] = Array.isArray(node) ? node : [];
      if (++count > 300 || !BAR_TAGS.has(tag) || typeof classes !== 'string' || !/^(zen-[a-z-]+( |$))*$/.test(classes) ||
          !attributes || typeof attributes !== 'object' || !Array.isArray(children)) throw Error('Unrecognized bar');
      const inSvg = svg || tag === 'svg', element = inSvg ? document.createElementNS(namespace, tag) : document.createElement(tag);
      if (classes) element.setAttribute('class', classes);
      for (const [name, value] of Object.entries(attributes)) if (BAR_ATTRIBUTES.has(name) && typeof value === 'string') element.setAttribute(name, value);
      for (const child of children) element.append(make(child, inSvg));
      return element;
    };
    try {
      if (!bar || bar.tree?.[0] !== 'section' || !/(^| )zen-toolbar( |$)/.test(bar.tree[1]) || !Array.isArray(bar.style) || bar.style.length !== BAR_STYLE.length) return null;
      const copy = make(bar.tree);
      copy.classList.add('zen-bar-copy'); copy.setAttribute('aria-hidden', 'true'); copy.inert = true;
      BAR_STYLE.forEach((name, i) => { if (typeof bar.style[i] === 'string' && !/url\(|expression/i.test(bar.style[i])) copy.style.setProperty(name, bar.style[i]); });
      return copy;
    } catch { return null; }
  }
  function capture() {
    const board = document.querySelector('#target .besogo-board[data-zen-fit="on"]');
    const svg = board?.querySelector('svg'), outline = svg?.querySelector('rect.besogo-svg-lines');
    // data-zen-fit is set only after the adapter validates the complete hit
    // grid. Read its cell spacing for either supported native presentation.
    const cell = svg?.querySelector('rect[opacity="0"], rect[fill="transparent"]'), matrix = svg?.getScreenCTM();
    if (!outline || !cell || !matrix || matrix.b || matrix.c || matrix.a <= 0 || Math.abs(matrix.a - matrix.d) > .001) return null;
    const step = Number(cell.getAttribute('width')), c = board.getBoundingClientRect(), s = svg.getBoundingClientRect();
    const style = getComputedStyle(svg), line = getComputedStyle(outline);
    // Wood is the last background layer, below the rim shading.
    const image = style.backgroundImage.match(/(?:^|, )url\(["']?([^"')]*)["']?\)$/)?.[1];
    const frame = {
      clip: [c.x, c.y, c.width, c.height], surface: [s.x - c.x, s.y - c.y, s.width, s.height],
      grid: [Number(outline.getAttribute('x')) * matrix.a + matrix.e - c.x,
        Number(outline.getAttribute('y')) * matrix.d + matrix.f - c.y, step * matrix.a],
      size: [Number(outline.getAttribute('width')) / step + 1, Number(outline.getAttribute('height')) / step + 1],
      inset: [Number(outline.getAttribute('x')) / step, Number(outline.getAttribute('y')) / step],
      viewport: [innerWidth, innerHeight], color: style.backgroundColor, image: safeImage(image || ''),
      lineColor: line.stroke, lineWidth: parseFloat(line.strokeWidth) * matrix.a
    };
    // The native engine puts coordinate text directly in the SVG gutters.
    // Copy only that bounded plain text, not nested markup, hints or tree labels.
    frame.coordinates = [...svg.children].filter(el => el.tagName.toLowerCase() === 'text' &&
      !el.children.length && el.x.baseVal.numberOfItems === 1 && el.y.baseVal.numberOfItems === 1 &&
      el.dy.baseVal.numberOfItems <= 1 && !el.hasAttribute('transform')).flatMap(el => {
      const style = getComputedStyle(el), x = (el.x.baseVal[0].value - Number(outline.getAttribute('x'))) / step,
        y = (el.y.baseVal[0].value - Number(outline.getAttribute('y'))) / step;
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return [];
      const label = { x, y, text: el.textContent, size: parseFloat(style.fontSize) / step,
        dy: (el.dy.baseVal[0]?.value || 0) / step, fill: style.fill, font: style.fontFamily,
        weight: style.fontWeight, anchor: style.textAnchor };
      return validCoordinates([label], frame.size) ? [label] : [];
    });
    // Only numeric, standard grid decoration crosses the navigation boundary.
    // Never serialize the SVG's stone, markup or hit-target layers.
    const hoshi = svg.querySelector('path.besogo-svg-hoshi'), dots = hoshi?.getAttribute('d');
    if (dots && /^(M[\d.]+,[\d.]+l0,0)+$/i.test(dots)) {
      frame.stars = [...dots.matchAll(/M([\d.]+),([\d.]+)l0,0/gi)].map(match =>
        [(Number(match[1]) - Number(outline.getAttribute('x'))) / step,
          (Number(match[2]) - Number(outline.getAttribute('y'))) / step]);
      frame.starRadius = parseFloat(getComputedStyle(hoshi).strokeWidth) * matrix.a / 2;
    }
    // The native stone layer immediately precedes its named markup layer.
    // Read only its actual circles/images, never hover previews, hints or tree.
    const group = svg.querySelector('#markupGroup')?.previousElementSibling;
    const pieces = group?.tagName.toLowerCase() === 'g' ? [...group.children] : [...svg.querySelectorAll('.zen-demo-stone')];
    frame.stones = pieces.flatMap(piece => {
      const image = piece.tagName.toLowerCase() === 'image', circle = piece.tagName.toLowerCase() === 'circle';
      if (!image && !circle) return [];
      const n = key => Number(piece.getAttribute(key)), style = getComputedStyle(piece);
      const radius = image ? n('width') / 2 : n('r');
      const x = image ? n('x') + radius : n('cx'), y = image ? n('y') + radius : n('cy');
      const ix = (x - Number(outline.getAttribute('x'))) / step, iy = (y - Number(outline.getAttribute('y'))) / step;
      const px = x * matrix.a + matrix.e, py = y * matrix.d + matrix.f, r = radius * matrix.a;
      if (!Number.isInteger(ix) || !Number.isInteger(iy) || radius / step < .3 || radius / step > .6 ||
          style.visibility === 'hidden' || style.display === 'none' ||
          px + r < c.left || px - r > c.right || py + r < c.top || py - r > c.bottom) return [];
      const url = image ? safeImage(piece.getAttribute('href') || piece.getAttributeNS('http://www.w3.org/1999/xlink', 'href')) : '';
      if (image && !url) return [];
      return [[ix, iy, radius / step, style.fill, style.stroke, (parseFloat(style.strokeWidth) || 0) / step, url]];
    });
    // Native shadows are separate from the stone images. Carry only the
    // recognized circle/Gaussian-blur presentation, tied to visible stones.
    const shadowGroup = pieces.find(p => p.tagName.toLowerCase() === 'g');
    if (shadowGroup) {
      const filter = shadowGroup.querySelector(':scope > filter'), blur = filter?.firstElementChild;
      if (!filter?.id || filter.attributes.length !== 1 || filter.children.length !== 1 ||
          blur?.tagName !== 'feGaussianBlur' || blur.getAttribute('in') !== 'SourceGraphic' ||
          shadowGroup.hasAttribute('transform') || getComputedStyle(shadowGroup).opacity !== '1') return null;
      const shadows = [];
      for (const shadow of shadowGroup.children) {
        if (shadow === filter) continue;
        if (shadow.tagName !== 'circle' || shadow.getAttribute('filter') !== `url(#${filter.id})` ||
            shadow.hasAttribute('transform') || getComputedStyle(shadow).stroke !== 'none') return null;
        const x = (Number(shadow.getAttribute('cx')) - Number(outline.getAttribute('x'))) / step,
          y = (Number(shadow.getAttribute('cy')) - Number(outline.getAttribute('y'))) / step;
        const ix = Math.round(x), iy = Math.round(y), style = getComputedStyle(shadow);
        if (!frame.stones.some(p => p[0] === ix && p[1] === iy) ||
            style.display === 'none' || style.visibility === 'hidden') continue;
        shadows.push([ix, iy, x - ix, y - iy, Number(shadow.getAttribute('r')) / step, style.fill, Number(style.opacity)]);
      }
      frame.shadows = { blur: Number(blur.getAttribute('stdDeviation')) / step, pieces: shadows };
    }
    return valid(frame) ? frame : null;
  }
  function create({ isPuzzlePath, preferences }) {
    const root = document.documentElement, demo = !!root.dataset.zenDemo;
    let layer, surface, texture, path, outline, stars, stones, stoneData, stoneStep, previous, timer, animation, observer, departing = false, running = false;
    let coordinateLayers = [], shadows, shadowBlur;
    let snapshot, snapshotReady = Promise.resolve(), barCopy;
    // The live bar takes over in the same frame as the board's reveal.
    function releaseBar() { barCopy?.remove(); barCopy = null; delete root.dataset.zenBarCopy; }
    const allowed = value => {
      try { const url = new URL(value, location.href); return url.origin === location.origin && (demo
        ? /\/harness\/(real|puzzle)\.html$/.test(url.pathname)
        : isPuzzlePath(url.pathname)); }
      catch { return false; }
    };
    function clear() {
      clearTimeout(timer); cancelAnimationFrame(animation); observer?.disconnect();
      snapshot?.skipTransition(); snapshot = null; snapshotReady = Promise.resolve();
      layer?.remove(); layer = null; coordinateLayers = []; running = departing = false; releaseBar();
      delete root.dataset.zenHandoff;
      delete root.dataset.zenDeparting;
    }
    function coverDocumentSwap(transition) {
      if (!transition) return;
      snapshot = transition;
      const currentLayer = layer;
      // The old browser snapshot covers the document swap. Decode the cover's
      // textures here; ready() releases it only after the incoming board and
      // its own textures are ready too.
      const urls = new Set([safeImage(previous.image), ...(previous.stones || []).map(s => safeImage(s[6])), ...[...getComputedStyle(layer).backgroundImage.matchAll(/url\(["']?(.*?)["']?\)/g)].map(m => m[1])].filter(Boolean));
      snapshotReady = (async () => {
        try {
          await Promise.all([transition.ready, ...[...urls].map(async url => {
            const picture = new Image(); picture.src = url; await picture.decode();
          })]);
          // ready() owns release. Textures alone being decoded does not mean
          // the incoming board, layout and glass backdrop are ready to reveal.
        } catch {
          // No snapshot (skipped, unsupported or an image failed): the cover goes and the
          // page shows as it is.
          if (layer === currentLayer) clear();
        }
      })();
    }
    const color = value => typeof value === 'string' && CSS.supports('color', value) ? value : SURFACE_FALLBACK;
    function material(element, frame) {
      element.style.backgroundColor = ['transparent', 'rgba(0, 0, 0, 0)'].includes(frame.color) ? SURFACE_FALLBACK : color(frame.color);
      const image = safeImage(frame.image);
      element.style.backgroundImage = image ? `url(${JSON.stringify(image)})` : 'none';
    }
    function addCoordinates(labels = [], opacity = 1) {
      const group = document.createElementNS(namespace, 'g');
      group.classList.add('zen-handoff-coordinates'); group.setAttribute('opacity', opacity);
      for (const label of labels) {
        const text = document.createElementNS(namespace, 'text'); text.textContent = label.text;
        for (const [name, value] of [['fill', color(label.fill)], ['font-family', label.font],
          ['font-weight', label.weight], ['text-anchor', label.anchor]]) text.setAttribute(name, value);
        group.append(text);
      }
      stones.before(group); coordinateLayers.push({ group, labels });
    }
    // On iOS the cover also spans the page strips behind Safari's status bar and toolbar
    // (content.js), so the board and mat there move with it.
    function place() {
      const lift = root.hasAttribute('data-zen-edges') ? parseFloat(root.style.getPropertyValue('--zen-edge')) || 0 : 0;
      const [, y, , height] = previous.clip;
      Object.assign(layer.style, { top: `${y - lift}px`, height: `${height + 2 * lift}px` });
      return lift;
    }
    function paint(frame) {
      const [x, top, width, height] = boardBounds(frame), [gx, gridTop, step] = frame.grid, [nx, ny] = frame.size;
      const [ix, iy] = frame.inset || [.5, .5], lift = place(), y = top + lift, gy = gridTop + lift;
      Object.assign(surface.style, { left: `${x}px`, top: `${y}px`, width: `${width}px`, height: `${height}px` });
      for (const [key, value] of [['grid-x', gx], ['grid-y', gy], ['grid-step', step],
        ['grid-span', Math.max(nx, ny) * step], ['edge-x', x], ['edge-y', y],
        ['wood-x', gx - x - ix * step], ['wood-y', gy - y - iy * step],
        ['wood-width', (nx - 1 + 2 * ix) * step], ['wood-height', (ny - 1 + 2 * iy) * step],
        ['pan-grid-x', gx], ['pan-grid-y', gy], ['pan-edge-y', y]])
        layer.style.setProperty(`--zen-${key}`, `${value}px`);
      const svg = path.ownerSVGElement;
      svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
      const lines = [];
      // Match the native grid's closed outline and interior paths. Scaling its
      // stroke alongside its cells avoids a thickness jump at motion start.
      for (let j = 1; j < ny - 1; j++) lines.push(`M${gx - x},${gy - y + j * step}h${(nx - 1) * step}`);
      for (let i = 1; i < nx - 1; i++) lines.push(`M${gx - x + i * step},${gy - y}v${(ny - 1) * step}`);
      for (const [key, value] of [['x', gx - x], ['y', gy - y], ['width', (nx - 1) * step], ['height', (ny - 1) * step]])
        outline.setAttribute(key, value);
      path.setAttribute('d', lines.join(''));
      for (const grid of [outline, path]) {
        grid.setAttribute('stroke', color(frame.lineColor)); grid.setAttribute('stroke-width', frame.lineWidth);
      }
      const points = frame.stars || [];
      while (stars.childElementCount > points.length) stars.lastChild.remove();
      while (stars.childElementCount < points.length) stars.append(document.createElementNS(namespace, 'circle'));
      points.forEach(([sx, sy], i) => {
        const dot = stars.children[i];
        dot.setAttribute('cx', gx - x + sx * step); dot.setAttribute('cy', gy - y + sy * step);
        dot.setAttribute('r', frame.starRadius); dot.setAttribute('fill', color(frame.lineColor));
      });
      for (const { group, labels } of coordinateLayers) labels.forEach((label, i) => {
        const text = group.children[i];
        text.setAttribute('x', gx - x + label.x * step); text.setAttribute('y', gy - y + label.y * step);
        text.setAttribute('dy', label.dy * step); text.setAttribute('font-size', label.size * step);
      });
    }
    function setStones(frame, building = false) {
      stones.replaceChildren(); shadows.replaceChildren();
      stoneStep = frame.grid[2];
      shadowBlur.setAttribute('stdDeviation', (frame.shadows?.blur || 0) * stoneStep);
      stoneData = building ? buildOrder(frame.stones || []) : [...(frame.stones || [])].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      for (const [sx, sy, radius, fill, stroke, width, url] of stoneData) {
        const shade = document.createElementNS(namespace, 'g'); shadows.append(shade);
        for (const [, , dx, dy, r, fill, opacity] of frame.shadows?.pieces.filter(s => s[0] === sx && s[1] === sy) || []) {
          const circle = document.createElementNS(namespace, 'circle');
          for (const [key, value] of [['cx', dx * stoneStep], ['cy', dy * stoneStep], ['r', r * stoneStep],
            ['fill', color(fill)], ['opacity', opacity], ['filter', 'url(#zen-handoff-blur)']]) circle.setAttribute(key, value);
          shade.append(circle);
        }
        const piece = document.createElementNS(namespace, safeImage(url) ? 'image' : 'circle');
        const r = radius * frame.grid[2];
        if (safeImage(url)) {
          for (const [key, value] of [['x', -r], ['y', -r], ['width', r * 2], ['height', r * 2], ['href', safeImage(url)]]) piece.setAttribute(key, value);
        } else {
          piece.setAttribute('r', r); piece.setAttribute('fill', color(fill));
          piece.setAttribute('stroke', stroke === 'none' ? 'none' : color(stroke)); piece.setAttribute('stroke-width', width * frame.grid[2]);
        }
        const wrapper = document.createElementNS(namespace, 'g'); wrapper.append(piece); stones.append(wrapper);
      }
      paintStones(frame, 1, false);
    }
    function paintStones(frame, progress, removing) {
      const step = frame.grid[2], count = stoneData.length;
      const [x, y] = boardBounds(frame);
      stoneData.forEach(([sx, sy], index) => {
        const order = removing ? count - index - 1 : index;
        // Each stone gets a short fade, staggered over the entire sweep. The
        // whole action stays quick even on a densely populated full board.
        const local = Math.max(0, Math.min(1, (progress - order / Math.max(1, count - 1) * .65) / .35));
        const opacity = removing ? 1 - local : local;
        const dx = removing ? -.15 * step * local : 0;
        // Stone geometry was created at stoneStep. Follow the moving grid's
        // scale as well as its origin, including textured native images.
        const scale = step / stoneStep * (removing ? 1 : .92 + .08 * local);
        for (const piece of [shadows.children[index], stones.children[index]]) {
          piece.setAttribute('opacity', opacity);
          piece.setAttribute('transform', `translate(${frame.grid[0] - x + sx * step + dx} ${frame.grid[1] - y + sy * step}) scale(${scale})`);
        }
      });
    }
    function show(frame) {
      clear(); previous = frame;
      layer = document.createElement('div'); layer.className = 'zen-mode-handoff';
      layer.setAttribute('aria-hidden', 'true'); layer.inert = true;
      const [x, y, width, height] = frame.clip;
      Object.assign(layer.style, { left: `${x}px`, top: `${y}px`, width: `${width}px`, height: `${height}px` });
      surface = document.createElement('div'); surface.className = 'zen-handoff-surface';
      material(surface, frame);
      texture = document.createElement('div'); texture.className = 'zen-handoff-texture'; texture.style.opacity = '0';
      const svg = document.createElementNS(namespace, 'svg');
      const filter = document.createElementNS(namespace, 'filter'); filter.id = 'zen-handoff-blur';
      shadowBlur = document.createElementNS(namespace, 'feGaussianBlur'); shadowBlur.setAttribute('in', 'SourceGraphic');
      filter.append(shadowBlur);
      outline = document.createElementNS(namespace, 'rect'); outline.setAttribute('fill', 'none');
      path = document.createElementNS(namespace, 'path'); path.setAttribute('fill', 'none');
      stars = document.createElementNS(namespace, 'g'); stones = document.createElementNS(namespace, 'g'); stones.classList.add('zen-handoff-stones');
      shadows = document.createElementNS(namespace, 'g'); shadows.classList.add('zen-handoff-shadows');
      svg.append(filter, outline, path, stars, shadows, stones); surface.append(texture, svg); layer.append(surface);
      coordinateLayers = []; addCoordinates(frame.coordinates); paint(frame); setStones(frame);
      root.append(layer); root.dataset.zenHandoff = 'waiting';
      // content.js, which runs next, may only now mark the page strips the cover spans.
      const shown = layer;
      requestAnimationFrame(() => { if (layer === shown && root.dataset.zenHandoff === 'waiting') paint(previous); });
      // Only while the page is still building its own bar: not on a BFCache restore.
      if (!document.querySelector('.zen-toolbar') && (barCopy = buildBar(frame.bar))) { root.append(barCopy); root.dataset.zenBarCopy = 'on'; }
      timer = setTimeout(clear, LIMIT); // Never leave an old board over a load failure.
      observer = new MutationObserver(() => {
        if (root.dataset.zen !== 'on' || document.querySelector('#errorMessage')?.textContent.trim()) clear();
      });
      observer.observe(document, { childList: true, subtree: true, characterData: true });
    }
    function take() {
      let data;
      try { const raw = sessionStorage.getItem(KEY); sessionStorage.removeItem(KEY); if (raw?.length < 200000) data = JSON.parse(raw); } catch {}
      if (!data || data.to !== location.href || !allowed(location.href) || !allowed(data.from) || !valid(data.frame) ||
          !Number.isFinite(data.at) || Date.now() - data.at < 0 || Date.now() - data.at > 4000) return;
      // Restore presentation preferences before asynchronous extension storage.
      for (const { key, values } of preferences) if (values.includes(data[key])) root.dataset[key] = data[key];
      show(data.frame);
    }
    async function ready() {
      releaseBar();
      if (!layer || departing || running) return;
      running = true;
      const currentLayer = layer;
      await snapshotReady;
      if (layer !== currentLayer) return;
      const next = capture();
      if (!next) { clear(); return; }
      try { await Promise.all([...new Set([next.image, ...(next.stones || []).map(s => safeImage(s[6]))].filter(Boolean))].map(async url => {
        const picture = new Image(); picture.src = safeImage(url); await picture.decode();
      })); } catch { if (layer === currentLayer) clear(); return; }
      if (layer !== currentLayer) return;
      // pagereveal may have supplied its snapshot while new images decoded.
      await snapshotReady;
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      if (layer !== currentLayer) return;
      snapshot?.skipTransition(); snapshot = null;
      if (previous.clip.some((n, i) => Math.abs(n - next.clip[i]) > 1) ||
          previous.size.some((n, i) => n !== next.size[i]) || root.dataset.zenMotion !== 'on' ||
          matchMedia('(prefers-reduced-motion: reduce)').matches) { clear(); return; }
      // Identical labels are painted once at full opacity. Different native
      // coordinate presentations crossfade at the same moving grid, never as stones.
      if (JSON.stringify(previous.coordinates || []) !== JSON.stringify(next.coordinates || [])) {
        addCoordinates(next.coordinates, 0);
        paint(previous); // Position the incoming glyphs before their first possible paint.
      }
      root.dataset.zenHandoff = 'moving'; material(texture, next);
      let building = false, settledAt;
      const start = performance.now();
      const tick = now => {
        if (layer !== currentLayer) return;
        const elapsed = now - start;
        const t = Math.max(0, Math.min(1, elapsed / DURATION)), ease = t * t * (3 - 2 * t);
        // Anchor the pause to a frame at the final camera position, rather
        // than letting a dropped motion frame consume the whole pause.
        if (t === 1 && settledAt === undefined) settledAt = now;
        const buildTime = settledAt === undefined ? -1 : now - settledAt - HOLD;
        root.dataset.zenHandoff = t < 1 ? 'moving' : buildTime < 0 ? 'settling' : 'building';
        const blend = key => previous[key].map((n, i) => n + (next[key][i] - n) * ease);
        const camera = { ...next, grid: blend('grid'),
          inset: (previous.inset || [.5, .5]).map((n, i) => n + ((next.inset || [.5, .5])[i] - n) * ease),
          starRadius: (previous.starRadius || 0) + ((next.starRadius || 0) - (previous.starRadius || 0)) * ease,
          lineWidth: previous.lineWidth + (next.lineWidth - previous.lineWidth) * ease };
        paint(camera); texture.style.opacity = String(ease);
        if (coordinateLayers.length === 2) {
          coordinateLayers[0].group.setAttribute('opacity', 1 - ease);
          coordinateLayers[1].group.setAttribute('opacity', ease);
        }
        stones.dataset.phase = elapsed < OUT ? 'sweeping' : buildTime < 0 ? 'empty' : 'building';
        if (elapsed < OUT) paintStones(camera, elapsed / OUT, true);
        else if (buildTime < 0) { stones.replaceChildren(); shadows.replaceChildren(); }
        else {
          if (!building) { setStones(next, true); building = true; }
          paintStones(camera, Math.min(1, buildTime / IN), false);
        }
        if (buildTime < IN) animation = requestAnimationFrame(tick); else clear();
      };
      animation = requestAnimationFrame(tick);
    }
    function save(to) {
      if (root.dataset.zen !== 'on' || root.hasAttribute('data-zen-preparing')) return;
      const frame = capture(); if (!frame) return;
      frame.bar = captureBar();
      try {
        sessionStorage.setItem(KEY, JSON.stringify({ at: Date.now(), from: location.href, to, frame,
          ...Object.fromEntries(preferences.map(({ key }) => [key, root.dataset[key]])) }));
      } catch { return; }
      return frame;
    }
    addEventListener('pageswap', event => {
      const to = event.activation?.entry?.url;
      if (!to || !allowed(to)) return;
      const frame = save(to); if (!frame) return;
      // Snapshot the already-painted page. Rebuilding the board and its image
      // layers inside pageswap asks the compositor to capture brand-new layers
      // at the exact moment their old document is being discarded.
      clear(); departing = true; root.dataset.zenDeparting = 'on';
      event.viewTransition?.ready.catch(() => {});
      // Chromium stops presenting frames around a cross-document transition,
      // hiding the sweep and pan that run behind it. Paint holding already
      // covers its document swap. WebKit keeps the snapshot and still animates.
      // iOS Safari with edge strips: its snapshot covers only the viewport, leaves the area
      // behind its status bar blank and drops the bar's frost. The new page paints the cover,
      // the bar and the strips from its first frame, so the snapshot isn't needed.
      if (navigator.userAgentData || root.hasAttribute('data-zen-edges')) event.viewTransition?.skipTransition();
    });
    addEventListener('pagereveal', event => {
      if (departing) { clear(); take(); } // Restored from BFCache.
      if (layer) {
        coverDocumentSwap(event.viewTransition);
        if (!root.hasAttribute('data-zen-preparing')) requestAnimationFrame(ready);
      }
    });
    addEventListener('pageshow', event => {
      if (event.persisted) { clear(); take(); }
    });
    addEventListener('pagehide', () => { observer?.disconnect(); });
    document.addEventListener('DOMContentLoaded', () => {
      if (!document.querySelector('#target')) clear(); // Login/server-error document, not a solving page.
    }, { once: true });
    // An in-page change of presentation, such as Reset showing the problem differently,
    // uses the same cover and camera move as Next, from the board as it is now.
    document.addEventListener('zen:reframe-start', () => {
      const frame = capture();
      if (frame) show(frame);
    });
    document.addEventListener('zen:reframe-end', () => ready());
    document.addEventListener('zen:disabled', clear);
    document.addEventListener('zen:startup-failed', clear);
    // At document_start a phone may still report the default 980px viewport.
    // Its meta tag then restores the existing viewport: that is not a resize
    // of the solving area and must not discard the incoming handoff.
    addEventListener('resize', () => {
      if (!layer || !running) return; // Readiness validates the waiting board's geometry.
      const board = document.querySelector('#target .besogo-board');
      if (!board) { clear(); return; }
      const r = board.getBoundingClientRect(), clip = [r.x, r.y, r.width, r.height];
      if (previous.clip.some((n, i) => Math.abs(n - clip[i]) > 1)) clear();
    });
    take();
    return { ready, clear };
  }
  globalThis.ZenModeHandoff = { create, valid, boardBounds };
})();
