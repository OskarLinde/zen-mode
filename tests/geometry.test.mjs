import test from 'node:test';
import assert from 'node:assert/strict';
import { collectGeometry, frameBounds, viewBoxFor, fitViewBox, fitForReach, fillViewport, withEdgeMargin, limitAutoFitScale, fittedGridStep, quarterTurn, randomQuarters, placeProblem, fitBoard, clearBand, drawPresentation, fullBox, gridFromOutline, requireHitCells, realEdges, svgMargin, MIN_GRID_STEP } from '../extension/geometry.mjs';
const makeNode = (size = { x: 19, y: 19 }, stones = [], marks = [], move) => ({
  children: [], move, getSize: () => size,
  getStone: (x, y) => stones.some(p => p[0] === x && p[1] === y) ? -1 : 0,
  getMarkup: (x, y) => marks.some(p => p[0] === x && p[1] === y) ? 'A' : 0
});

test('Auto-fit caps intersection spacing without losing safe geometry or real-edge alignment', () => {
  for (const size of [{ x: 19, y: 19 }, { x: 9, y: 13 }])
    for (const margin of [44, 119])
      for (const viewport of [{ width: 440, height: 884 }, { width: 820, height: 1828 }, { width: 2600, height: 1600 }])
        for (const thumb of [true, false]) {
          const grid = { x: margin, y: margin, step: 88 };
          const bounds = frameBounds(size, [{ x: 1, y: 1 }, { x: 6, y: 5 }]);
          const initial = thumb ? fitForReach(bounds, size, grid, viewport) : fitViewBox(bounds, size, grid, viewport);
          const limited = limitAutoFitScale(initial, grid, viewport);
          const filled = fillViewport(limited, size, grid, viewport);
          assert.ok(filled.scale * grid.step <= 80 + 1e-7);
          const safe = viewBoxFor(bounds, size, grid);
          const x = filled.offsetLeft + (safe[0] - filled.box[0]) * filled.scale;
          const y = filled.offsetTop + (safe[1] - filled.box[1]) * filled.scale;
          assert.ok(x >= -1e-7 && y >= -1e-7 && x + safe[2] * filled.scale <= viewport.width + 1e-7 && y + safe[3] * filled.scale <= viewport.height + 1e-7);
          if (viewport.width === 440) assert.equal(limited, initial, 'An already smaller phone view is unchanged');
        }
});

