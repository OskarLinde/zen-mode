// Original geometry policy. No puzzle data or site implementation is bundled.
export const EDGE_MARGIN = 1 / 3;   // Mat beyond a real board edge, in grid steps.
export const MAX_AUTO_STEP = 80;    // Largest Auto-fit grid step, in CSS px.
export const MIN_ACROSS = 6;        // Fewest lines shown across.
export function collectGeometry(root, limit = 600000) {
  const size = root?.getSize?.();
  if (!size || ![size.x, size.y].every(n => Number.isInteger(n) && n >= 2 && n <= 25))
    throw new Error('Unrecognized board size');
  const points = new Map(), seen = new Set(), pending = [root], stones = new Map(), moves = new Map();
  let work = 0;
  const include = (x, y) => {
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 1 || y < 1 || x > size.x || y > size.y)
      throw new Error('Invalid board coordinate');
    points.set(`${x},${y}`, { x, y });
  };
  while (pending.length) {
    const node = pending.pop();
    if (!node || seen.has(node)) throw new Error('Unrecognized variation tree');
    seen.add(node);
    const s = node.getSize?.();
    if (s?.x !== size.x || s?.y !== size.y || !Array.isArray(node.children) ||
        typeof node.getStone !== 'function' || typeof node.getMarkup !== 'function')
      throw new Error('Incomplete geometry');
    work += size.x * size.y;
    if (work > limit || node.children.length > 2000) throw new Error('Geometry budget exceeded');
    for (let x = 1; x <= size.x; x++) for (let y = 1; y <= size.y; y++) {
      const stone = node.getStone(x, y);
      if (![-1, 0, 1].includes(stone)) throw new Error('Unrecognized stone');
      const markup = node.getMarkup(x, y);
      if (stone || markup) include(x, y);
      // The problem as set up: the root's stones and its markup.
      if (node === root && (stone || markup)) stones.set(`${x},${y}`, { x, y });
    }
    if (node.move && !(node.move.x === 0 && node.move.y === 0)) {
      include(node.move.x, node.move.y); moves.set(`${node.move.x},${node.move.y}`, { x: node.move.x, y: node.move.y });
    }
    pending.push(...node.children);
  }
  return { size, points: [...points.values()], stones: [...stones.values()], moves: [...moves.values()], nodes: seen.size };
}

export function frameBounds(size, points, padding = 1) {
  const full = { left: 1, top: 1, right: size.x, bottom: size.y };
  if (!points.length) return full;
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  const b = {
    left: Math.max(1, Math.min(...xs) - padding),
    top: Math.max(1, Math.min(...ys) - padding),
    right: Math.min(size.x, Math.max(...xs) + padding),
    bottom: Math.min(size.y, Math.max(...ys) + padding)
  };
  // Avoid presenting a crop immediately next to a real edge as if it were open space.
  if (b.left <= 2) b.left = 1;
  if (b.top <= 2) b.top = 1;
  if (b.right >= size.x - 1) b.right = size.x;
  if (b.bottom >= size.y - 1) b.bottom = size.y;
  // Six across limits magnification. Do not invent extra rows below a small
  // problem: placement uses its actual vertical extent and safety padding.
  while (b.right - b.left + 1 < Math.min(MIN_ACROSS, size.x)) {
    if (b.left > 1) b.left--;
    if (b.right - b.left + 1 < Math.min(MIN_ACROSS, size.x) && b.right < size.x) b.right++;
  }
  return b;
}

const wholeBoard = size => ({ left: 1, top: 1, right: size.x, bottom: size.y });
export const fullBox = (size, grid) => viewBoxFor(wholeBoard(size), size, grid);
// Which edge a problem stays against: Min or Max if it touches only that one.
const edgeAlign = (low, high, last) => low === 1 && high < last ? 'Min' : high === last && low > 1 ? 'Max' : 'Mid';
// How much of the spare space falls before the box.
const spareBefore = (space, align) => align === 'Min' ? 0 : align === 'Max' ? space : space / 2;
// A fitted object may not have settled its scale or offsets yet.
export const settledScale = ({ box, scale, offsetTop }, viewport) =>
  scale ?? Math.min(viewport.width / box[2], (viewport.height - (offsetTop || 0)) / box[3]);
function settledOffsets(fitted, scale, viewport) {
  const [, , width, height] = fitted.box, top = fitted.offsetTop || 0;
  return {
    left: fitted.offsetLeft ?? spareBefore(viewport.width - width * scale, fitted.alignX),
    top: top + (fitted.offsetLeft === undefined ? spareBefore(viewport.height - top - height * scale, fitted.alignY) : 0)
  };
}

