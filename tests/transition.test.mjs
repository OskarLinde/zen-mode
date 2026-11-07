import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const context = {};
runInNewContext(readFileSync(new URL('../extension/transition.js', import.meta.url), 'utf8'), context);
const valid = context.ZenModeHandoff.valid;
const frame = { clip: [0, 0, 440, 884], surface: [0, 640, 440, 244],
  grid: [20, 660, 40], size: [19, 19], viewport: [440, 956], lineWidth: 1 };

test('handoff wood and shadow use finite board bounds, independent of interior crop', () => {
  const interior = { ...frame, grid: [-100, -400, 50], inset: [119 / 88, 119 / 88] };
  const full = Array.from(context.ZenModeHandoff.boardBounds(interior));
  assert.ok(full[1] < 0, 'Real board continues above the camera; no top mat or rim');
  assert.equal(full[1], -400 - 50 * 119 / 88);
  assert.equal(full[3], (18 + 2 * 119 / 88) * 50);
  assert.deepEqual(Array.from(context.ZenModeHandoff.boardBounds({ ...interior, surface: [0, 12, 900, 500] })), full);
  const top = Array.from(context.ZenModeHandoff.boardBounds({ ...interior, grid: [50, 150, 50] }));
  assert.equal(top[1], 150 - 50 * 119 / 88, 'Mat starts outside the coordinate gutter at a true top edge');
});

test('handoff accepts cropped, full and rectangular board geometry', () => {
  assert.equal(valid(frame), true);
  assert.equal(valid({ ...frame, surface: [0, 444, 440, 440], grid: [12, 456, 23] }), true);
  assert.equal(valid({ ...frame, size: [13, 9] }), true);
  assert.equal(valid({ ...frame, inset: [119 / 88, 119 / 88] }), true);
});

test('handoff rejects malformed or unbounded stored geometry', () => {
  for (const value of [null, {}, { ...frame, grid: [0, 0, 0] }, { ...frame, grid: [NaN, 0, 40] },
    { ...frame, surface: [0, 0, Infinity, 10] }, { ...frame, size: [10000, 19] },
    { ...frame, size: [19.5, 19] }, { ...frame, clip: [0, 0, -1, 884] },
    { ...frame, lineWidth: 0 }, { ...frame, grid: [0, 0, 1e9] }, { ...frame, grid: [0, 0, 19999] }, { ...frame, viewport: [440] },
    ...[[0, 0], [1], [NaN, 1], [1e9, 1]].map(inset => ({ ...frame, inset }))])
    assert.ok(!valid(value));
});

test('handoff admits bounded grid star points but rejects arbitrary or out-of-grid decoration', () => {
  const decorated = { ...frame, stars: [[3, 3], [9, 9], [15, 15]], starRadius: 2.5 };
  assert.equal(valid(decorated), true);
  for (const invalid of [{ stars: 'svg' }, { stars: [[19, 3]] }, { stars: [[3.5, 3]] },
    { stars: [[3, 3, 3]] }, { stars: Array(26).fill([3, 3]) }, { starRadius: Infinity }])
    assert.ok(!valid({ ...decorated, ...invalid }));
});

test('handoff accepts only bounded visible-stone presentation records', () => {
  const stone = [0, 18, .44, 'black', 'none', .02, ''];
  assert.equal(valid({ ...frame, stones: [stone] }), true);
  for (const stones of ['html', [[19, ...stone.slice(1)]], [[0, 0, 1, ...stone.slice(3)]],
    [[0, 0, .44, {}, 'none', .02, '']], [[0, 0, .44, 'black', 'none', NaN, '']], Array(362).fill(stone)])
    assert.ok(!valid({ ...frame, stones }));
});

test('handoff coordinates preserve bounded gutter text and reject in-board or arbitrary data', () => {
  const label={x:0,y:-.96,text:'A',size:32/88,dy:.12,fill:'rgb(0, 0, 0)',
    font:'Helvetica, Arial, sans-serif',weight:'400',anchor:'middle'};
  assert.equal(valid({...frame,coordinates:[]}),true,'Coordinates off');
  assert.equal(valid({...frame,coordinates:[label,{...label,x:-.96,y:18,text:'1'}]}),true);
  assert.equal(valid({...frame,size:[13,9],coordinates:[{...label,x:12,text:'十三'}]}),true);
  for(const coordinates of [null,'text',Array(77).fill(label),
    ...[{x:0,y:0},{x:-1,y:-1},{x:NaN},{size:Infinity},{size:0},{dy:20},
      {text:'hidden solution tree'},{text:''},{fill:{}},{font:'a'.repeat(121)},
      {weight:'url(x)'},{anchor:'anything'}].map(change=>[{...label,...change}])])
    assert.ok(!valid({...frame,coordinates}));
});

test('handoff shadows must be bounded presentation of captured visible stones', () => {
  const stones = [[0, 18, .5, 'black', 'none', 0, '']];
  const piece = [0, 18, -2/88, -4/88, 43/88, 'rgb(0, 0, 0)', .32];
  const shadows = { blur: 2/88, pieces: [piece, [0, 18, 2/88, 4/88, 43/88, 'black', .32]] };
  assert.equal(valid({ ...frame, stones, shadows }), true);
  for (const change of [null, {}, { ...shadows, blur: 0 }, { ...shadows, blur: Infinity },
    { ...shadows, pieces: Array(3).fill(piece) }, { ...shadows, pieces: [[1, ...piece.slice(1)]] },
    ...[[2, .2], [3, NaN], [4, 2], [5, {}], [6, 1.1]].map(([index, value]) => {
      const p = [...piece]; p[index] = value; return { ...shadows, pieces: [p] };
    })]) assert.ok(!valid({ ...frame, stones, shadows: change }));
  assert.ok(!valid({ ...frame, shadows }));
});
