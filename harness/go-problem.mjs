// Original, limited SGF/tree player for the three local demonstration records.
// No upstream implementation is included. It does not score arbitrary Go games.
export function parseSGF(text) {
  let at = 0, count = 0;
  const space = () => { while (/\s/.test(text[at] || '') && at < text.length) at++; };
  function take(char) { space(); if (text[at++] !== char) throw Error(`Expected ${char} in SGF`); }
  function tree() {
    take('(');
    let root, tail;
    space();
    while (text[at] === ';') {
      at++;
      if (++count > 2000) throw Error('SGF too large');
      const node = { properties: {}, children: [] };
      if (tail) tail.children.push(node); else root = node;
      tail = node;
      space();
      while (/[A-Z]/.test(text[at] || '')) {
        let key = '';
        while (/[A-Z]/.test(text[at] || '')) key += text[at++];
        if (node.properties[key]) throw Error('Duplicate SGF property');
        const values = [];
        space();
        while (text[at] === '[') {
          at++; let value = '';
          while (at < text.length && text[at] !== ']') {
            let char = text[at++];
            if (char === '\\') {
              char = text[at++];
              if (char === '\r' && text[at] === '\n') at++;
              if (char === '\r' || char === '\n') continue;
            }
            if (char === undefined) throw Error('Unterminated SGF value');
            value += char;
          }
          take(']'); values.push(value); space();
        }
        if (!values.length) throw Error('Missing SGF value');
        node.properties[key] = values;
      }
    }
    if (!root) throw Error('Empty SGF tree');
    while (text[at] === '(') { tail.children.push(tree()); space(); }
    take(')'); return root;
  }
  const root = tree(); space();
  if (at !== text.length) throw Error('Only one SGF game is supported');
  return root;
}

const indexOf = (size, x, y) => (y - 1) * size.x + x - 1;
function point(text, size) {
  if (!/^[a-z]{2}$/.test(text)) throw Error('Unsupported SGF point/pass');
  const x = text.charCodeAt(0) - 96, y = text.charCodeAt(1) - 96;
  if (x > size.x || y > size.y) throw Error('Point outside board');
  return { x, y };
}
function neighbors(size, i) {
  const result = [], x = i % size.x, y = Math.floor(i / size.x);
  if (x) result.push(i - 1);
  if (x + 1 < size.x) result.push(i + 1);
  if (y) result.push(i - size.x);
  if (y + 1 < size.y) result.push(i + size.x);
  return result;
}
function group(stones, size, start) {
  const members = new Set([start]), pending = [start]; let liberty = false;
  while (pending.length) for (const i of neighbors(size, pending.pop())) {
    if (!stones[i]) liberty = true;
    else if (stones[i] === stones[start] && !members.has(i)) { members.add(i); pending.push(i); }
  }
  return { members, liberty };
}

export function playStone(position, size, move, previous = null) {
  if (!Number.isInteger(move.x) || !Number.isInteger(move.y) || move.x < 1 || move.y < 1 || move.x > size.x || move.y > size.y)
    throw Error('Outside the board');
  const stones = position.slice(), i = indexOf(size, move.x, move.y);
  if (stones[i]) throw Error('That point is occupied');
  stones[i] = move.color;
  let captures = 0;
  for (const n of neighbors(size, i)) if (stones[n] === -move.color) {
    const enemy = group(stones, size, n);
    if (!enemy.liberty) for (const captured of enemy.members) { stones[captured] = 0; captures++; }
  }
  if (!group(stones, size, i).liberty) throw Error('Suicide is not allowed');
  if (previous && stones.every((value, n) => value === previous[n])) throw Error('Immediate ko recapture');
  return { stones, captures };
}