// The board's grid, from the site's full-board outline. Throws on anything unexpected.
export function gridFromOutline({ x, y, width, height }, size) {
  const step = width / (size.x - 1), stepY = height / (size.y - 1);
  if (![x, y, step, stepY].every(Number.isFinite) || step <= 0 ||
      Math.abs(step - stepY) > 0.01 || x < step / 2 || y < step / 2)
    throw new Error('Unrecognized grid geometry');
  return { x, y, step };
}

// Every intersection must have its own hit cell, or the site's clicks can't be trusted.
export function requireHitCells(cells, grid, size) {
  const { step } = grid;
  const coords = new Set(cells.filter(cell => Math.abs(cell.width - step) < 0.01 && Math.abs(cell.height - step) < 0.01).map(cell => {
    const x = (cell.x + step / 2 - grid.x) / step + 1, y = (cell.y + step / 2 - grid.y) / step + 1;
    return Number.isInteger(x) && Number.isInteger(y) && x >= 1 && x <= size.x && y >= 1 && y <= size.y ? `${x},${y}` : '';
  }));
  if (coords.has('') || coords.size !== size.x * size.y) throw new Error('Incomplete hit grid');
}

// Which sides of the visible board, top, right, bottom, left, are real board edges.
export const realEdges = (surface, matrix, fullWidth, fullHeight) => [surface.top - matrix.f, matrix.e + fullWidth - surface.right,
  matrix.f + fullHeight - surface.bottom, surface.left - matrix.e].map(distance => Math.abs(distance) < .1);

// The margin that puts the sized SVG where fitting decided.
export function svgMargin({ fitted, view, grid, size, scale, viewport, edgeMargin, zoom }) {
  const auto = align => align === 'Min' ? ['0px', 'auto'] : align === 'Max' ? ['auto', '0px'] : ['auto', 'auto'];
  const [left, right] = auto(fitted.alignX), [top, bottom] = auto(fitted.alignY);
  const atRight = Math.abs(view[0] + view[2] - (2 * grid.x + (size.x - 1) * grid.step)) < .01;
  const atBottom = Math.abs(view[1] + view[3] - (2 * grid.y + (size.y - 1) * grid.step)) < .01;
  if (fitted.offsetLeft === undefined) {
    const spareHeight = Math.max(0, viewport.height - fitted.offsetTop - view[3] * scale);
    const shiftedTop = fitted.offsetTop + spareBefore(spareHeight, fitted.alignY);
    return `${fitted.offsetTop ? `${shiftedTop}px` : top} ${right} ${bottom} ${left}`;
  }
  return `${fitted.offsetTop + (view[1] === 0 ? edgeMargin * (zoom - 1) : 0)}px ${atRight ? edgeMargin * zoom : 0}px ${atBottom ? edgeMargin * zoom : 0}px ${fitted.offsetLeft + (view[0] === 0 ? edgeMargin * (zoom - 1) : 0)}px`;
}

export function viewBoxFor(bounds, size, grid) {
  const { x, y, step } = grid;
  const fullWidth = 2 * x + (size.x - 1) * step;
  const fullHeight = 2 * y + (size.y - 1) * step;
  const left = bounds.left === 1 ? 0 : x + (bounds.left - 1.5) * step;
  const top = bounds.top === 1 ? 0 : y + (bounds.top - 1.5) * step;
  const right = bounds.right === size.x ? fullWidth : x + (bounds.right - 0.5) * step;
  const bottom = bounds.bottom === size.y ? fullHeight : y + (bounds.bottom - 0.5) * step;
  return [left, top, right - left, bottom - top];
}

export function fitViewBox(bounds, size, grid, viewport) {
  const box = viewBoxFor(bounds, size, grid);
  const full = fullBox(size, grid);
  const ratio = viewport.width / viewport.height;
  if (!Number.isFinite(ratio) || ratio <= 0) throw new Error('Invalid viewport');
  // Choose scale from tight horizontal bounds. After reach is settled,
  // fillViewport extends the visible grid without changing that scale.
  const width = box[2];
  const height = Math.min(full[3], Math.max(box[3], width / ratio));
  const alignX = edgeAlign(bounds.left, bounds.right, size.x), alignY = edgeAlign(bounds.top, bounds.bottom, size.y);
  const origin = (start, length, expanded, max, align) => align === 'Min' ? 0 : align === 'Max' ? max - expanded :
    Math.max(0, Math.min(max - expanded, start + (length - expanded) / 2));
  // Never expose invented grid/wood beyond the real board. If a full-board
  // position cannot fill a tall viewport, the renderer leaves neutral space.
  return { box: [origin(box[0], box[2], width, full[2], alignX), origin(box[1], box[3], height, full[3], alignY), width, height], alignX, alignY };
}