test('context margin preserves safe bounds and appears only beyond true edges', () => {
  const size = { x: 19, y: 19 }, grid = { x: 16, y: 16, step: 32 };
  for (const viewport of [{ width: 440, height: 884 }, { width: 320, height: 420 }])
    for (const bounds of [
      { left: 1, top: 1, right: 6, bottom: 8 }, { left: 14, top: 12, right: 19, bottom: 19 },
      { left: 5, top: 5, right: 10, bottom: 12 }, { left: 1, top: 1, right: 19, bottom: 19 }
    ]) {
      const safe = viewBoxFor(bounds, size, grid);
      const fit = withEdgeMargin(fitForReach(bounds, size, grid, viewport), size, grid, viewport);
      const final = fillViewport(fit, size, grid, { ...viewport, height: viewport.height + 72 });
      const left = final.offsetLeft + (safe[0] - final.box[0]) * final.scale;
      const top = final.offsetTop + (safe[1] - final.box[1]) * final.scale;
      const right = left + safe[2] * final.scale, bottom = top + safe[3] * final.scale;
      assert.ok(left >= -.01 && right <= viewport.width + .01 && top >= -.01 && bottom <= viewport.height + .01);
      const rim = grid.step * final.scale / 3;
      if (bounds.left === 1 && fit.alignX === 'Min') assert.ok(Math.abs(left - rim) < .01);
      if (bounds.right === 19 && fit.alignX === 'Max') assert.ok(Math.abs(viewport.width - right - rim) < .01);
      assert.ok(Math.abs(viewport.height - bottom - (bounds.bottom === 19 ? rim : 0)) < .01);
      assert.equal(final.scale, fit.scale, 'Extending behind glass never changes puzzle scale');
      if (bounds.left > 1 && bounds.right < 19 && safe[2] / safe[3] > viewport.width / viewport.height)
        assert.ok(final.offsetLeft < .01 && final.box[2] * final.scale >= viewport.width - .01, 'Open sides fill the screen');
    }
});
test('top and bottom margins are symmetric outside coordinate gutters, never interior crops', () => {
  const size = { x: 19, y: 19 };
  for (const gutter of [44, 119]) for (const viewport of [
    { width: 440, height: 884 }, { width: 1180, height: 500 }, { width: 2600, height: 1900 }
  ]) for (const thumb of [false, true]) for (const amount of [0, 1 / 3]) {
    const grid = { x: gutter, y: gutter, step: 88 };
    for (const bounds of [
      { left: 1, top: 1, right: 6, bottom: 8 },
      { left: 14, top: 12, right: 19, bottom: 19 },
      { left: 5, top: 5, right: 10, bottom: 12 },
      { left: 1, top: 1, right: 19, bottom: 19 }
    ]) {
      const initial = thumb ? fitForReach(bounds, size, grid, viewport) : fitViewBox(bounds, size, grid, viewport);
      const fit = withEdgeMargin(initial, size, grid, viewport, amount);
      const full = viewBoxFor({ left: 1, top: 1, right: 19, bottom: 19 }, size, grid);
      const topEdge = fit.box[1] === 0, bottomEdge = Math.abs(fit.box[1] + fit.box[3] - full[3]) < .01;
      const rim = grid.step * amount * fit.scale;
      const bottom = viewport.height - fit.offsetTop - fit.box[3] * fit.scale;
      assert.ok(fit.offsetTop >= (topEdge ? rim : 0) - 1e-7);
      assert.ok(bottom >= (bottomEdge ? rim : 0) - 1e-7);
      if (fit.alignY === 'Min') assert.ok(Math.abs(fit.offsetTop - (topEdge ? rim : 0)) < 1e-7);
      if (fit.alignY === 'Max') assert.ok(Math.abs(bottom - (bottomEdge ? rim : 0)) < 1e-7);
      if (fit.alignY === 'Mid' && topEdge && bottomEdge) assert.ok(Math.abs(fit.offsetTop - bottom) < 1e-7);
      const final = fillViewport(limitAutoFitScale(fit, grid, viewport), size, grid, viewport);
      assert.ok(final.scale * grid.step <= 80 + 1e-7);
      assert.ok(final.box[0] >= 0 && final.box[1] >= 0 && final.box[0] + final.box[2] <= full[2] + 1e-7 && final.box[1] + final.box[3] <= full[3] + 1e-7);
      const safe = viewBoxFor(bounds, size, grid);
      const left = final.offsetLeft + (safe[0] - final.box[0]) * final.scale;
      const top = final.offsetTop + (safe[1] - final.box[1]) * final.scale;
      assert.ok(left >= -1e-7 && top >= -1e-7 && left + safe[2] * final.scale <= viewport.width + 1e-7 && top + safe[3] * final.scale <= viewport.height + 1e-7);
      if (topEdge) assert.ok(final.offsetTop >= grid.step * amount * final.scale - 1e-7);
      if (final.offsetTop > 1e-7) assert.equal(final.box[1], 0, 'Mat appears only outside the real top edge');
    }
  }
});
function assertInputVisible(result, grid, viewport, points) {
  const [, y, width, height] = result.box;
  const scale = Math.min(viewport.width / width, (viewport.height - result.offsetTop) / height);
  const align = (space, a) => a === 'Min' ? 0 : a === 'Max' ? space : space / 2;
  const ys = points.map(p => p.y);
  const top = (grid.y + (Math.min(...ys) - 1.5) * grid.step - y) * scale + result.offsetTop +
    (result.offsetLeft === undefined ? align(viewport.height - result.offsetTop - height * scale, result.alignY) : 0);
  const bottom = top + (Math.max(...ys) - Math.min(...ys) + 1) * grid.step * scale;
  assert.ok(top >= -.01, 'Whole input rectangle remains visible');
  assert.ok(bottom <= viewport.height + .01, 'Whole input rectangle remains above the controls');
}
function assertPlacement(result, bounds, size, grid, viewport) {
  const safe = viewBoxFor(bounds, size, grid), [x,y,w,h] = result.box;
  const scale = Math.min(viewport.width / w, (viewport.height - result.offsetTop) / h);
  const expectedScale = Math.min(viewport.width / safe[2], viewport.height / safe[3]);
  assert.ok(Math.abs(scale - expectedScale) < 1e-7, 'Largest scale that retains the safe rectangle');
  const left = result.offsetLeft + (safe[0] - x) * scale;
  const top = result.offsetTop + (safe[1] - y) * scale;
  const spare = viewport.width - safe[2] * scale;
  const expectedLeft = bounds.left === 1 && bounds.right < size.x ? 0 : bounds.right === size.x && bounds.left > 1 ? spare : spare / 2;
  assert.ok(Math.abs(left - expectedLeft) < .001, 'Contained side edge anchors horizontally; otherwise center the rectangle');
  assert.ok(Math.abs(top + safe[3] * scale - viewport.height) < .001, 'Safe rectangle is as low as possible');
  assert.ok(top >= -.001);
  if (viewport.height / safe[3] <= viewport.width / safe[2]) assert.ok(Math.abs(top) < .001, 'Height-limited positions have no vertical margin');
}
test('all branches, later setup, labels, and variation moves are retained', () => {
  const root = makeNode(undefined, [[1, 1]], [[18, 18]]);
  root.children = [makeNode(undefined, [[4, 3]], [], { x: 12, y: 9 }), makeNode(undefined, [], [], { x: 17, y: 16 })];
  const g = collectGeometry(root);
  for (const [x, y] of [[1, 1], [18, 18], [4, 3], [12, 9], [17, 16]])
    assert.ok(g.points.some(p => p.x === x && p.y === y));
  assert.deepEqual(frameBounds(g.size, g.points), { left: 1, top: 1, right: 19, bottom: 19 });
});
test('corner preserves true edges and generous move space', () => {
  const b = frameBounds({ x: 19, y: 19 }, [{ x: 2, y: 2 }, { x: 2, y: 4 }]);
  assert.deepEqual(b, { left: 1, top: 1, right: 6, bottom: 5 });
});
test('small corner puzzle is not expanded to an empty eight-line board', () => {
  const b = frameBounds({ x: 19, y: 19 }, [{ x: 1, y: 2 }, { x: 2, y: 1 }, { x: 3, y: 2 }, { x: 2, y: 3 }]);
  assert.deepEqual(b, { left: 1, top: 1, right: 6, bottom: 4 });
});
test('central position keeps tight room on a tall board without distant edges', () => {
  const b = frameBounds({ x: 9, y: 13 }, [{ x: 3, y: 7 }, { x: 4, y: 6 }, { x: 5, y: 7 }, { x: 4, y: 8 }]);
  assert.deepEqual(b, { left: 1, top: 5, right: 6, bottom: 9 });
  assert.ok(Math.abs((6 - b.top) - (b.bottom - 8)) <= 1);
});
test('surrounding stones alone define the safe crop', () => {
  const ring = [[4,4],[5,4],[6,4],[4,5],[6,5],[4,6],[5,6],[6,6]];
  assert.equal(collectGeometry(makeNode(undefined, ring)).points.length, ring.length);
});
test('enclosed positions retain their complete frame at the largest fitting scale', () => {
  const stones = [];
  for (let x = 14; x <= 18; x++) for (let y = 12; y <= 17; y++)
    if (x === 14 || x === 18 || y === 12 || y === 17) stones.push([x,y]);
  const root = makeNode(undefined, stones), geometry = collectGeometry(root);
  const grid = { x: 16, y: 16, step: 32 }, viewport = { width: 440, height: 700 };
  const bounds = frameBounds(geometry.size, geometry.points), safe = viewBoxFor(bounds, geometry.size, grid);
  const fitted = fitForReach(bounds, geometry.size, grid, viewport);
  const scale = fit => Math.min(viewport.width / fit.box[2], (viewport.height - fit.offsetTop) / fit.box[3]);
  assertPlacement(fitted, bounds, geometry.size, grid, viewport);
  assert.ok(Math.abs(scale(fitted) - viewport.width / safe[2]) < 1e-7, 'Enclosed input retains the full width-limited scale');
  assert.ok(fitted.box[2] >= 6 * grid.step);
  assert.ok(fitted.box[0] <= safe[0] && fitted.box[1] <= safe[1] &&
    fitted.box[0] + fitted.box[2] >= safe[0] + safe[2] && fitted.box[1] + fitted.box[3] >= safe[1] + safe[3]);
  assertInputVisible(fitted, grid, viewport, geometry.points);
});
test('phone camera pins true corner and fills height with at least six across', () => {
  const size = { x: 19, y: 19 }, points = [{ x: 1, y: 2 }, { x: 2, y: 1 }, { x: 3, y: 2 }, { x: 2, y: 3 }];
  const grid = { x: 16, y: 16, step: 32 }, bounds = frameBounds(size, points);
  const { box, alignX, alignY } = fitViewBox(bounds, size, grid, { width: 390, height: 772 });
  assert.equal(box[0], 0); assert.equal(box[1], 0);
  assert.equal(box[2], 6 * 32);
  assert.ok(Math.abs(box[2] / box[3] - 390 / 772) < 1e-10);
  assert.equal(alignX, 'Min'); assert.equal(alignY, 'Min');
});
test('all four corners stay pinned; camera never creates board area outside the grid', () => {
  const size = { x: 19, y: 19 }, grid = { x: 16, y: 16, step: 32 };
  for (let flip = 0; flip < 4; flip++) {
    const points = [{ x: 1, y: 2 }, { x: 3, y: 4 }].map(p => ({ x: flip & 1 ? 20 - p.x : p.x, y: flip & 2 ? 20 - p.y : p.y }));
    const { box, alignX, alignY } = fitViewBox(frameBounds(size, points), size, grid, { width: 390, height: 772 });
    assert.equal(alignX, flip & 1 ? 'Max' : 'Min'); assert.equal(alignY, flip & 2 ? 'Max' : 'Min');
    assert.ok(box[0] >= 0 && box[1] >= 0 && box[0] + box[2] <= 608 && box[1] + box[3] <= 608);
  }
});
test('full-board portrait fallback stays inside the real board', () => {
  const result = fitViewBox(frameBounds({ x: 9, y: 9 }, []), { x: 9, y: 9 }, { x: 16, y: 16, step: 32 }, { width: 390, height: 772 });
  assert.deepEqual(result.box, [0, 0, 288, 288]);
});
test('thumb reach lowers upper corners with neutral margin, retaining six across and every point', () => {
  const size = { x: 19, y: 19 }, grid = { x: 16, y: 16, step: 32 }, viewport = { width: 390, height: 772 };
  const margins = [];
  for (const right of [false, true]) {
    const points = [{ x: 1, y: 2 }, { x: 2, y: 1 }, { x: 3, y: 2 }, { x: 2, y: 3 }].map(p => ({ x: right ? 20 - p.x : p.x, y: p.y }));
    const bounds = frameBounds(size, points), result = fitForReach(bounds, size, grid, viewport);
    assertPlacement(result, bounds, size, grid, viewport);
    margins.push(result.offsetTop);
    const [x, y, w, h] = result.box, scale = Math.min(viewport.width / w, (viewport.height - result.offsetTop) / h);
    assert.ok(w >= 6 * grid.step);
    assert.equal(y, 0);
    assert.ok(result.offsetTop > 0 && result.offsetTop + h * scale <= viewport.height + .001);
    assertInputVisible(result, grid, viewport, points);
    for (const p of points) {
      const px = grid.x + (p.x - 1) * grid.step, py = grid.y + (p.y - 1) * grid.step;
      assert.ok(px >= x && px <= x + w && py >= y && py <= y + h);
      assert.ok(result.offsetTop + (py - y) * scale > viewport.height * .3);
    }
  }
  assert.ok(Math.abs(margins[0] - margins[1]) < .01, 'Left and right positions use the same reach zone');
});
test('reach framing preserves all bounds on narrow, short, rectangular and widely spread puzzles', () => {
  for (const size of [{ x: 9, y: 13 }, { x: 19, y: 19 }]) {
    for (const viewport of [{ width: 320, height: 772 }, { width: 390, height: 500 }, { width: 844, height: 318 }]) {
      for (const points of [[{ x: 2, y: 2 }], [{ x: 2, y: 2 }, { x: size.x - 1, y: size.y - 1 }]]) {
        const grid = { x: 16, y: 16, step: 32 }, bounds = frameBounds(size, points);
        const safe = viewBoxFor(bounds, size, grid), result = fitForReach(bounds, size, grid, viewport);
        const [x, y, w, h] = result.box;
        assert.ok(x >= 0 && y >= 0 && x + w <= size.x * 32 + .001 && y + h <= size.y * 32 + .001);
        assert.ok(x <= safe[0] && y <= safe[1] && x + w >= safe[0] + safe[2] - .001 && y + h >= safe[1] + safe[3] - .001);
        assert.ok(w >= 6 * 32);
        assertPlacement(result, bounds, size, grid, viewport);
        assertInputVisible(result, grid, viewport, points);
      }
    }
  }
});
test('upper-right positions still lower by a row when a shorter phone moves their center below 30%', () => {
  // A four-column, six-row footprint, as in Easy Life 158/200.
  // Extents only: no problem stones or solution data are copied into this test.
  const size = { x: 19, y: 19 }, points = [{ x: 16, y: 1 }, { x: 19, y: 6 }];
  const bounds = frameBounds(size, points);
  for (const grid of [{ x: 44, y: 44, step: 88 }, { x: 119, y: 119, step: 88 }]) {
    for (const viewport of [{ width: 320, height: 510 }, { width: 390, height: 620 }, { width: 440, height: 700 }]) {
      const usual = fitViewBox(bounds, size, grid, viewport);
      const result = fitForReach(bounds, size, grid, viewport);
      const scale = Math.min(viewport.width / usual.box[2], viewport.height / usual.box[3]);
      const required = viewBoxFor(bounds, size, grid);
      assert.ok(result.offsetTop >= grid.step * scale, 'Lower by at least one row when it fits');
      assert.equal(result.box[1], 0, 'The true top edge stays intact');
      assert.equal(result.alignX, 'Max', 'The true right edge stays on the right');
      assert.ok(result.box[2] >= usual.box[2], 'Fitting the input rectangle never zooms in');
      assert.ok(result.box[3] >= required[3] - .001, 'The complete padded footprint stays visible');
      assertPlacement(result, bounds, size, grid, viewport);
      assertInputVisible(result, grid, viewport, points);
    }
  }
});
test('upper-corner reach changes smoothly across the former 30% cutoff', () => {
  const size = { x: 19, y: 19 }, grid = { x: 44, y: 44, step: 88 };
  const points = [{ x: 16, y: 1 }, { x: 19, y: 6 }], bounds = frameBounds(size, points);
  const lower = fitForReach(bounds, size, grid, { width: 440, height: 733 });
  const higher = fitForReach(bounds, size, grid, { width: 440, height: 734 });
  assert.ok(lower.offsetTop > 88 && higher.offsetTop > 88);
  assert.ok(Math.abs(lower.offsetTop - higher.offsetTop) < 2, 'A one-pixel viewport change cannot remove the margin');
});
test('width-limited central and lower rectangles also use bottom placement', () => {
  const size = { x: 19, y: 19 }, grid = { x: 16, y: 16, step: 32 }, viewport = { width: 390, height: 772 };
  for (const points of [[{ x: 10, y: 10 }], [{ x: 2, y: 18 }], [{ x: 18, y: 18 }]]) {
    const bounds = frameBounds(size, points);
    const fitted = fillViewport(fitForReach(bounds, size, grid, viewport), size, grid, viewport);
    assertPlacement(fitted, bounds, size, grid, viewport);
  }
});
test('reach places complete boards at the bottom without cropping', () => {
  const grid = { x: 16, y: 16, step: 32 }, viewport = { width: 390, height: 772 };
  for (const size of [{ x: 9, y: 9 }, { x: 19, y: 19 }, { x: 9, y: 13 }, { x: 9, y: 25 }]) {
    for (const points of [[], [{ x: 2, y: 2 }], [{ x: size.x - 1, y: size.y - 1 }]]) {
      const bounds = frameBounds(size, []), usual = fitViewBox(bounds, size, grid, viewport);
      const fitted = fitForReach(bounds, size, grid, viewport);
      assert.deepEqual(fitted.box, usual.box);
      assert.equal(fitted.alignY, 'Max');
      assertPlacement(fitted, bounds, size, grid, viewport);
      if (points.length) assertInputVisible(fitted, grid, viewport, points);
    }
  }
});
test('reach uses translation alone when the entire input rectangle fits at the original scale', () => {
  const size = { x: 19, y: 19 }, grid = { x: 16, y: 16, step: 32 }, viewport = { width: 390, height: 1000 };
  const points = [{ x: 18, y: 1 }, { x: 19, y: 3 }], bounds = frameBounds(size, points);
  const usual = fitViewBox(bounds, size, grid, viewport), fitted = fitForReach(bounds, size, grid, viewport);
  assert.equal(fitted.box[2], usual.box[2]);
  assertPlacement(fitted, bounds, size, grid, viewport);
  assertInputVisible(fitted, grid, viewport, points);
});
test('filling above a bottom-placed crop retains its scale and shows real board up to the top edge', () => {
  const size = { x: 9, y: 9 }, grid = { x: 16, y: 16, step: 32 }, viewport = { width: 390, height: 772 };
  const points = [{ x: 4, y: 4 }, { x: 6, y: 6 }], bounds = frameBounds(size, points);
  const initial = fitViewBox(bounds, size, grid, viewport);
  const positioned = fitForReach(bounds, size, grid, viewport);
  assert.equal(positioned.alignY, 'Max');
  assert.equal(positioned.box[2], initial.box[2], 'Placement retains the horizontal zoom limit');
  const filled = fillViewport(positioned, size, grid, viewport);
  const scale = Math.min(viewport.width / filled.box[2], (viewport.height - filled.offsetTop) / filled.box[3]);
  assert.ok(Math.abs(filled.offsetTop + filled.box[3] * scale - viewport.height) < .01);
  assert.equal(filled.box[1], 0);
  assertPlacement(filled, bounds, size, grid, viewport);
  assertInputVisible(filled, grid, viewport, points);
});
test('uniform reach preserves large touch targets for tall upper positions on either side', () => {
  const size = { x: 19, y: 19 }, grid = { x: 44, y: 44, step: 88 }, viewport = { width: 440, height: 700 };
  const scales = [];
  for (const right of [false, true]) {
    const flip = p => ({ x: right ? 20 - p.x : p.x, y: p.y });
    const points = [{ x: 1, y: 1 }, { x: 5, y: 7 }].map(flip);
    const input = [{ x: 1, y: 1 }, { x: 4, y: 5 }].map(flip);
    const bounds = frameBounds(size, points);
    const result = fillViewport(fitForReach(bounds, size, grid, viewport), size, grid, viewport);
    const spacing = Math.min(viewport.width / result.box[2], (viewport.height - result.offsetTop) / result.box[3]) * grid.step;
    scales.push(spacing);
    assert.ok(Math.abs(spacing - viewport.width / 6) < .001, 'Retain the largest width-limited touch targets');
    assert.ok(result.offsetTop > 0, 'The true upper edge is still lowered');
    assertPlacement(result, bounds, size, grid, viewport);
    assertInputVisible(result, grid, viewport, input);
  }
  assert.ok(Math.abs(scales[0] - scales[1]) < 1e-7, 'Mirroring cannot shrink touch targets');
});
test('a tall six-column footprint never gains empty side columns from a height constraint', () => {
  // Abstract extents of an 8-high, 6-wide case, with no puzzle data.
  const size = { x: 19, y: 19 }, grid = { x: 44, y: 44, step: 88 };
  const points = [{ x: 14, y: 11 }, { x: 19, y: 18 }];
  const input = [{ x: 16, y: 13 }, { x: 19, y: 18 }];
  const bounds = frameBounds(size, points);
  for (const viewport of [{ width: 440, height: 700 }, { width: 320, height: 510 }, { width: 450, height: 450 }]) {
    const fit = fitForReach(bounds, size, grid, viewport);
    assert.equal(fit.box[2], 7 * grid.step, 'Six columns plus one empty column, even when height limits scale');
    assert.equal(fit.box[0] + fit.box[2], 19 * grid.step, 'True right edge is retained');
    assertPlacement(fit, bounds, size, grid, viewport);
    assertInputVisible(fit, grid, viewport, input);
  }
});
test('lowered crops extend into real board above while true top edges keep neutral margin', () => {
  const size = { x: 19, y: 19 }, grid = { x: 44, y: 44, step: 88 }, viewport = { width: 440, height: 700 };
  const lowerPoints = [{ x: 14, y: 11 }, { x: 19, y: 18 }], lowerInput = [{ x: 16, y: 13 }, { x: 19, y: 18 }];
  const bounds = frameBounds(size, lowerPoints), safe = viewBoxFor(bounds, size, grid);
  const lower = fillViewport(fitForReach(bounds, size, grid, viewport), size, grid, viewport);
  assert.ok(lower.offsetTop < 1e-7, 'Real board fills the space above');
  assert.ok(lower.box[1] < safe[1], 'The crop extends upward');
  assert.equal(lower.box[1] + lower.box[3], 19 * grid.step);
  assertPlacement(lower, bounds, size, grid, viewport);
  assertInputVisible(lower, grid, viewport, lowerInput);
  const upperPoints = lowerPoints.map(p => ({ x: p.x, y: 20 - p.y }));
  const upperInput = lowerInput.map(p => ({ x: p.x, y: 20 - p.y }));
  const upper = fillViewport(fitForReach(frameBounds(size, upperPoints), size, grid, viewport), size, grid, viewport);
  assert.equal(upper.box[1], 0, 'No fake board above the true top edge');
  assert.ok(upper.offsetTop > 0);
  assertInputVisible(upper, grid, viewport, upperInput);
});
test('center crop never claims a false board edge', () => {
  const b = frameBounds({ x: 19, y: 19 }, [{ x: 10, y: 10 }]);
  assert.ok(b.left > 1 && b.top > 1 && b.right < 19 && b.bottom < 19);
  const v = viewBoxFor(b, { x: 19, y: 19 }, { x: 119, y: 119, step: 88 });
  assert.equal(v[2], 6 * 88);
  assert.equal(v[3], 3 * 88, 'Only horizontal magnification requires six intersections');
});
test('height-limited rectangles fill the height and anchor to a side edge or center horizontally', () => {
  const size = { x: 19, y: 19 };
  for (const grid of [{ x: 16, y: 16, step: 32 }, { x: 119, y: 119, step: 88 }]) {
    for (const viewport of [{ width: 390, height: 500 }, { width: 844, height: 318 }]) {
      for (const [left, right, alignX] of [[1, 6, 'Min'], [14, 19, 'Max'], [7, 12, 'Mid']]) {
        const bounds = { left, right, top: 3, bottom: 17 };
        const fitted = fitForReach(bounds, size, grid, viewport);
        assert.equal(fitted.alignX, alignX);
        assert.ok(fitted.offsetTop < 1e-7);
        assertPlacement(fitted, bounds, size, grid, viewport);
        assertPlacement(fillViewport(fitted, size, grid, viewport), bounds, size, grid, viewport);
      }
    }
  }
});
test('width-limited rectangles use the bottom even when the old reach boundary was already satisfied', () => {
  const size = { x: 19, y: 19 }, grid = { x: 16, y: 16, step: 32 }, viewport = { width: 390, height: 772 };
  for (const points of [[{ x: 10, y: 10 }], [{ x: 16, y: 15 }], [{ x: 2, y: 2 }]]) {
    const bounds = frameBounds(size, points), safe = viewBoxFor(bounds, size, grid);
    const placed = fitForReach(bounds, size, grid, viewport);
    assert.equal(placed.offsetTop, viewport.height - safe[3] * viewport.width / safe[2]);
    assertPlacement(fillViewport(placed, size, grid, viewport), bounds, size, grid, viewport);
  }
});
test('nearby edges and edges required by labels or variation moves remain in the safe rectangle', () => {
  const size = { x: 19, y: 19 }, grid = { x: 16, y: 16, step: 32 };
  for (const [x,y,edge] of [[3,9,'left'],[17,9,'right'],[9,3,'top'],[9,17,'bottom']]) {
    const bounds = frameBounds(size, [{ x, y }]);
    assert.equal(bounds[edge], ['left','top'].includes(edge) ? 1 : 19);
  }
  const root = makeNode(size, [[8,8]], [[2,9]]);
  root.children = [makeNode(size, [], [], { x: 18, y: 9 })];
  const geometry = collectGeometry(root), bounds = frameBounds(size, geometry.points);
  assert.equal(bounds.left, 1); assert.equal(bounds.right, 19);
  const viewport = { width: 390, height: 700 }, fit = fillViewport(fitForReach(bounds, size, grid, viewport), size, grid, viewport);
  assert.equal(fit.box[0], 0); assert.equal(fit.box[2], 19 * grid.step);
  assertPlacement(fit, bounds, size, grid, viewport);
});
test('invalid viewport dimensions fail instead of producing a broken camera', () => {
  const size = { x: 19, y: 19 }, grid = { x: 16, y: 16, step: 32 }, bounds = frameBounds(size, []);
  for (const viewport of [{ width: 0, height: 700 }, { width: 390, height: 0 }, { width: Infinity, height: 500 }])
    assert.throws(() => fitForReach(bounds, size, grid, viewport), /viewport/);
});
test('viewport filling extends real grid without changing scale or screen coordinates', () => {
  const align = (space, value) => value === 'Min' ? 0 : value === 'Max' ? space : space / 2;
  const transform = (fit, viewport) => {
    const [x,y,w,h] = fit.box, top = fit.offsetTop || 0;
    const scale = Math.min(viewport.width / w, (viewport.height - top) / h);
    const left = fit.offsetLeft ?? align(viewport.width - w * scale, fit.alignX);
    const yOffset = top + (fit.offsetLeft === undefined ? align(viewport.height - top - h * scale, fit.alignY) : 0);
    return [scale, left - x * scale, yOffset - y * scale];
  };
  for (const size of [{ x: 19, y: 19 }, { x: 9, y: 13 }]) for (const viewport of [{ width: 440, height: 700 }, { width: 320, height: 510 }, { width: 760, height: 400 }]) {
    const grid = { x: 16, y: 16, step: 32 }, full = viewBoxFor(frameBounds(size, []), size, grid);
    for (const points of [[{ x: 2, y: 2 }], [{ x: size.x - 1, y: 2 }], [{ x: 2, y: size.y - 1 }], [{ x: size.x - 1, y: size.y - 1 }], [{ x: 5, y: 6 }], []]) {
      const bounds = frameBounds(size, points), original = fitForReach(bounds, size, grid, viewport);
      const filled = fillViewport(original, size, grid, viewport), [scale,tx,ty] = transform(filled, viewport);
      assertPlacement(filled, bounds, size, grid, viewport);
      transform(original, viewport).forEach((value, i) => assert.ok(Math.abs(value - [scale,tx,ty][i]) < 1e-7));
      const [x,y,w,h] = filled.box;
      assert.ok(x >= 0 && y >= 0 && x + w <= full[2] + 1e-7 && y + h <= full[3] + 1e-7);
      if (filled.offsetLeft > 1e-7) assert.equal(x, 0, 'Left margin only beyond the true edge');
      if (filled.offsetTop > 1e-7) assert.equal(y, 0, 'Top margin only beyond the true edge');
      if (viewport.width - filled.offsetLeft - w * scale > 1e-7) assert.ok(Math.abs(x + w - full[2]) < 1e-7);
      if (viewport.height - filled.offsetTop - h * scale > 1e-7) assert.ok(Math.abs(y + h - full[3]) < 1e-7);
      const twice = transform(fillViewport(filled, size, grid, viewport), viewport);
      twice.forEach((value, i) => assert.ok(Math.abs(value - [scale,tx,ty][i]) < 1e-7));
    }
  }
});
test('the six-column lower position fills the left strip at its already-selected larger scale', () => {
  const size = { x: 19, y: 19 }, grid = { x: 44, y: 44, step: 88 }, viewport = { width: 440, height: 700 };
  const points = [{ x: 14, y: 11 }, { x: 19, y: 18 }], input = [{ x: 16, y: 13 }, { x: 19, y: 18 }];
  const bounds = frameBounds(size, points), positioned = fitForReach(bounds, size, grid, viewport);
  const filled = fillViewport(positioned, size, grid, viewport);
  assert.ok(filled.offsetLeft < 1e-7); assert.ok(filled.offsetTop < 1e-7);
  const scale = Math.min(viewport.width / filled.box[2], viewport.height / filled.box[3]);
  assert.ok(Math.abs(scale * grid.step - viewport.width / 7) < .001, 'Retains the width-limited scale');
  assert.ok(Math.abs(filled.box[2] / grid.step - 7) < .001, 'Needs no extra columns with the wider reach zone');
  assertPlacement(filled, bounds, size, grid, viewport);
  assertInputVisible(filled, grid, viewport, input);
});
test('size variants and empty puzzles retain all true edges', () => {
  for (const size of [{ x: 9, y: 9 }, { x: 13, y: 13 }, { x: 9, y: 19 }, { x: 19, y: 19 }]) {
    const b = frameBounds(size, []);
    assert.deepEqual(b, { left: 1, top: 1, right: size.x, bottom: size.y });
    const v = viewBoxFor(b, size, { x: 119, y: 119, step: 88 });
    assert.deepEqual(v, [0, 0, 238 + (size.x - 1) * 88, 238 + (size.y - 1) * 88]);
  }
});
test('passes add no fake corner and malformed moves fail closed', () => {
  const root = makeNode(undefined, [], [], { x: 0, y: 0 });
  assert.equal(collectGeometry(root).points.length, 0);
  root.move = { x: 20, y: 5 };
  assert.throws(() => collectGeometry(root), /coordinate/);
});
test('missing, cyclic, over-budget and mixed-size trees fall back', () => {
  assert.throws(() => collectGeometry({}), /size/);
  const root = makeNode(); root.children.push(root);
  assert.throws(() => collectGeometry(root), /tree/);
  assert.throws(() => collectGeometry(makeNode(), 100), /budget/);
  const mixed = makeNode(); mixed.children.push(makeNode({ x: 9, y: 9 }));
  assert.throws(() => collectGeometry(mixed), /geometry/);
});
test('rotated/reflected geometry remains inside framing bounds', () => {
  const size = { x: 19, y: 19 };
  for (let flip = 0; flip < 4; flip++) {
    const points = [{ x: 2, y: 3 }, { x: 4, y: 8 }].map(p => ({ x: flip & 1 ? 20 - p.x : p.x, y: flip & 2 ? 20 - p.y : p.y }));
    const b = frameBounds(size, points);
    for (const p of points) assert.ok(p.x >= b.left && p.x <= b.right && p.y >= b.top && p.y <= b.bottom);
  }
});
test('a quarter turn of bounds is exact on a square board', () => {
  const size = { x: 19, y: 19 }, b = { left: 1, top: 1, right: 16, bottom: 6 };
  assert.deepEqual(quarterTurn(b, size), { left: 14, right: 19, top: 1, bottom: 16 });
  assert.deepEqual(quarterTurn(quarterTurn(quarterTurn(quarterTurn(b, size), size), size), size), b);
});