export function loadProblem(text, orientation = 0) {
  if (!Number.isInteger(orientation) || orientation < 0 || orientation > 7) throw Error('Invalid orientation');
  const raw = parseSGF(text), dimensions = (raw.properties.SZ?.[0] || '19').split(':').map(Number);
  const originalSize = { x: dimensions[0], y: dimensions[1] || dimensions[0] };
  if (![originalSize.x, originalSize.y].every(n => Number.isInteger(n) && n >= 2 && n <= 25)) throw Error('Unsupported board size');
  const turns = orientation % 4;
  const size = turns % 2 ? { x: originalSize.y, y: originalSize.x } : { ...originalSize };
  function orient({ x, y }) {
    let width = originalSize.x, height = originalSize.y;
    for (let turn = 0; turn < turns; turn++) {
      [x, y] = [height + 1 - y, x]; [width, height] = [height, width];
    }
    return { x: orientation >= 4 ? size.x + 1 - x : x, y };
  }
  const first = raw.children[0]?.properties;
  const solver = first?.B ? -1 : first?.W ? 1 : 0;
  if (!solver || raw.properties.PL && raw.properties.PL[0] !== (solver === -1 ? 'B' : 'W')) throw Error('Unclear player to move');
  let correctEnds = 0;
  function build(source, parent) {
    const p = source.properties;
    if (p.G || p.S || p.SKD) throw Error('Status-based SGF outcomes are outside this demo');
    if (p.B && p.W) throw Error('Two moves in one node');
    let stones = parent ? parent.stones.slice() : new Int8Array(size.x * size.y);
    for (const [key, color] of [['AB', -1], ['AW', 1], ['AE', 0]]) for (const value of p[key] || []) {
      if (parent) throw Error('Mid-sequence setup is outside this demo');
      const ends = value.split(':').map(v => point(v, originalSize)), end = ends[1] || ends[0];
      for (let y = ends[0].y; y <= end.y; y++) for (let x = ends[0].x; x <= end.x; x++) {
        const placed = orient({ x, y }); stones[indexOf(size, placed.x, placed.y)] = color;
      }
    }
    const color = p.B ? -1 : p.W ? 1 : 0;
    const move = color ? { ...orient(point((p.B || p.W)[0], originalSize)), color } : null;
    if (parent && (!move || color !== parent.nextColor)) throw Error('Nonalternating or missing move');
    if (!parent && move) throw Error('Root move unsupported');
    let captures = 0;
    if (move) ({ stones, captures } = playStone(stones, size, move, parent.parent?.stones));
    const marks = new Map();
    for (const key of ['LB', 'CR', 'SQ', 'TR', 'MA']) for (const value of p[key] || []) {
      const where = orient(point(value.slice(0, 2), originalSize));
      marks.set(indexOf(size, where.x, where.y), key === 'LB' ? value.slice(3) : key);
    }
    const node = { parent, move, stones, captures, marks, children: [], nextColor: color ? -color : solver,
      comment: p.C?.join('\n').trim() || '', getSize: () => size,
      getStone: (x, y) => stones[indexOf(size, x, y)], getMarkup: (x, y) => marks.get(indexOf(size, x, y)) || 0 };
    node.children = source.children.map(child => build(child, node));
    node.terminal = node.comment.startsWith('+');
    if (node.terminal && node.children.length) throw Error('Nonterminal success marker needs separate interpretation');
    if (node.terminal) correctEnds++;
    // C[+] is explicit success. Unmarked leaves are refutations, not wins.
    node.winning = node.terminal || (node.children.length > 0 && (node.nextColor === solver
      ? node.children.some(child => child.winning) : node.children.every(child => child.winning)));
    return node;
  }
  const root = build(raw, null);
  if (!correctEnds || !root.winning) throw Error('No unambiguous supported solution');
  return { root, size, solver, correctEnds, orientation };
}

export class ProblemSession {
  constructor(problem) { this.problem = problem; this.reset(); }
  reset() { this.current = this.problem.root; this.stones = this.current.stones; this.phase = 'play'; this.lastMove = null; this.message = ''; }
  enter(node) { this.current = node; this.stones = node.stones; this.lastMove = node.move; }
  play(x, y) {
    if (this.phase !== 'play') return false;
    const move = { x, y, color: this.problem.solver };
    let played;
    try { played = playStone(this.stones, this.problem.size, move, this.current.parent?.stones); }
    catch (error) { this.message = error.message; return false; }
    const child = this.current.children.find(n => n.move.x === x && n.move.y === y && n.move.color === move.color);
    if (!child) {
      this.stones = played.stones; this.lastMove = move; this.phase = 'failure'; this.message = 'Not in this solution. Reset to retry.'; return true;
    }
    this.enter(child);
    this.phase = child.terminal ? 'success' : child.children.length ? 'reply' : 'failure';
    this.message = this.phase === 'failure' ? 'That line fails. Reset to retry.' : '';
    return true;
  }
  reply(choice) {
    if (this.phase !== 'reply') return false;
    const child = choice || this.current.children.find(n => !n.winning) || this.current.children[0];
    if (!this.current.children.includes(child)) throw Error('Reply is not in the source tree');
    this.enter(child);
    this.phase = child.terminal ? 'success' : child.winning ? 'play' : 'failure';
    this.message = this.phase === 'failure' ? 'That line fails. Reset to retry.' : '';
    return true;
  }
}