export function fitForReach(bounds, size, grid, viewport) {
  if (![viewport.width, viewport.height].every(n => Number.isFinite(n) && n > 0))
    throw new Error('Invalid viewport');
  const box = viewBoxFor(bounds, size, grid);
  // Use the largest scale that retains the complete safe rectangle. A height
  // limit uses the whole height; a width limit puts all spare space above it.
  const scale = Math.min(viewport.width / box[2], viewport.height / box[3]);
  const alignX = edgeAlign(bounds.left, bounds.right, size.x);
  const spareWidth = Math.max(0, viewport.width - box[2] * scale);
  return { box, alignX, alignY: 'Max',
    offsetLeft: spareBefore(spareWidth, alignX),
    offsetTop: Math.max(0, viewport.height - box[3] * scale) };
}

// A little mat beyond each real board edge, never beside an open crop.
// Carry the scale explicitly: fillViewport may extend the board behind glass
// controls without refitting or putting the safe puzzle rectangle under them.
export function withEdgeMargin(fitted, size, grid, viewport, amount = EDGE_MARGIN) {
  const full = fullBox(size, grid);
  const [x, y, width, height] = fitted.box;
  const margin = grid.step * amount;
  const left = x === 0 ? margin : 0, right = Math.abs(x + width - full[2]) < .01 ? margin : 0;
  const top = y === 0 ? margin : 0;
  const bottom = Math.abs(y + height - full[3]) < .01 ? margin : 0;
  const scale = Math.min(viewport.width / (width + left + right), viewport.height / (height + top + bottom));
  const spareX = viewport.width - (width + left + right) * scale;
  const spareY = viewport.height - (height + top + bottom) * scale;
  return { ...fitted, scale,
    offsetLeft: left * scale + spareBefore(spareX, fitted.alignX),
    offsetTop: top * scale + spareBefore(spareY, fitted.alignY) };
}

// Fill unused viewport space only after the puzzle's scale and reachable
// position are settled. Adding real grid must not trigger another zoom-out.
// Preserve the exact screen transform; any remaining margin is past an actual
// board edge, never a deliberately narrow strip of cropped board.
export function fillViewport(fitted, size, grid, viewport) {
  const full = fullBox(size, grid);
  const [x, y, width, height] = fitted.box;
  const scale = settledScale(fitted, viewport), { left, top } = settledOffsets(fitted, scale, viewport);
  const startX = Math.max(0, x - left / scale), startY = Math.max(0, y - top / scale);
  const endX = Math.min(full[2], x + (viewport.width - left) / scale);
  const endY = Math.min(full[3], y + (viewport.height - top) / scale);
  return { ...fitted, scale, box: [startX, startY, endX - startX, endY - startY],
    offsetLeft: Math.max(0, left - (x - startX) * scale),
    offsetTop: Math.max(0, top - (y - startY) * scale) };
}

// Limit automatic magnification in CSS pixels, preserving the chosen edge
// alignment. Manual zoom is applied later by the renderer.
export function limitAutoFitScale(fitted, grid, viewport, maxStep = MAX_AUTO_STEP) {
  const scale = settledScale(fitted, viewport);
  if (scale * grid.step <= maxStep) return fitted;
  const next = maxStep / grid.step, ratio = next / scale;
  const { left, top } = settledOffsets(fitted, scale, viewport);
  return { ...fitted, scale: next,
    offsetLeft: left * ratio + spareBefore(viewport.width * (1 - ratio), fitted.alignX),
    offsetTop: top * ratio + spareBefore(viewport.height * (1 - ratio), fitted.alignY) };
}

// Where the fitted board sits, per axis, once its scale is settled. If the whole
// board fits on an axis, its margins start equal and lean towards the problem,
// but the nearer margin stays at least half the equal one, so it never looks
// lopsided. If it does not fit, the problem is centred within the spare room, and
// with no spare room nothing moves. Scale and the safe rectangle never change.
// Thumb reach keeps its bottom placement unless the whole board fits.
export function placeProblem(fitted, problem, size, grid, viewport, { margin = 0, reach = false } = {}) {
  const full = fullBox(size, grid);
  const [x, y, width, height] = fitted.box;
  const scale = settledScale(fitted, viewport), { left, top: down } = settledOffsets(fitted, scale, viewport);
  const fitsX = full[2] * scale + 2 * margin <= viewport.width + .01, fitsY = full[3] * scale + 2 * margin <= viewport.height + .01;
  const place = (length, whole, fits, start, extent, origin, first, last) => {
    const centre = length / 2 - (origin + (first + last - 2) / 2 * grid.step) * scale;
    if (fits) {
      const equal = (length - whole * scale) / 2, keep = Math.max(margin, equal / 2);
      return Math.max(keep, Math.min(length - whole * scale - keep, centre)) + start * scale;
    }
    const before = start === 0 ? margin : 0, after = Math.abs(start + extent - whole) < .01 ? margin : 0;
    return Math.max(before, Math.min(before + Math.max(0, length - extent * scale - before - after), centre + start * scale));
  };
  const placed = { ...fitted, scale, offsetLeft: left, offsetTop: down };
  if (!reach || (fitsX && fitsY)) {
    placed.offsetLeft = place(viewport.width, full[2], fitsX, x, width, grid.x, problem.left, problem.right);
    placed.offsetTop = place(viewport.height, full[3], fitsY, y, height, grid.y, problem.top, problem.bottom);
  }
  return placed;
}