// The board's eight symmetries, as what each does to a point that lies on no axis.
const N = 19, probe = { x: 1, y: 2 };
const clockwise = p => ({ x: N + 1 - p.y, y: p.x }), hFlip = p => ({ x: N + 1 - p.x, y: p.y }), vFlip = p => ({ x: p.x, y: N + 1 - p.y });
const turns = (n, p) => { for (let i = 0; i < n; i++) p = clockwise(p); return p; };
const counter = p => turns(3, p);
const id = p => p, rotate180 = p => hFlip(vFlip(p));
const label = p => `${p.x},${p.y}`;
const allEight = () => { const seen = new Set(); for (let n = 0; n < 4; n++) for (const flip of [id, hFlip]) seen.add(label(turns(n, flip(probe)))); return seen; };
function outcomes(draws, quarters) {
  const counts = new Map();
  for (const draw of draws) for (let pick = 0; pick < 4; pick++) {
    const key = label(turns(quarters(pick), draw(probe)));
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}
const assertEven = (counts, size) => {
  assert.equal(counts.size, size, 'Every orientation is reachable');
  assert.equal(new Set(counts.values()).size, 1, `Equal odds: ${[...counts.values()]}`);
};

const regular = [id, hFlip, vFlip, rotate180], topBottom = [id, vFlip], leftRight = [id, hFlip];
const grid19 = { x: 119, y: 119, step: 88 }, size19 = { x: 19, y: 19 };
const spec = (bounds, viewport, halfBoard) => pick => randomQuarters({ bounds, size: size19, grid: grid19, viewport, pick, halfBoard });
const compact = { left: 1, top: 1, right: 9, bottom: 7 }, wide = { left: 1, top: 1, right: 19, bottom: 5 };
const phone = { width: 390, height: 680 }, landscape = { width: 680, height: 390 }, desktop = { width: 1440, height: 900 };

test('the eight symmetries are distinct, so counting them proves the group', () => {
  assert.equal(allEight().size, 8);
});

test('a free regular board reaches all 8 with equal odds and turns half the time', () => {
  const quarters = spec(compact, phone, false);
  assertEven(outcomes(regular, quarters), 8);
  assert.deepEqual([0, 1, 2, 3].map(quarters), [0, 1, 0, 3], 'Half the picks turn, in either direction');
});

test('a free half board also reaches all 8 with equal odds, regaining the folded mirror', () => {
  const quarters = spec(wide, desktop, true);
  assertEven(outcomes(topBottom, quarters), 8);
  assertEven(outcomes(leftRight, quarters), 8);
});

test('a forced turn reaches the four orientations of that shape with equal odds', () => {
  for (const [draws, halfBoard] of [[topBottom, true], [regular, false]]) {
    const quarters = spec(wide, phone, halfBoard);
    assert.deepEqual([0, 1, 2, 3].map(quarters), [1, 1, 3, 3], 'Random direction, never unturned');
    assertEven(outcomes(draws, quarters), 4);
  }
});

test('when the native shape fits better it stays that shape, evenly', () => {
  const quarters = spec(wide, landscape, true);
  assert.deepEqual([0, 1, 2, 3].map(quarters), [0, 0, 2, 2]);
  assertEven(outcomes(topBottom, quarters), 4);
  assertEven(outcomes(regular, spec(wide, landscape, false)), 4);
});

test('the site auto-rotating first does not skew the result', () => {
  const tall = { left: 1, top: 1, right: 7, bottom: 16 };
  const autoRotated = draws => draws.map(draw => p => counter(draw(p)));
  assertEven(outcomes(autoRotated(regular), spec(compact, phone, false)), 8);
  assertEven(outcomes(autoRotated(leftRight), spec(wide, phone, true)), 4);
  assertEven(outcomes(autoRotated(regular), spec(tall, landscape, false)), 4);
});

test('non-square boards never turn, and the pick is stable across a width change', () => {
  assert.equal(randomQuarters({ bounds: wide, size: { x: 19, y: 13 }, grid: grid19, viewport: phone, pick: 3 }), 0);
  const shown = quarterTurn(wide, size19);
  for (let pick = 0; pick < 4; pick++)
    assert.equal(randomQuarters({ bounds: shown, size: size19, grid: grid19, viewport: phone, turned: true, pick, halfBoard: true }),
      spec(wide, phone, true)(pick), 'The same load keeps its direction');
});

// Screen edges of the whole board and the centre of the problem, after placing.
function placedAt(problem, viewport, { margin = 80 / 3, scale = 80 / 88, reach = false, alignX = 'Min', alignY = 'Min' } = {}) {
  const box = viewBoxFor(problem, size19, grid19), full = viewBoxFor({ left: 1, top: 1, right: 19, bottom: 19 }, size19, grid19);
  const before = box[0] === 0 ? margin : 0, up = box[1] === 0 ? margin : 0;
  const placed = placeProblem({ box, alignX, alignY, scale, offsetLeft: before, offsetTop: up }, problem, size19, grid19, viewport, { margin, reach });
  const boardLeft = placed.offsetLeft - box[0] * scale, boardTop = placed.offsetTop - box[1] * scale, step = grid19.step * scale;
  return { placed, boardLeft, boardRight: viewport.width - boardLeft - full[2] * scale, boardTop, boardBottom: viewport.height - boardTop - full[3] * scale,
    centreX: boardLeft + (grid19.x + (problem.left + problem.right - 2) / 2 * grid19.step) * scale,
    centreY: boardTop + (grid19.y + (problem.top + problem.bottom - 2) / 2 * grid19.step) * scale, step };
}
const corner = { left: 1, top: 1, right: 9, bottom: 7 }, side = { left: 6, top: 1, right: 14, bottom: 7 }, wholeBoard = { left: 1, top: 1, right: 19, bottom: 19 };

test('a board too big for the view centres the problem in the spare room', () => {
  const p = placedAt(corner, { width: 1440, height: 800 });
  assert.ok(Math.abs(p.centreX - 720) < .01 && Math.abs(p.centreY - 400) < .01, JSON.stringify(p));
});

test('with no spare room the safe rectangle stays where it was', () => {
  const box = viewBoxFor(corner, size19, grid19), scale = 390 / box[2], viewport = { width: 390, height: box[3] * scale };
  const placed = placeProblem({ box, alignX: 'Min', alignY: 'Min', scale, offsetLeft: 0, offsetTop: 0 }, corner, size19, grid19, viewport);
  assert.equal(placed.offsetLeft, 0); assert.equal(placed.offsetTop, 0);
});

test('a board that fits leans towards the problem but its margins never look lopsided', () => {
  const p = placedAt(corner, { width: 1920, height: 1800 }), side1 = Math.min(p.boardLeft, p.boardRight), side2 = Math.max(p.boardLeft, p.boardRight);
  const equal = (p.boardLeft + p.boardRight) / 2;
  assert.ok(p.boardLeft > p.boardRight, 'Leans so the corner problem moves towards the centre');
  assert.ok(side1 >= equal / 2 - .01, 'Nearer margin keeps half the equal one');
  assert.ok(side2 <= equal * 1.5 + .01);
});

test('a board that only just fits keeps at least the true-edge margin', () => {
  const margin = 80 / 3, full = viewBoxFor(wholeBoard, size19, grid19)[2] * 80 / 88;
  const p = placedAt(corner, { width: full + 2 * margin + 10, height: 1800 });
  assert.ok(Math.min(p.boardLeft, p.boardRight) >= margin - .01, JSON.stringify(p));
});

test('Full board is exactly centred, and the true-edge margin never leaves one side larger', () => {
  const p = placedAt(wholeBoard, { width: 1920, height: 1800 });
  assert.ok(Math.abs(p.boardLeft - p.boardRight) < .01 && Math.abs(p.boardTop - p.boardBottom) < .01, JSON.stringify(p));
});

test('thumb reach keeps its bottom placement unless the whole board fits', () => {
  const kept = placedAt(corner, { width: 390, height: 680 }, { reach: true });
  assert.equal(kept.placed.offsetTop, 80 / 3, 'Unchanged');
  const small = 300 / viewBoxFor(wholeBoard, size19, grid19)[2], fits = placedAt(wholeBoard, { width: 390, height: 680 }, { reach: true, scale: small, margin: 0 });
  assert.ok(Math.abs(fits.boardTop - fits.boardBottom) < .01);
});

test('a mirrored problem places as the mirror image', () => {
  const left = placedAt(corner, { width: 1440, height: 800 }), right = placedAt({ left: 11, top: 1, right: 19, bottom: 7 }, { width: 1440, height: 800 });
  assert.ok(Math.abs(left.centreX - right.centreX) < .01, `${left.centreX} ${right.centreX}`);
});

test('a side problem stays centred on its axis', () => {
  const p = placedAt(side, { width: 1920, height: 800 });
  assert.ok(Math.abs(p.boardLeft - p.boardRight) < .01, JSON.stringify(p));
});

const outline = { x: 20, y: 20, width: 180, height: 180 }, smallBoard = { x: 10, y: 10 }, smallGrid = { x: 20, y: 20, step: 20 };
const cellsFor = size => Array.from({ length: size.x * size.y }, (_, i) => ({ x: 10 + i % size.x * 20, y: 10 + Math.floor(i / size.x) * 20, width: 20, height: 20 }));

test('the grid comes from the outline, and an unusual outline is refused', () => {
  assert.deepEqual(gridFromOutline(outline, smallBoard), smallGrid);
  assert.throws(() => gridFromOutline({ ...outline, height: 90 }, smallBoard), /grid geometry/);
  assert.throws(() => gridFromOutline({ ...outline, x: 2 }, smallBoard), /grid geometry/);
  assert.throws(() => gridFromOutline({ ...outline, width: NaN }, smallBoard), /grid geometry/);
});

test('every intersection needs a hit cell', () => {
  const cells = cellsFor(smallBoard);
  assert.doesNotThrow(() => requireHitCells(cells, smallGrid, smallBoard));
  assert.throws(() => requireHitCells(cells.slice(1), smallGrid, smallBoard), /Incomplete hit grid/);
  assert.throws(() => requireHitCells(cells.map((c, i) => i ? c : { ...c, x: c.x + 3 }), smallGrid, smallBoard), /Incomplete hit grid/);
  assert.doesNotThrow(() => requireHitCells([...cells, { x: 0, y: 0, width: 5, height: 5 }], smallGrid, smallBoard), 'Other rects are ignored');
});

test('real edges are the sides where the visible board meets the full board', () => {
  const matrix = { e: 10, f: 20 }, surface = { top: 20, right: 310, bottom: 200, left: 40 };
  assert.deepEqual(realEdges(surface, matrix, 300, 300), [true, true, false, false]);
});

test('the SVG margin follows settled offsets, with the edge margin at real edges', () => {
  const grid19 = { x: 119, y: 119, step: 88 }, size = { x: 19, y: 19 }, full = 2 * 119 + 18 * 88;
  const common = { grid: grid19, size, scale: 1, viewport: { width: 1000, height: 800 }, edgeMargin: 10 };
  assert.equal(svgMargin({ ...common, fitted: { offsetLeft: 30, offsetTop: 40 }, view: [0, 0, full, full], zoom: 1 }), '40px 10px 10px 30px');
  assert.equal(svgMargin({ ...common, fitted: { offsetLeft: 30, offsetTop: 40 }, view: [5, 5, 100, 100], zoom: 1 }), '40px 0px 0px 30px');
  assert.equal(svgMargin({ ...common, fitted: { offsetLeft: 30, offsetTop: 0 }, view: [0, 0, full, full], zoom: 2 }), '10px 20px 20px 40px');
  assert.equal(svgMargin({ ...common, fitted: { alignX: 'Min', alignY: 'Max', offsetTop: 0 }, view: [0, 0, 100, 100], zoom: 1 }), 'auto auto 0px 0px');
});

const fit19 = { size: size19, grid: grid19 };
test('fitBoard keeps the crop for Site view and caps Auto-fit', () => {
  const site = fitBoard({ ...fit19, bounds: corner, viewport: { width: 1440, height: 800 }, framing: 'site' });
  assert.deepEqual(site, { ...fitViewBox(corner, size19, grid19, { width: 1440, height: 800 }), offsetTop: 0 });
  const auto = fitBoard({ ...fit19, bounds: corner, viewport: { width: 1440, height: 800 }, framing: 'frame', margin: true });
  assert.ok(Math.abs(auto.scale * grid19.step - 80) < .01);
  const full = fitBoard({ ...fit19, bounds: { left: 1, top: 1, right: 19, bottom: 19 }, viewport: { width: 1440, height: 800 }, framing: 'full', margin: true });
  assert.equal(full.box[2], fullBox(size19, grid19)[2]);
});

test('fitBoard skips placement once zoomed, and thumb reach stays low on a phone', () => {
  const viewport = { width: 390, height: 680 };
  const reach = fitBoard({ ...fit19, bounds: corner, viewport, framing: 'frame', thumb: true, margin: true });
  const plain = fitBoard({ ...fit19, bounds: corner, viewport, framing: 'frame', margin: true });
  assert.ok(reach.offsetTop >= plain.offsetTop);
  const wide = { width: 1440, height: 800 };
  const zoomed = fitBoard({ ...fit19, bounds: corner, viewport: wide, framing: 'frame', margin: true, zoom: 1.5 });
  const placed = fitBoard({ ...fit19, bounds: corner, viewport: wide, framing: 'frame', margin: true });
  assert.notEqual(zoomed.offsetLeft, placed.offsetLeft);
});

test('fitBoard extends real grid under a glass bar without moving the board', () => {
  const viewport = { width: 390, height: 680 }, args = { ...fit19, bounds: side, viewport, framing: 'frame', margin: true };
  const solid = fitBoard(args), glass = fitBoard({ ...args, glassHeight: 760 });
  assert.equal(glass.scale, solid.scale); assert.equal(glass.offsetLeft, solid.offsetLeft);
  assert.ok(glass.box[3] >= solid.box[3]);
});


// The phone's top band: ☰ and the hearts, 12 px from the top, 44 px tall, plus an 8 px tap margin.
const BAND = 64;
const tileTopOnScreen = (fitted, problem, grid) => fitted.offsetTop + (grid.y + (problem.top - 1.5) * grid.step - fitted.box[1]) * fitted.scale;
const bottomOnScreen = (fitted, keep, size, grid) => { const b = viewBoxFor(keep, size, grid); return fitted.offsetTop + (b[1] + b[3] - fitted.box[1]) * fitted.scale; };

test('no tap tile of the problem sits under the phone band, in every placement', () => {
  const placements = { corner, side, turnedCorner: quarterTurn(corner, size19), turnedSide: quarterTurn(side, size19),
    rightCorner: { left: 11, top: 1, right: 19, bottom: 7 }, low: { left: 1, top: 9, right: 9, bottom: 19 }, centre: { left: 5, top: 6, right: 14, bottom: 13 } };
  for (const viewport of [{ width: 320, height: 500 }, { width: 390, height: 680 }, { width: 430, height: 760 }])
    for (const [name, problem] of Object.entries(placements))
      for (const thumb of [false, true]) for (const margin of [false, true]) for (const full of [false, true]) {
        const bounds = full ? wholeBoard : problem, label = `${name} ${viewport.width} thumb ${thumb} margin ${margin} full ${full}`;
        const fitted = fitBoard({ ...fit19, bounds, problem, viewport, framing: full ? 'full' : 'frame', thumb, margin, band: BAND });
        assert.ok(tileTopOnScreen(fitted, problem, grid19) >= BAND - .01, label + ': clear of the band');
        assert.ok(bottomOnScreen(fitted, bounds, size19, grid19) <= viewport.height + .01, label + ': what must stay visible stays visible');
        const plain = fitBoard({ ...fit19, bounds, problem, viewport, framing: full ? 'full' : 'frame', thumb, margin });
        assert.ok(fitted.scale <= plain.scale + 1e-9, label + ': the band never enlarges the board');
      }
});

test('the band moves the board before it shrinks it, and does nothing without a band', () => {
  const viewport = { width: 390, height: 680 }, args = { ...fit19, bounds: corner, viewport, framing: 'frame', margin: true };
  // A short corner problem leaves room below: moving it down is enough.
  const plain = fitBoard(args), banded = fitBoard({ ...args, band: BAND });
  assert.ok(tileTopOnScreen(plain, corner, grid19) < BAND, 'the fixture starts under the band');
  assert.equal(banded.scale, plain.scale); assert.equal(banded.offsetLeft, plain.offsetLeft);
  // Thumb reach already sits at the bottom: the only way out is a smaller scale, still bottom aligned.
  const tall = { left: 1, top: 1, right: 6, bottom: 12 }, high = { ...args, bounds: tall, thumb: true };
  const reach = fitBoard(high), reachBanded = fitBoard({ ...high, band: BAND });
  assert.ok(reachBanded.scale < reach.scale);
  assert.ok(Math.abs(tileTopOnScreen(reachBanded, tall, grid19) - BAND) < .01, 'shrinks exactly to the band');
  const placed = placeProblem({ ...fitViewBox(corner, size19, grid19, viewport), offsetTop: 0 }, corner, size19, grid19, viewport);
  assert.equal(clearBand(placed, { keep: corner, problem: corner, size: size19, grid: grid19, viewport }), placed);
  assert.deepEqual(fitBoard({ ...args, band: 0 }), plain);
});

test('the turn decision measures the same step the band lets the fit use', () => {
  for (const viewport of [{ width: 320, height: 500 }, { width: 390, height: 680 }, { width: 430, height: 760 }])
    for (const bounds of [corner, quarterTurn(corner, size19), { left: 1, top: 1, right: 13, bottom: 9 }]) {
      const fitted = fitBoard({ ...fit19, bounds, viewport, framing: 'frame', thumb: true, band: BAND });
      const step = fittedGridStep(bounds, size19, grid19, viewport, Infinity, BAND);
      assert.ok(Math.abs(fitted.scale * grid19.step - Math.min(step, 80)) < .01, JSON.stringify([viewport, bounds]));
      assert.ok(step <= fittedGridStep(bounds, size19, grid19, viewport, Infinity) + 1e-9);
    }
  const wide = { left: 1, top: 1, right: 12, bottom: 7 }, viewport = { width: 320, height: 500 };
  const there = fittedGridStep(quarterTurn(wide, size19), size19, grid19, viewport, 80, BAND);
  assert.ok(there < fittedGridStep(quarterTurn(wide, size19), size19, grid19, viewport), 'a turned problem pays for the band');
});

// Reset with no move made: every combination of corner, colour and quarter pick, each
// drawn once through drawPresentation, against the corners the site offers.
function presentations(corners, colours, quarters) {
  const counts = new Map();
  for (let c = 0; c < corners.length; c++) for (let k = 0; k < colours; k++) for (let q = 0; q < 4; q++) {
    const values = [(c + .5) / corners.length, (k + .5) / colours, (q + .5) / 4];
    const draw = drawPresentation({ corners: corners.length, colours, random: () => values.shift() });
    assert.deepEqual([draw.corner, draw.colour, draw.quarters], [c, k, q], 'Each draw maps to one combination');
    const key = `${label(turns(quarters(draw.quarters), corners[draw.corner](probe)))} ${draw.colour}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

test('Reset shows every available presentation with equal odds, never the current one', () => {
  const cases = [
    ['regular, Random on', regular, spec(compact, phone, false), 16],
    ['regular, Random on, turn forced', regular, spec(wide, phone, false), 8],
    ['regular, Random off', regular, () => 0, 8],
    ['regular, Random off, fit turns it', regular, () => 1, 8],
    ['half board, Random on', topBottom, spec(wide, desktop, true), 16],
    ['half board, Random off', leftRight, () => 0, 4],
    ['no colour control', regular, () => 0, 4, 1]];
  for (const [name, corners, quarters, size, colours = 2] of cases) {
    const counts = presentations(corners, colours, quarters);
    assertEven(counts, size);
    // Redrawing until the result differs leaves the others equally likely.
    for (const current of counts.keys()) {
      const rest = [...counts].filter(([key]) => key !== current).map(([, n]) => n);
      assert.equal(new Set(rest).size, 1, `${name}: equal odds after leaving out ${current}`);
      assert.equal(rest.length, size - 1, `${name}: the current one is never shown again`);
    }
  }
  for (const random of [() => 0, () => .999999]) {
    const draw = drawPresentation({ corners: 4, colours: 2, random });
    assert.ok(draw.corner >= 0 && draw.corner < 4 && draw.colour >= 0 && draw.colour < 2 && draw.quarters >= 0 && draw.quarters < 4);
  }
});

// Auto-fit policy: stones plus a margin, centred; edges only when a stone is near them.
import { problemFrame, followFrame, frameAround, minAcross, MIN_ACROSS, chooseView, followView, COMFORT_STEP, TURN_GAIN, planTight, EDGE_MARGIN, FRAME_MARGIN, EDGE_LINES, PLAY_MARGIN } from '../extension/geometry.mjs';
const S19 = { x: 19, y: 19 }, G19 = { x: 44, y: 44, step: 88 }, PHONE = { width: 390, height: 684 };
const block = (x0, x1, y0, y1) => { const out = []; for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push({ x, y }); return out; };

test('a centred problem is cropped to its stones and margin, with no board edge, whatever its moves', () => {
  // Easy Capture 10/200: stones in columns 8-12, rows 6-10. Its answer (9-6) captures two stones in
  // three moves, but the tree also records a second correct start (10-6) that ladders to the corner.
  const stones = block(8, 12, 6, 10), moves = [[10, 6], [9, 5], [8, 4], [5, 3], [3, 1]].map(([x, y]) => ({ x, y }));
  const frame = problemFrame({ size: S19, stones, moves, grid: G19, viewport: PHONE });
  assert.equal(frame.source, 'stones');
  assert.deepEqual(frame.bounds, { left: 8 - FRAME_MARGIN, top: 6 - FRAME_MARGIN, right: 12 + FRAME_MARGIN, bottom: 10 + FRAME_MARGIN });
  assert.ok(frame.step >= MIN_GRID_STEP);
});

test('a stone within EDGE_LINES of a side brings that edge into view, and only then', () => {
  for (let line = 1; line <= 6; line++) {
    const near = line <= EDGE_LINES;
    const box = frameAround({ left: line, top: 9, right: 12, bottom: 11 }, S19, FRAME_MARGIN);
    assert.equal(box.left === 1, near || line - FRAME_MARGIN <= 1, `left, stone on line ${line}`);
    const right = frameAround({ left: 8, top: 9, right: 20 - line, bottom: 11 }, S19, FRAME_MARGIN);
    assert.equal(right.right === 19, near || 20 - line + FRAME_MARGIN >= 19, `right, stone on line ${line}`);
    const top = frameAround({ left: 8, top: line, right: 12, bottom: 11 }, S19, FRAME_MARGIN);
    assert.equal(top.top === 1, near || line - FRAME_MARGIN <= 1, `top, stone on line ${line}`);
    const bottom = frameAround({ left: 8, top: 9, right: 12, bottom: 20 - line }, S19, FRAME_MARGIN);
    assert.equal(bottom.bottom === 19, near || 20 - line + FRAME_MARGIN >= 19, `bottom, stone on line ${line}`);
  }
  // A corner problem shows both of its edges.
  assert.deepEqual(frameAround({ left: 1, top: 2, right: 5, bottom: 4 }, S19, FRAME_MARGIN), { left: 1, top: 1, right: 7, bottom: 6 });
});

test('the touch fallback crops to where play happens only when the stones need too small a grid', () => {
  // A wide setup across the board with local play in the corner.
  const stones = [...block(2, 18, 3, 3), ...block(2, 18, 9, 9), { x: 3, y: 15 }, { x: 4, y: 16 }];
  const moves = [{ x: 2, y: 17 }, { x: 3, y: 17 }, { x: 4, y: 17 }];
  const frame = problemFrame({ size: S19, stones, moves, grid: G19, viewport: PHONE });
  const stonesOnly = problemFrame({ size: S19, stones, moves: [], grid: G19, viewport: PHONE });
  assert.ok(stonesOnly.step < MIN_GRID_STEP, 'the fixture is too wide for touch');
  assert.equal(frame.source, 'play');
  assert.ok(frame.step > stonesOnly.step);
  assert.ok(moves.every(m => m.x >= frame.bounds.left && m.x <= frame.bounds.right && m.y >= frame.bounds.top && m.y <= frame.bounds.bottom));
  assert.equal(frame.bounds.left, 1); assert.equal(frame.bounds.bottom, 19); // near the edges: they show
  // A comfortable problem never uses the fallback, however far its moves go.
  assert.equal(problemFrame({ size: S19, stones: block(4, 7, 4, 6), moves, grid: G19, viewport: PHONE }).source, 'stones');
  assert.equal(PLAY_MARGIN < FRAME_MARGIN, true);
});

test('follow-on framing only grows, to hold every stone now on the board', () => {
  const crop = { left: 6, top: 4, right: 14, bottom: 12 };
  assert.deepEqual(followFrame(crop, block(8, 12, 6, 10), S19), crop, 'nothing near an edge: unchanged');
  const chased = followFrame(crop, [...block(8, 12, 6, 10), { x: 6, y: 5 }], S19);
  assert.deepEqual(chased, { left: 4, top: 3, right: 14, bottom: 12 });
  const toEdge = followFrame(chased, [{ x: 3, y: 2 }], S19);
  assert.equal(toEdge.left, 1); assert.equal(toEdge.top, 1);
  assert.deepEqual(followFrame(toEdge, [{ x: 10, y: 10 }], S19), toEdge, 'never shrinks');
});

test('the play area kept clear of the band holds every solution move inside the crop', () => {
  const stones = block(8, 12, 6, 10), moves = [{ x: 9, y: 5 }, { x: 7, y: 8 }, { x: 3, y: 1 }];
  const frame = problemFrame({ size: S19, stones, moves, grid: G19, viewport: PHONE });
  assert.deepEqual(frame.problem, { left: 7, top: 5, right: 13, bottom: 11 }, 'the stones, one line round them, and moves in the crop; not the far one');
  // Near an edge, the lines up to it are play: a corner problem's area reaches its edges.
  const corner = problemFrame({ size: S19, stones: block(2, 5, 3, 4), moves: [], grid: G19, viewport: PHONE });
  assert.deepEqual(corner.problem, { left: 1, top: 1, right: 6, bottom: 5 });
});

test('the touch fallback is only as tight as tapping needs, growing back toward the stones', () => {
  // Easy Life 1/200 in one orientation: a group along the bottom, too wide for 320 px with its margin.
  const stones = [...block(3, 9, 18, 18), ...block(4, 8, 17, 17), { x: 3, y: 19 }], moves = [{ x: 5, y: 19 }, { x: 6, y: 19 }, { x: 7, y: 18 }];
  const narrow = { width: 320, height: 440 };
  const frame = problemFrame({ size: S19, stones, moves, grid: G19, viewport: narrow });
  assert.equal(frame.source, 'play');
  assert.ok(frame.step >= MIN_GRID_STEP, 'comfortable to tap');
  const wider = ['left', 'right', 'top', 'bottom'].map(key => ({ ...frame.bounds, [key]: frame.bounds[key] + (key === 'left' || key === 'top' ? -1 : 1) }))
    .filter(b => b.left >= 1 && b.top >= 1 && b.right <= 19 && b.bottom <= 19 && b.left >= 1);
  const primary = problemFrame({ size: S19, stones, moves: [], grid: G19, viewport: narrow }).bounds;
  const inside = b => b.left >= primary.left && b.top >= primary.top && b.right <= primary.right && b.bottom <= primary.bottom;
  assert.ok(wider.filter(inside).every(b => fittedGridStep(b, S19, G19, narrow) < MIN_GRID_STEP), 'no side could grow without going below the minimum');
  assert.ok(frame.bounds.right - frame.bounds.left >= 6, 'the group stays mostly in view: ' + JSON.stringify(frame.bounds));
});

test('the stones-first crop keeps at least six lines across', () => {
  // A small corner group: columns 1-2 plus the margin is 4 across, widened to 6.
  const corner = problemFrame({ size: S19, stones: block(1, 2, 1, 2), moves: [{ x: 3, y: 1 }], grid: G19, viewport: PHONE });
  assert.equal(corner.bounds.left, 1);
  assert.ok(corner.bounds.right - corner.bounds.left + 1 >= MIN_ACROSS, JSON.stringify(corner.bounds));
  // A single stone in the open: 5 across, widened on both sides in turn and still centred.
  const open = problemFrame({ size: S19, stones: [{ x: 10, y: 10 }], moves: [], grid: G19, viewport: PHONE });
  assert.equal(open.bounds.right - open.bounds.left + 1, MIN_ACROSS);
  assert.ok(Math.abs((open.bounds.left + open.bounds.right) / 2 - 10) <= .5, JSON.stringify(open.bounds));
  // Widening that stops a line short of an edge takes the edge in.
  assert.deepEqual(minAcross({ left: 4, top: 1, right: 7, bottom: 5 }, S19), { left: 3, top: 1, right: 8, bottom: 5 });
  assert.deepEqual(minAcross({ left: 14, top: 1, right: 17, bottom: 5 }, S19), { left: 13, top: 1, right: 19, bottom: 5 });
  // Wider crops and small boards are left alone.
  assert.deepEqual(minAcross({ left: 6, top: 4, right: 14, bottom: 12 }, S19), { left: 6, top: 4, right: 14, bottom: 12 });
  assert.deepEqual(minAcross({ left: 1, top: 1, right: 5, bottom: 5 }, { x: 5, y: 5 }), { left: 1, top: 1, right: 5, bottom: 5 });
});

// The orientation and crop rule, checked against its own statement for many shapes, and
// on a real problem (Easy Life 7/200, its geometry as the site drew it).
const sheet = (x0, x1, y0, y1) => block(x0, x1, y0, y1);
test('chooseView follows the three bands, and every band is reached', () => {
  const seen = new Set();
  for (const viewport of [{ width: 320, height: 496 }, { width: 390, height: 772 }, { width: 440, height: 884 }])
    for (let width = 2; width <= 17; width++) for (let height = 1; height <= 6; height++) for (const top of [1, 7]) {
      const stones = sheet(2, 1 + width, top, top + height - 1), moves = [{ x: 2 + Math.floor(width / 2), y: top + height }];
      const view = chooseView({ size: S19, stones, moves, grid: G19, viewport, band: 52 });
      const { native, turned } = view.steps, tag = JSON.stringify({ viewport, width, height, top, steps: view.steps });
      if (native.stones >= COMFORT_STEP) { seen.add('comfort'); assert.ok(!view.turned && view.source === 'stones', tag); }
      else if (native.stones >= MIN_GRID_STEP) {
        seen.add(view.turned ? 'middle-turn' : 'middle-keep');
        assert.equal(view.source, 'stones', tag); assert.equal(view.turned, turned.stones >= TURN_GAIN * native.stones, tag);
      } else if (Math.max(native.stones, turned.stones) >= MIN_GRID_STEP) {
        seen.add('low-stones'); assert.equal(view.source, 'stones', tag); assert.equal(view.turned, turned.stones > native.stones, tag);
      } else {
        seen.add('low-best');
        const options = [[false, native.stones], [true, turned.stones], [false, native.play ?? 0], [true, turned.play ?? 0]];
        const best = Math.max(...options.map(([, step]) => step));
        assert.equal((view.turned ? turned : native)[view.source], best, tag);
      }
      assert.equal(view.free, native.stones >= MIN_GRID_STEP && turned.stones >= MIN_GRID_STEP, tag);
    }
  assert.deepEqual([...seen].sort(), ['comfort', 'low-best', 'low-stones', 'middle-keep', 'middle-turn']);
});

test('Easy Life 7/200 turns: all its stones turned beat a fallback crop', () => {
  const stones = [[5,17],[5,18],[5,19],[6,17],[6,18],[6,19],[7,17],[7,18],[8,17],[8,18],[8,19],[9,17],[9,18],[9,19],[10,17],[10,18],[11,17],[11,18],[12,17],[12,18],[12,19],[13,17],[13,18],[13,19]].map(([x, y]) => ({ x, y }));
  const moves = [{ x: 10, y: 19 }];
  for (const [viewport, source] of [[{ width: 440, height: 884 }, 'stones'], [{ width: 390, height: 772 }, 'stones'], [{ width: 320, height: 496 }, 'play']]) {
    const view = chooseView({ size: S19, stones, moves, grid: G19, viewport, band: 52 });
    assert.ok(view.turned && view.source === source, JSON.stringify(view.steps));
    assert.ok(view.steps.native.stones < MIN_GRID_STEP, 'Unturned, its stones would need a cramped grid');
  }
});

test('only a square board on a portrait screen turns', () => {
  const stones = sheet(2, 17, 1, 3), moves = [{ x: 9, y: 4 }];
  assert.equal(chooseView({ size: S19, stones, moves, grid: G19, viewport: { width: 390, height: 772 }, band: 52 }).turned, true);
  assert.equal(chooseView({ size: S19, stones, moves, grid: G19, viewport: { width: 772, height: 390 } }).turned, false);
  assert.equal(chooseView({ size: { x: 19, y: 13 }, stones, moves, grid: G19, viewport: { width: 390, height: 772 } }).turned, false);
});

test('a later decision holds what is shown near a boundary', () => {
  // Find a shape in the middle band whose turned gain sits just under TURN_GAIN.
  let near;
  for (let width = 6; width <= 17 && !near; width++) for (let height = 1; height <= 6 && !near; height++) {
    const stones = sheet(2, 1 + width, 1, height), moves = [{ x: 3, y: height + 1 }];
    const view = chooseView({ size: S19, stones, moves, grid: G19, viewport: { width: 390, height: 772 }, band: 52 });
    const gain = view.steps.turned.stones / view.steps.native.stones;
    if (view.steps.native.stones >= MIN_GRID_STEP && view.steps.native.stones < COMFORT_STEP && gain < TURN_GAIN && gain > TURN_GAIN / 1.1) near = { stones, moves };
  }
  assert.ok(near, 'a shape just under the turn gain exists');
  const ask = hold => chooseView({ size: S19, ...near, grid: G19, viewport: { width: 390, height: 772 }, band: 52, hold });
  assert.equal(ask(null).turned, false, 'A first decision does not turn');
  assert.equal(ask({ turned: true, source: 'stones' }).turned, true, 'But a turned board stays turned');
  assert.equal(ask({ turned: false, source: 'stones' }).turned, false);
});

// The tight crop, constraint by constraint: where a line lands on the screen.
const at = (fitted, grid, u, axis) => axis === 'x'
  ? fitted.offsetLeft + (grid.x + u * grid.step - fitted.box[0]) * fitted.scale
  : fitted.offsetTop + (grid.y + u * grid.step - fitted.box[1]) * fitted.scale;
const SCREEN = { width: 390, height: 844 }, BAR = 72, TOP_BAND = 52;
function check(plan, stones, touch, grid = G19) {
  const step = plan.step, S = (0.5 + EDGE_MARGIN) * step, T = step / 2, e = 1e-6;
  for (const p of stones) {
    const x = at(plan.fitted, grid, p.x - 1, 'x'), y = at(plan.fitted, grid, p.y - 1, 'y');
    assert.ok(x - S >= -e && x + S <= SCREEN.width + e && y - S >= -e && y + S <= SCREEN.height + e, `stone ${p.x},${p.y} visible with its margin`);
  }
  for (const p of touch) {
    const x = at(plan.fitted, grid, p.x - 1, 'x'), y = at(plan.fitted, grid, p.y - 1, 'y');
    assert.ok(x - T >= -e && x + T <= SCREEN.width + e && y - T >= TOP_BAND - e && y + T <= SCREEN.height - BAR + e, `touch cell ${p.x},${p.y} inside the touch region`);
  }
}
test('tight crop: every stone visible with a third of a cell, every next move inside the touch region', () => {
  for (const [stones, touch] of [
    [block(3, 15, 16, 19), [{ x: 9, y: 15 }]],
    [block(1, 4, 1, 12), [{ x: 5, y: 3 }, { x: 5, y: 9 }]],
    [block(8, 11, 8, 11), []],
  ]) for (const reach of [false, true]) {
    const plan = planTight({ stones, touch, size: S19, grid: G19, screen: SCREEN, band: TOP_BAND, bar: BAR, reach });
    assert.ok(plan.step > 0 && plan.step <= 80);
    check(plan, stones, touch);
  }
});
test('thumb reach is free: it never changes the size, only puts play lower', () => {
  const stones = block(6, 12, 8, 10), touch = [{ x: 9, y: 7 }];
  const high = planTight({ stones, touch, size: S19, grid: G19, screen: SCREEN, band: TOP_BAND, bar: BAR });
  const low = planTight({ stones, touch, size: S19, grid: G19, screen: SCREEN, band: TOP_BAND, bar: BAR, reach: true });
  assert.equal(low.step, high.step);
  assert.ok(at(low.fitted, G19, 6, 'y') >= at(high.fitted, G19, 6, 'y'));
});
test('a next move at the top of a tall group: both the stones and the touch region bound the size', () => {
  const stones = block(4, 6, 2, 18), touch = [{ x: 7, y: 2 }];
  // Edges left out, so only these two constraints are in play.
  const plan = planTight({ stones, touch, size: S19, grid: G19, screen: SCREEN, band: TOP_BAND, bar: BAR, edges: false });
  check(plan, stones, touch);
  // The stones alone would allow more; the touch cell under the band costs size.
  const free = planTight({ stones, touch: [], size: S19, grid: G19, screen: SCREEN, band: TOP_BAND, bar: BAR, edges: false });
  assert.ok(plan.step < free.step);
});
test('touch size outranks keeping every stone visible, which outranks the fallback', () => {
  const viewport = { width: 390, height: 772 }, room = { screen: SCREEN, bar: BAR, band: TOP_BAND };
  // A long wall far from play: no crop keeping it all can reach the minimum, so play wins.
  const wall = [...block(1, 19, 18, 19), { x: 9, y: 9 }, { x: 10, y: 9 }], moves = [{ x: 9, y: 8 }, { x: 10, y: 8 }];
  const far = chooseView({ size: S19, stones: wall, moves, grid: G19, viewport, ...room, touch: moves });
  assert.ok(far.steps.native.tight < MIN_GRID_STEP && far.steps.turned.tight < MIN_GRID_STEP);
  assert.equal(far.source, 'play');
  // A group whose stones crop is cramped but whose tight crop is not: every stone stays.
  const group = block(1, 10, 4, 11), next = [{ x: 5, y: 3 }];
  const keep = chooseView({ size: S19, stones: group, moves: next, grid: G19, viewport, ...room, touch: next });
  assert.ok(Math.max(keep.steps.native.stones, keep.steps.turned.stones) < MIN_GRID_STEP);
  assert.ok(Math.max(keep.steps.native.tight, keep.steps.turned.tight) >= MIN_GRID_STEP);
  assert.equal(keep.source, 'tight', 'the tight crop keeps every stone, so it wins over the fallback');
});
test('Easy Life 7/200 with the whole screen: turned, every stone shown', () => {
  const stones = [[5,17],[5,18],[5,19],[6,17],[6,18],[6,19],[7,17],[7,18],[8,17],[8,18],[8,19],[9,17],[9,18],[9,19],[10,17],[10,18],[11,17],[11,18],[12,17],[12,18],[12,19],[13,17],[13,18],[13,19]].map(([x, y]) => ({ x, y }));
  const moves = [{ x: 10, y: 19 }];
  const view = chooseView({ size: S19, stones, moves, grid: G19, viewport: { width: 440, height: 884 }, band: 52,
    screen: { width: 440, height: 956 }, bar: 72, touch: moves });
  assert.ok(view.turned && view.source !== 'play', JSON.stringify(view.steps));
});
test('tight crop: a real edge near the stones sits at the screen edge, before thumb reach', () => {
  const stones = block(4, 9, 2, 6), touch = [{ x: 6, y: 7 }];
  for (const reach of [false, true]) {
    const plan = planTight({ stones, touch, size: S19, grid: G19, screen: SCREEN, band: TOP_BAND, bar: BAR, reach });
    const lineOne = at(plan.fitted, G19, 0, 'y');
    assert.ok(Math.abs(lineOne - (0.5 + EDGE_MARGIN) * plan.step) < 1e-6 || lineOne >= (0.5 + EDGE_MARGIN) * plan.step, 'top edge shown at the top, as far as the constraints allow');
    check(plan, stones, touch);
  }
});

test('during a problem the grid step never increases and the crop keeps its kind', () => {
  // Easy Capture 28/200 (tsumego.com/6527), the follow-on camera's reference: a ladder whose
  // one correct line runs from the six setup stones down and left to the bottom edge, then
  // captures the chased chain.
  const start = [[9, 14], [10, 13], [10, 14], [10, 15], [11, 14], [11, 15]].map(([x, y]) => ({ x, y }));
  const path = [[10, 16], [9, 15], [8, 15], [9, 16], [9, 17], [8, 16], [7, 16], [8, 17], [8, 18], [7, 17],
    [6, 17], [7, 18], [7, 19], [6, 18], [5, 18], [6, 16], [6, 19]].map(([x, y]) => ({ x, y }));
  const chased = new Set(['10,14', '10,15', '9,15', '9,16', '8,16', '8,17', '7,17', '7,18', '6,18']);
  // After each reply, the stones so far and the player's next move (the tap).
  const positions = [];
  let stones = [...start];
  path.forEach((move, i) => {
    stones = [...stones, move];
    if (i % 2 === 1) positions.push({ stones, touch: [path[i + 1]] });
  });
  positions.push({ stones: stones.filter(p => !chased.has(`${p.x},${p.y}`)), touch: [] }); // the capture
  for (const [width, height] of [[390, 844], [320, 568]]) {
    const viewport = { width, height: height - BAR }, room = { screen: { width, height }, bar: BAR, band: TOP_BAND };
    const options = { size: S19, moves: path, grid: G19, viewport, ...room };
    const first = chooseView({ ...options, stones: start, touch: [path[0]] });
    const hold = { turned: first.turned, source: first.source };
    let step = first.frame.step, zoomedIn = false;
    for (const position of positions) {
      const free = chooseView({ ...options, turned: first.turned, ...position });
      const view = followView({ ...options, turned: first.turned, ...position }, { hold, cap: step });
      assert.equal(view.source, hold.source, `${width}: the crop keeps its kind`);
      assert.ok(view.frame.step <= step + 1e-9, `${width}: never zooms in: ${view.frame.step} after ${step} (free: ${free.frame.step})`);
      zoomedIn ||= free.frame.step > step + 1e-9;
      step = view.frame.step;
    }
    assert.ok(step < first.frame.step - 10, `${width}: the ladder zooms the view out (${first.frame.step} to ${step})`);
    if (width === 320) assert.ok(zoomedIn, 'at 320, choosing afresh would have zoomed back in mid-ladder');
  }
});
