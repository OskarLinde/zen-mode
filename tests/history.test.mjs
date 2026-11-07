import test from 'node:test';
import assert from 'node:assert/strict';
import { problemHistory, turnColor } from '../extension/site-ui.mjs';

test('opening a problem is not evidence of a previous attempt', () => {
  assert.equal(problemHistory({ code: 'N' }).label, 'New');
  assert.equal(problemHistory({ code: 'V', ratio: '-' }).label, 'Untried');
  assert.equal(problemHistory({ code: 'V', ratio: '0/0' }).label, 'Untried');
  assert.equal(problemHistory({ code: 'V' }).label, 'Unsolved');
  assert.equal(problemHistory({ code: 'V', ratio: 'unknown' }).label, 'Unsolved');
});
test('previous failures come from actual attempt counts or failure status', () => {
  assert.equal(problemHistory({ code: 'V', ratio: '0/3' }).label, 'Failed');
  assert.equal(problemHistory({ code: 'V', ratio: '2/0' }).label, 'Tried');
  assert.equal(problemHistory({ code: 'F' }).label, 'Failed');
  assert.match(problemHistory({ code: 'X' }).detail, /Previously solved, then failed review/);
});
test('solved, mastered and due-for-review states retain solved history', () => {
  for (const code of ['S', 'C', 'W']) {
    assert.equal(problemHistory({ code, ratio: '0/3', failedHere: true }).label, 'Solved');
  }
  assert.match(problemHistory({ code: 'W' }).detail, /due for review/);
  assert.match(problemHistory({ code: 'C' }).detail, /Mastered/);
});
test('only a revealed failure augments visited history', () => {
  assert.equal(problemHistory({ code: 'V', ratio: '-' }).label, 'Untried');
  assert.equal(problemHistory({ code: 'V', ratio: '-', failedHere: true }).label, 'Failed');
  assert.equal(problemHistory({ code: 'N', failedHere: true }).label, 'Failed');
});
test('training N means due, not a new problem', () => {
  assert.equal(problemHistory({ code: 'N', training: true }).label, 'Due');
  assert.equal(problemHistory({ code: 'N', training: true, missed: true }).label, 'Failed');
  assert.equal(problemHistory({ code: 'N', training: true, failedHere: true }).label, 'Failed');
  assert.equal(problemHistory({ code: 'S', training: true, missed: true }).label, 'Solved');
  assert.equal(problemHistory({ code: 'V', training: true }), null);
});
test('signed-out, missing and unknown status are never guessed as new', () => {
  for (const code of ['N', 'V', 'S', 'W', 'F']) assert.equal(problemHistory({ code, guest: true }), null);
  assert.equal(problemHistory(), null);
  assert.equal(problemHistory({ code: 'unexpected' }), null);
  assert.equal(problemHistory({ code: 'G' }).label, 'Bonus');
});
test('turn stone follows the visible instruction and clears for feedback', () => {
  for (const text of ['Black to play', 'Black to live.', ' black to capture.']) assert.equal(turnColor(text), 'black');
  for (const text of ['White to play', 'White to kill.']) assert.equal(turnColor(text), 'white');
  for (const text of ['Correct!', 'Incorrect! White could capture.', 'Ready', 'Review', '', 'What about Black to play?']) assert.equal(turnColor(text), '');
});