// Where a row's tap tile starts, in board units.
const tileTop = (row, grid) => grid.y + (row - 1.5) * grid.step;
// Largest scale that keeps every tap tile of the problem below a top band of
// controls while the kept rectangle, plus mat at a real bottom edge, stays in view.
function bandLimit(keep, problem, size, grid, height, band, mat = 0) {
  const box = viewBoxFor(keep, size, grid), bottom = box[1] + box[3] + (keep.bottom === size.y ? mat * grid.step : 0);
  return band > 0 ? (height - band) / (bottom - tileTop(problem.top, grid)) : Infinity;
}

// On phones the menu and hearts float over the board's top. No tap tile of the
// problem may sit under them: like thumb reach, move the board down first, and
// only if the kept rectangle would leave the view, shrink until it fits, bottom
// aligned. keep is what must stay visible, problem is where play happens.
export function clearBand(fitted, { keep, problem, size, grid, viewport, band = 0, mat = 0 }) {
  if (!(band > 0)) return fitted;
  const scale = settledScale(fitted, viewport), { left, top } = settledOffsets(fitted, scale, viewport);
  const box = viewBoxFor(keep, size, grid), y = fitted.box[1];
  const bottom = box[1] + box[3] + (keep.bottom === size.y ? mat * grid.step : 0);
  const need = band - (top + (tileTop(problem.top, grid) - y) * scale);
  if (need <= .01) return fitted;
  if (top + need + (bottom - y) * scale <= viewport.height + .01) return { ...fitted, scale, offsetLeft: left, offsetTop: top + need };
  const next = Math.min(scale, bandLimit(keep, problem, size, grid, viewport.height, band, mat)), ratio = next / scale;
  return { ...fitted, scale: next,
    offsetLeft: left * ratio + spareBefore(viewport.width * (1 - ratio), fitted.alignX),
    offsetTop: viewport.height - (bottom - y) * next };
}

// The whole fit, in order: crop, margin, cap, placement, the band, then real grid
// into any unused space, including under a glass bar. Site view takes the crop alone.
// problem is the play rectangle when bounds is the whole board, as in Full board.
export function fitBoard({ bounds, problem = bounds, size, grid, viewport, framing, thumb = false, zoom = 1, margin = false, glassHeight, band = 0, planned, maxStep = MAX_AUTO_STEP }) {
  // A tight crop comes placed already (planTight); only the fill remains.
  if (planned && framing === 'frame' && zoom === 1) {
    const filled = fillViewport(planned, size, grid, viewport);
    return glassHeight === undefined ? filled : fillViewport(filled, size, grid, { ...viewport, height: glassHeight });
  }
  let fitted = thumb && framing !== 'site' && zoom === 1
    ? fitForReach(bounds, size, grid, viewport)
    : { ...fitViewBox(bounds, size, grid, viewport), offsetTop: 0 };
  if (framing === 'site') return fitted;
  if (margin) fitted = withEdgeMargin(fitted, size, grid, viewport);
  if (framing === 'frame') fitted = limitAutoFitScale(fitted, grid, viewport, maxStep);
  if (zoom === 1) fitted = placeProblem(fitted, bounds, size, grid, viewport,
    { margin: margin ? grid.step * settledScale(fitted, viewport) * EDGE_MARGIN : 0, reach: thumb });
  if (zoom === 1) fitted = clearBand(fitted, { keep: bounds, problem, size, grid, viewport, band, mat: margin ? EDGE_MARGIN : 0 });
  fitted = fillViewport(fitted, size, grid, viewport);
  return glassHeight === undefined ? fitted : fillViewport(fitted, size, grid, { ...viewport, height: glassHeight });
}

// Grid steps, in CSS px, that decide whether Auto-fit turns or crops (see chooseView).
// Below MIN_GRID_STEP adjacent intersections stop being reliably tappable (35 px is
// about 5.8 mm on a phone), so Auto-fit does all it can to raise the grid. At
// COMFORT_STEP or more it leaves the problem as the site draws it. In between it turns
// only for a clear gain.
export const MIN_GRID_STEP = 35;
export const COMFORT_STEP = 64;
export const TURN_GAIN = 1.2;
// Hysteresis: a later decision for the same problem (after a resize or a rotation of
// the device) favours what is shown by this factor, and discounts the rest by it, so
// a view near a boundary cannot flap.
const HOLD = 1.05;

