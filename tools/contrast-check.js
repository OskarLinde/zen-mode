// Shared by the Chrome and WebKit hosts. WCAG 2 contrast of every visible piece of text
// inside the open Zen sheets, against the colour actually behind it.
function auditContrast(scope = 'dialog.zen-site-sheet[open]') {
  const parse = value => {
    const m = /rgba?\(([^)]+)\)/.exec(value || '');
    if (!m) return null;
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
  };
  const over = (top, bottom) => {
    const a = top[3] + bottom[3] * (1 - top[3]);
    if (!a) return [0, 0, 0, 0];
    return [0, 1, 2].map(i => (top[i] * top[3] + bottom[i] * bottom[3] * (1 - top[3])) / a).concat(a);
  };
  const luminance = c => {
    const [r, g, b] = c.slice(0, 3).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  // The opaque colour behind an element: its own and its ancestors' backgrounds, front to
  // back, over the page's white. Background images are reported, not guessed.
  const background = element => {
    let colour = [0, 0, 0, 0], image = false;
    const name = node => node.tagName.toLowerCase() + (node.className ? '.' + String(node.className).trim().split(/\s+/)[0] : '');
    for (let node = element; node && node.nodeType === 1; node = node.parentElement) {
      const style = getComputedStyle(node);
      // A plain colour wash, linear-gradient(c, c), is measured; other images are reported.
      const wash = /^linear-gradient\((rgba?\([^)]*\)), (rgba?\([^)]*\))\)$/.exec(style.backgroundImage);
      if (style.backgroundImage !== 'none' && !(wash && wash[1] === wash[2]) && !image) image = name(node);
      // So is an inset shadow that fills the box, which paints above the background.
      const fill = /^(rgba?\([^)]*\)) 0px 0px 0px (\d+)px inset$/.exec(style.boxShadow);
      if (fill && Number(fill[2]) * 2 >= Math.min(node.offsetWidth, node.offsetHeight)) colour = over(colour, parse(fill[1]));
      if (wash && wash[1] === wash[2]) colour = over(colour, parse(wash[1]));
      const own = parse(style.backgroundColor);
      if (own && own[3]) colour = over(colour, own);
      if (colour[3] >= 0.999) break;
    }
    return { colour: over(colour, [255, 255, 255, 1]), image };
  };
  const opacity = element => {
    let value = 1;
    for (let node = element; node && node.nodeType === 1; node = node.parentElement) value *= Number(getComputedStyle(node).opacity);
    return value;
  };
  const visible = element => {
    const r = element.getBoundingClientRect(), style = getComputedStyle(element);
    return r.width > 0 && r.height > 0 && style.visibility !== 'hidden' && style.display !== 'none' && !element.closest('[hidden], [aria-hidden="true"]');
  };
  const rows = [], seen = new Set();
  for (const sheet of document.querySelectorAll(scope)) {
    const walker = document.createTreeWalker(sheet, NodeFilter.SHOW_TEXT);
    const holders = new Set();
    for (let text = walker.nextNode(); text; text = walker.nextNode())
      if (text.textContent.trim() && text.parentElement && !text.parentElement.closest('option, script, style')) holders.add(text.parentElement);
    for (const control of sheet.querySelectorAll('select, input[type="button"], input[type="submit"]')) holders.add(control);
    for (const element of holders) {
      if (seen.has(element) || !visible(element)) continue;
      seen.add(element);
      const style = getComputedStyle(element);
      const text = (element.tagName === 'SELECT' ? element.selectedOptions[0]?.textContent : element.tagName === 'INPUT' ? element.value : [...element.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join(' ')).trim().replace(/\s+/g, ' ');
      if (!text) continue;
      if (opacity(element) < 0.05) continue; // hover-only, e.g. tooltips at opacity 0
      const fg = parse(style.color) || [0, 0, 0, 1], behind = background(element);
      const shown = over([fg[0], fg[1], fg[2], fg[3] * opacity(element)], behind.colour);
      const size = parseFloat(style.fontSize), weight = Number(style.fontWeight) || 400;
      const large = size >= 24 || (size >= 18.66 && weight >= 700);
      const disabled = !!element.closest(':disabled, [aria-disabled="true"]');
      const value = ratio(shown, behind.colour);
      rows.push({ sheet: sheet.id, text: text.slice(0, 60), ratio: Math.round(value * 100) / 100, need: large ? 3 : 4.5,
        pass: value >= (large ? 3 : 4.5), disabled, image: behind.image, size, weight,
        fg: shown.slice(0, 3).map(Math.round), bg: behind.colour.slice(0, 3).map(Math.round),
        source: [element, element.parentElement, element.parentElement?.parentElement].filter(Boolean).map(n => n.tagName.toLowerCase() + (n.id ? '#' + n.id : '') + (n.className ? '.' + String(n.className).trim().split(/\s+/).join('.') : '') + (n.getAttribute('color') ? '[color=' + n.getAttribute('color') + ']' : '') + (n.style?.color ? '{' + n.style.color + '}' : '')).join(' < '),
        where: [element.tagName.toLowerCase(), element.className && String(element.className).split(' ')[0]].filter(Boolean).join('.') +
          ' < ' + (element.parentElement?.className ? String(element.parentElement.className).split(' ')[0] : element.parentElement?.tagName.toLowerCase()) });
    }
  }
  return rows;
}
