import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { loadProblem, ProblemSession, parseSGF } from '../harness/go-problem.mjs';
import { collectGeometry, frameBounds } from '../extension/geometry.mjs';

const sources = JSON.parse(readFileSync(new URL('../harness/problems/sources.json', import.meta.url)));
const records = sources.map(source => {
  const text = readFileSync(new URL(`../harness/problems/${source.sgf}`, import.meta.url), 'utf8');
  return { source, text, problem: loadProblem(text) };
});
function winningPaths(root) {
  const paths = [];
  function visit(node, path) {
    if (node.terminal) paths.push(path);
    node.children.filter(n => n.winning).forEach(child => visit(child, [...path, child]));
  }
  visit(root, []); return paths;
}

test('the three authored problems keep their recorded hashes and explicit correct terminals', () => {
  assert.deepEqual(sources.map(s => s.id), ['edge', 'double', 'snapback']);
  for (const { source, text, problem } of records) {
    assert.equal(createHash('sha256').update(text).digest('hex'), source.sha256);
    assert.ok(source.credit && source.title && source.instruction);
    assert.equal(problem.solver, -1);
  }
  assert.deepEqual(records.map(r => r.problem.correctEnds), [2, 2, 1]);
});
test('all five winning lines, including alternative moves, finish only at marked terminals', () => {
  let tested = 0;
  for (const { problem } of records) for (const path of winningPaths(problem.root)) {
    const session = new ProblemSession(problem);
    assert.ok(path.length >= 3);
    for (const [index, node] of path.entries()) {
      if (node.move.color === problem.solver) assert.ok(session.play(node.move.x, node.move.y));
      else assert.ok(session.reply(node));
      assert.equal(session.phase === 'success', index === path.length - 1);
      assert.deepEqual(session.stones, node.stones);
    }
    tested++;
  }
  assert.equal(tested, 5);
});
test('opponent selects a recorded refutation and a losing branch fails', () => {
  const session = new ProblemSession(records[0].problem);
  session.play(3, 1); // B[ca], the atari from the edge side, answered by W[db].
  assert.equal(session.phase, 'reply');
  session.reply();
  assert.deepEqual(session.lastMove, { x: 4, y: 2, color: 1 });
  assert.equal(session.phase, 'failure');
  assert.equal(session.current.terminal, false);
});
test('an off-tree move fails locally and reset restores the exact initial position', () => {
  for (const { problem } of records) {
    const session = new ProblemSession(problem);
    session.play(19, 19);
    assert.equal(session.phase, 'failure');
    assert.equal(session.stones[360], -1);
    session.reset();
    assert.equal(session.phase, 'play');
    assert.equal(session.current, problem.root);
    assert.deepEqual(session.stones, problem.root.stones);
    assert.equal(session.lastMove, null);
  }
});
test('real captures are removed, and reset restores captured stones and a playable first move', () => {
  const problem = records[2].problem, session = new ProblemSession(problem);
  const path = winningPaths(problem.root)[0];
  for (const node of path) node.move.color === problem.solver ? session.play(node.move.x, node.move.y) : session.reply(node);
  assert.ok(path.reduce((sum, node) => sum + node.captures, 0) >= 2);
  assert.ok(problem.root.stones.some((stone, i) => stone === 1 && session.stones[i] !== 1));
  session.reset();
  assert.deepEqual(session.stones, problem.root.stones);
  assert.ok(session.play(path[0].move.x, path[0].move.y));
  assert.equal(session.phase, 'reply');
});
test('illegal occupied input does not consume a turn or modify stones', () => {
  const problem = records[0].problem, session = new ProblemSession(problem);
  assert.equal(session.play(2, 2), false); // Root AB[bb].
  assert.equal(session.phase, 'play');
  assert.deepEqual(session.stones, problem.root.stones);
});
test('framing includes every source node and all moves, including failed branches', () => {
  for (const { problem } of records) {
    const geometry = collectGeometry(problem.root), bounds = frameBounds(geometry.size, geometry.points);
    function visit(node) {
      if (node.move) assert.ok(node.move.x >= bounds.left && node.move.x <= bounds.right && node.move.y >= bounds.top && node.move.y <= bounds.bottom);
      node.children.forEach(visit);
    }
    visit(problem.root);
  }
});
test('parser preserves escaped text and refuses ambiguous success conventions', () => {
  assert.equal(parseSGF('(;C[a\\]b\\\nc])').properties.C[0], 'a]bc');
  assert.throws(() => loadProblem('(;SZ[9];B[aa])'), /unambiguous/);
  assert.throws(() => loadProblem('(;SZ[9]G[LIVE];B[aa]C[+])'), /Status-based/);
  assert.throws(() => loadProblem('(;SZ[9];B[aa]C[+];W[bb])'), /Nonterminal/);
});

test('all eight demo orientations preserve every winning line, captures and reset', () => {
  let played = 0;
  for (const { text, problem: original } of records) {
    const positions = new Set();
    for (let orientation = 0; orientation < 8; orientation++) {
      const problem = loadProblem(text, orientation);
      positions.add([...problem.root.stones].join(','));
      assert.equal(problem.correctEnds, original.correctEnds);
      for (const path of winningPaths(problem.root)) {
        const session = new ProblemSession(problem);
        for (const node of path) {
          if (node.move.color === problem.solver) assert.ok(session.play(node.move.x, node.move.y));
          else assert.ok(session.reply(node));
        }
        assert.equal(session.phase, 'success');
        assert.deepEqual(session.stones, path.at(-1).stones);
        session.reset(); assert.deepEqual(session.stones, problem.root.stones);
        played++;
      }
      const geometry = collectGeometry(problem.root);
      assert.ok(geometry.points.every(p => p.x >= 1 && p.x <= problem.size.x && p.y >= 1 && p.y <= problem.size.y));
    }
    assert.equal(positions.size, 8);
  }
  assert.equal(played, 40);
});

test('rotation and mirroring transform rectangular setup ranges, moves and labels together', () => {
  const text = '(;SZ[9:13]AB[ab:ac]LB[ab:A];B[bc]C[+])';
  const rotated = loadProblem(text, 1);
  assert.deepEqual(rotated.size, { x: 13, y: 9 });
  assert.equal(rotated.root.getStone(12, 1), -1);
  assert.equal(rotated.root.getStone(11, 1), -1);
  assert.equal(rotated.root.getMarkup(12, 1), 'A');
  assert.deepEqual(rotated.root.children[0].move, { x: 11, y: 2, color: -1 });
  const mirrored = loadProblem(text, 5);
  assert.equal(mirrored.root.getStone(2, 1), -1);
  assert.equal(mirrored.root.getMarkup(2, 1), 'A');
  assert.deepEqual(mirrored.root.children[0].move, { x: 3, y: 2, color: -1 });
  assert.throws(() => loadProblem(text, 8), /orientation/);
});