// band: the phone's top band of controls, which the problem must stay below.
export function fittedGridStep(bounds, size, grid, viewport, maxStep = MAX_AUTO_STEP, band = 0) {
  const [, , width, height] = viewBoxFor(bounds, size, grid);
  return Math.min(maxStep, Math.min(viewport.width / width, viewport.height / height,
    bandLimit(bounds, bounds, size, grid, viewport.height, band)) * grid.step);
}

export function quarterTurn(bounds, size) {
  return { left: size.y - bounds.bottom + 1, right: size.y - bounds.top + 1, top: bounds.left, bottom: bounds.right };
}

// Clockwise quarter turns to add to what the site drew, for the optional random
// rotation. pick is one uniform 0-3 per load. The site draws from {e, H, V, R} on a
// regular board and from two of those on a half board, then may auto-rotate, which
// only moves that set to a coset. Applying pick over C4 then covers all 8 of D4
// evenly, and fixing the parity covers one half evenly. A half board needs the even
// turn to regain the mirror the site folds away. A regular board has it already, so
// it stays native there and only an odd pick rotates it.
// free and turn, when given, come from chooseView: free when both orientations keep
// every stone at a comfortable size, and otherwise the orientation the rules pick.
export function randomQuarters({ bounds, size, grid, viewport, turned = false, minStep = MIN_GRID_STEP, pick, halfBoard = false, band = 0, free, turn }) {
  if (size.x !== size.y) return 0;
  if (free === undefined) {
    const native = turned ? quarterTurn(bounds, size) : bounds;
    const here = fittedGridStep(native, size, grid, viewport, MAX_AUTO_STEP, band),
      there = fittedGridStep(quarterTurn(native, size), size, grid, viewport, MAX_AUTO_STEP, band);
    free = here >= minStep && there >= minStep; turn = there > here;
  }
  const quarters = free ? pick : (pick & 2) | (turn ? 1 : 0);
  return quarters === 2 && !halfBoard ? 0 : quarters;
}

// One draw for Reset with no move made: a corner the site offers, a colour if it
// offers that too, and a pick for randomQuarters. The page redraws until the result
// differs from what is shown, which keeps the remaining presentations equally likely.
export function drawPresentation({ corners, colours = 1, random = Math.random }) {
  const pick = n => Math.min(n - 1, Math.floor(random() * n));
  return { corner: pick(corners), colour: pick(colours), quarters: pick(4) };
}

// What Auto-fit shows. Primary: the stones as set up, centred, with FRAME_MARGIN lines
// around them, so play a knight's move or a one-point jump from the group lands on screen.
// Edge rule: a stone on the 1st to EDGE_LINES-th line from a side brings that real edge into
// view, since a one-point jump from the third line reaches the edge. Touch fallback: only if
// that crop's grid step is below the comfortable minimum, crop instead to where play happens,
// the solution's moves and the stones they touch, with PLAY_MARGIN and the same edge rule,
// and keep whichever of the two crops gives the larger step. Moves never widen the primary
// crop, so a long chase does not give its answer away; the view follows it as it is played.
export const FRAME_MARGIN = 2;
export const PLAY_MARGIN = 1;
export const EDGE_LINES = 3;
export function boxOf(points) {
  if (!points.length) return null;
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  return { left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) };
}
export function frameAround(core, size, margin) {
  const box = { left: Math.max(1, core.left - margin), top: Math.max(1, core.top - margin),
    right: Math.min(size.x, core.right + margin), bottom: Math.min(size.y, core.bottom + margin) };
  if (core.left <= EDGE_LINES) box.left = 1;
  if (core.top <= EDGE_LINES) box.top = 1;
  if (core.right > size.x - EDGE_LINES) box.right = size.x;
  if (core.bottom > size.y - EDGE_LINES) box.bottom = size.y;
  return box;
}
// At least six lines across (MIN_ACROSS), as Auto-fit always kept: a smaller crop makes
// the stones look too big. Widen a line per side in turn, so the crop stays centred; if
// that stops one line short of a real edge, take the edge in too.
export function minAcross(box, size) {
  const need = Math.min(MIN_ACROSS, size.x), b = { ...box };
  if (b.right - b.left + 1 >= need) return b;
  while (b.right - b.left + 1 < need) {
    if (b.left > 1) b.left--;
    if (b.right - b.left + 1 < need && b.right < size.x) b.right++;
  }
  if (b.left === 2) b.left = 1;
  if (b.right === size.x - 1) b.right = size.x;
  return b;
}
// During a problem, after the first move: not overly clever. The crop keeps the kind the
// first decision chose (hold.source) and the grid never grows past the step already shown
// (cap): the view may zoom out or pan, never zoom in. Reset or a new problem decides afresh.
export function followView(options, { hold, cap }) {
  const view = chooseView({ ...options, hold, maxStep: Math.min(options.maxStep ?? MAX_AUTO_STEP, cap ?? Infinity) });
  const kept = hold && view.shown[hold.source];
  return { ...view, frame: kept ?? view.frame, source: kept ? hold.source : view.source };
}

// The tight crop: every stone fully visible with EDGE_MARGIN of a cell round it, so its
// liberties can be counted, anywhere on the physical screen (under the menu band or the
// glass bar too), while every touch cell, a move playable next, lies wholly inside the
// touch region: below the band, above the bar, on screen. Grid lines are at integer
// units from line 1. The largest step meeting all of that is a closed form; placement
// then uses the room left: a real edge at the screen edge when stones are within
// EDGE_LINES of it, else centred across and, with thumb reach (it costs no size), low.
// screen: { width, height } of the whole board area; bar: the glass bar's height.
export function planTight({ stones, touch, size, grid, screen, band = 0, bar = 0, reach = false, maxStep = MAX_AUTO_STEP, minStep = MIN_GRID_STEP, edges = true }) {
  // The edge rule: a real edge within EDGE_LINES of the stones is brought into the crop
  // (line 1 with the same margin, its rim and mat), as long as the grid still reaches
  // minStep; touch size outranks it.
  if (edges) {
    const near = [...stones];
    for (const p of stones) {
      if (p.x <= EDGE_LINES) near.push({ x: 1, y: p.y });
      if (p.x > size.x - EDGE_LINES) near.push({ x: size.x, y: p.y });
      if (p.y <= EDGE_LINES) near.push({ x: p.x, y: 1 });
      if (p.y > size.y - EDGE_LINES) near.push({ x: p.x, y: size.y });
    }
    const options = { stones, touch, size, grid, screen, band, bar, reach, maxStep, minStep, edges: false };
    if (near.length > stones.length) {
      const withEdges = planTight({ ...options, stones: near });
      if (withEdges.step >= minStep) return withEdges;
    }
    return planTight(options);
  }
  const S = 0.5 + EDGE_MARGIN, T = 0.5;
  const xs = stones.map(p => p.x - 1), ys = stones.map(p => p.y - 1);
  const tx = touch.map(p => p.x - 1), ty = touch.map(p => p.y - 1);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const limits = [maxStep, screen.width / (x1 - x0 + 2 * S), screen.height / (y1 - y0 + 2 * S)];
  if (touch.length) {
    const [a0, a1, b0, b1] = [Math.min(...tx), Math.max(...tx), Math.min(...ty), Math.max(...ty)];
    const top = band, bottom = screen.height - bar;
    // A pair of bounds that cannot meet (a span of zero or less) sets no limit.
    const fit = (room, span) => span > 0 ? room / span : Infinity;
    limits.push(fit(screen.width, Math.max(x1 + S, a1 + T) - Math.min(x0 - S, a0 - T)),
      fit(bottom - top, b1 - b0 + 2 * T), fit(screen.height - top, y1 + S - (b0 - T)), fit(bottom, b1 + T - (y0 - S)));
  }
  const step = Math.min(...limits);
  // Offsets: screen position of line 1, per axis, within what the constraints allow.
  const range = (lo, hi) => ({ lo: Math.max(...lo), hi: Math.min(...hi) });
  const across = range([-(x0 - S) * step, ...tx.map(a => -(a - T) * step)],
    [screen.width - (x1 + S) * step, ...tx.map(a => screen.width - (a + T) * step)]);
  const down = range([-(y0 - S) * step, ...ty.map(b => band - (b - T) * step)],
    [screen.height - (y1 + S) * step, ...ty.map(b => screen.height - bar - (b + T) * step)]);
  const clamp = (value, { lo, hi }) => Math.max(lo, Math.min(hi, value));
  const edge = (EDGE_MARGIN + 0.5) * step;
  const left = clamp(x0 + 1 <= EDGE_LINES ? edge : x1 + 1 > size.x - EDGE_LINES ? screen.width - (size.x - 1) * step - edge
    : (screen.width - (x0 + x1) * step) / 2, across);
  // A real edge within EDGE_LINES of the stones is shown at the screen edge (the bottom one
  // may sit under the glass bar); otherwise thumb reach, the softest rule, places play low.
  const topOffset = clamp(y0 + 1 <= EDGE_LINES ? edge : y1 + 1 > size.y - EDGE_LINES ? screen.height - (size.y - 1) * step - edge
    : reach ? down.hi : down.lo, down);
  // As a fitted box: the stones' rectangle in SVG units, placed at its screen offsets.
  const scale = step / grid.step;
  const box = [grid.x + (x0 - S) * grid.step, grid.y + (y0 - S) * grid.step, (x1 - x0 + 2 * S) * grid.step, (y1 - y0 + 2 * S) * grid.step];
  return { step, fitted: { box, alignX: 'Min', alignY: 'Min', scale, offsetLeft: left + (x0 - S) * step, offsetTop: topOffset + (y0 - S) * step } };
}

// The two crops Auto-fit can use in one orientation: the stones as set up with their
// margin ('stones'), and the touch fallback ('play'): where play happens, grown back
// toward the stones' crop while the grid stays at minStep or more. No moves, no fallback.
// With screen (the whole board area, under the glass bar too) and touch (the moves
// playable next), a third candidate: the tight crop ('tight', see planTight).
export function cropCandidates({ size, stones, moves, grid, viewport, minStep = MIN_GRID_STEP, maxStep = MAX_AUTO_STEP, band = 0,
  touch, screen, bar = 0, reach = false }) {
  const whole = { left: 1, top: 1, right: size.x, bottom: size.y };
  const stepOf = b => fittedGridStep(b, size, grid, viewport, maxStep, band);
  const core = boxOf(stones.length ? stones : moves);
  if (!core) return { stones: { bounds: whole, problem: whole, source: 'whole', step: stepOf(whole) }, play: null };
  const primary = minAcross(frameAround(core, size, FRAME_MARGIN), size);
  const first = { bounds: primary, problem: playArea(core, moves, primary, size), source: 'stones', step: stepOf(primary) };
  const tight = screen && stones.length ? tightCandidate({ stones, touch: touch ?? [], size, grid, screen, band, bar, reach, maxStep, minStep }) : null;
  if (!moves.length) return { stones: first, play: null, tight };
  const touched = stones.filter(s => moves.some(m => Math.abs(m.x - s.x) + Math.abs(m.y - s.y) === 1));
  const playCore = boxOf([...moves, ...touched]);
  // Only as tight as tapping needs: from where play happens, grow back toward the stones'
  // crop a line per side at a time, for as long as the grid stays comfortable.
  const play = minAcross(frameAround(playCore, size, PLAY_MARGIN), size);
  const target = { left: Math.min(play.left, primary.left), top: Math.min(play.top, primary.top),
    right: Math.max(play.right, primary.right), bottom: Math.max(play.bottom, primary.bottom) };
  for (let grown = true; grown;) {
    grown = false;
    for (const [key, delta] of [['left', -1], ['right', 1], ['top', -1], ['bottom', 1]]) {
      if (play[key] === target[key]) continue;
      const next = { ...play, [key]: play[key] + delta };
      if (stepOf(next) >= minStep) { Object.assign(play, next); grown = true; }
    }
  }
  return { stones: first, tight, play: { bounds: play, problem: playArea(playCore, moves, play, size), source: 'play', step: stepOf(play) } };
}
function tightCandidate(options) {
  const plan = planTight(options), box = boxOf(options.stones);
  return { bounds: box, problem: boxOf(options.touch) ?? box, source: 'tight', step: plan.step, fitted: plan.fitted };
}
// The crop in one orientation: the stones' crop if its grid reaches minStep, otherwise
// whichever of the two is larger.
export function problemFrame(options) {
  const { stones, play } = cropCandidates(options), minStep = options.minStep ?? MIN_GRID_STEP;
  return stones.step >= minStep || !play || stones.step >= play.step ? stones : play;
}

// A quarter turn of a point, matching quarterTurn for bounds.
const turnPoint = (p, size) => ({ x: size.y - p.y + 1, y: p.x });
// Auto-fit's orientation and crop. stones and moves are as shown; turned says whether
// what is shown is a quarter turn of what the site drew. With S0 the stones' grid as
// the site draws it:
//   S0 >= COMFORT_STEP: leave it, no turn and no further crop.
//   MIN_GRID_STEP <= S0 < COMFORT_STEP: keep the stones' crop; turn only if that makes
//     the grid at least TURN_GAIN times larger.
//   S0 < MIN_GRID_STEP: if the stones' crop reaches MIN_GRID_STEP either way round, the
//     larger of the two; otherwise the tight crop (every stone still visible, see
//     planTight) if it reaches it; otherwise the largest crop of all, the touch fallback
//     included, each either way round.
// Only a square board on a portrait screen turns. hold is the earlier decision for this
// problem, { turned, source }, which wins near a boundary (HOLD). frame is the crop for
// the orientation as shown; free tells Random ±90° that both orientations keep every
// stone at MIN_GRID_STEP or more.
export function chooseView({ size, stones, moves, grid, viewport, band = 0, turned = false, hold = null, minStep = MIN_GRID_STEP,
  comfort = Math.max(COMFORT_STEP, minStep), gain = TURN_GAIN, maxStep = MAX_AUTO_STEP, touch, screen, bar = 0, reach = false }) {
  const options = { size, grid, viewport, band, minStep, maxStep, screen, bar, reach };
  const shown = cropCandidates({ ...options, stones, moves, touch });
  // Any square board has a turned view (Random ±90° may use it); the rules turn only on
  // a portrait screen.
  const square = size.x === size.y, portrait = viewport.width < viewport.height;
  const other = square ? cropCandidates({ ...options, stones: stones.map(p => turnPoint(p, size)), moves: moves.map(p => turnPoint(p, size)),
    touch: touch?.map(p => turnPoint(p, size)) }) : null;
  const native = turned && other ? other : shown, quarter = turned && other ? shown : other;
  const value = (isTurned, candidate) => !candidate ? 0 :
    candidate.step * (!hold ? 1 : hold.turned === isTurned && hold.source === candidate.source ? HOLD : 1 / HOLD);
  const s0 = value(false, native.stones);
  let choice;
  // Below MIN_GRID_STEP, in order: the stones' crop reaching MIN_GRID_STEP either way
  // round; else the tight crop (every stone still visible) reaching it; else the largest
  // crop of all, the touch fallback included. Within a tier, the larger grid.
  const lowest = sets => {
    const all = sets.flatMap(([isTurned, set]) => set ? [[isTurned, set.stones], [isTurned, set.tight], [isTurned, set.play]] : [])
      .filter(([, c]) => c);
    const reaching = source => all.filter(([isTurned, c]) => (c.source === source || (source === 'stones' && c.source === 'whole')) && value(isTurned, c) >= minStep);
    const pool = [reaching('stones'), reaching('tight'), all].find(tier => tier.length);
    const [best, candidate] = pool.reduce((a, b) => value(...b) > value(...a) ? b : a);
    return { turned: best, source: candidate.source === 'whole' ? 'stones' : candidate.source };
  };
  if (!quarter || !portrait) choice = s0 >= minStep ? { turned: false, source: 'stones' } : lowest([[false, native]]);
  else {
    const s1 = value(true, quarter.stones);
    if (s0 >= comfort) choice = { turned: false, source: 'stones' };
    else if (s0 >= minStep) choice = { turned: s1 >= gain * s0, source: 'stones' };
    else choice = lowest([[false, native], [true, quarter]]);
  }
  const showing = (choice.turned && !!quarter) === (turned && !!other);
  const frame = (showing ? shown[choice.source] : null) ??
    (shown.stones.step >= minStep ? shown.stones : [shown.stones, shown.tight, shown.play].filter(Boolean).reduce((a, b) => b.step > a.step ? b : a));
  const free = !!quarter && native.stones.step >= minStep && quarter.stones.step >= minStep;
  return { turned: choice.turned, source: choice.source, frame, free, shown,
    steps: { native: { stones: native.stones.step, tight: native.tight?.step ?? null, play: native.play?.step ?? null },
      turned: quarter ? { stones: quarter.stones.step, tight: quarter.tight?.step ?? null, play: quarter.play?.step ?? null } : null } };
}
// Where play happens within a crop: the core and one line around it, plus every solution move
// inside the crop. It is what
// must stay clear of the phone's menu band and of the bar, so every tap shown can be made.
export function playArea(core, moves, bounds, size) {
  const inside = moves.filter(m => m.x >= bounds.left && m.x <= bounds.right && m.y >= bounds.top && m.y <= bounds.bottom);
  // The lines next to the stones are where play happens, their liberties included.
  const near = size ? frameAround(core, size, PLAY_MARGIN) : core;
  const area = boxOf([{ x: near.left, y: near.top }, { x: near.right, y: near.bottom }, ...inside]);
  // Where the edge rule brought an edge in, the lines up to it are part of play too.
  if (size) {
    if (core.left <= EDGE_LINES) area.left = 1;
    if (core.top <= EDGE_LINES) area.top = 1;
    if (core.right > size.x - EDGE_LINES) area.right = size.x;
    if (core.bottom > size.y - EDGE_LINES) area.bottom = size.y;
  }
  return area;
}
// Follow-on: as play moves outward, the crop grows to hold every stone now on the board
// with the same margin and edge rule. It only grows during a problem, never shrinks.
export function followFrame(crop, current, size) {
  const core = boxOf(current);
  if (!core) return crop;
  const need = frameAround(core, size, FRAME_MARGIN);
  return { left: Math.min(crop.left, need.left), top: Math.min(crop.top, need.top),
    right: Math.max(crop.right, need.right), bottom: Math.max(crop.bottom, need.bottom) };
}
