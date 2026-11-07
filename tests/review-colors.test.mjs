import test from 'node:test';
import assert from 'node:assert/strict';
import { replyColor, arrowKeyIsReserved, isGuest, parseHearts, splitProblemTitle, composeFeedback, createNextWait, NEXT_SPINNER_DELAY, NEXT_SPINNER_LIMIT } from '../extension/site-ui.mjs';

test('reply marker uses the transformed mover, preserving solver and local colors', () => {
  assert.equal(replyColor({ move: { color: 1 } }, -1), 'white');
  assert.equal(replyColor({ move: { color: -1 } }, 1), 'black');
  for (const solver of [-1, 1]) {
    assert.equal(replyColor({ move: { color: solver } }, solver), '');
    assert.equal(replyColor({ move: { color: -solver }, localEdit: true }, solver), '');
  }
  assert.equal(replyColor({ move: { color: 1 } }, 0), '');
  assert.equal(replyColor({}, -1), '');
  assert.equal(replyColor({ move: { color: 0 } }, -1), 'unknown');
});

test('virtual reply reads the played stone in the resulting native position, never turn parity', () => {
  const target = { getStone: (x, y) => x === 4 && y === 5 ? 1 : 0 };
  assert.equal(replyColor({ move: { x: 4, y: 5 }, target }, -1), 'white');
  assert.equal(replyColor({ move: { x: 4, y: 5 }, target }, 1), '');
  assert.equal(replyColor({ move: { x: 9, y: 5 }, target }, -1), 'unknown');
  assert.equal(replyColor({ move: {}, target }, -1), 'unknown');
  assert.equal(replyColor({ move: { x: 4, y: 5 }, target: { ...target, localEdit: true } }, -1), '');
});

// A key event with only the fields the guards read.
const key = (fields = {}, path = []) => ({ defaultPrevented: false, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false,
  isComposing: false, keyCode: 37, composedPath: () => path, ...fields });
const pageWith = (dialogs = []) => ({ querySelector: () => null, querySelectorAll: () => dialogs });
const matching = selector => ({ matches: list => list.split(',').map(item => item.trim()).includes(selector) });

test('arrow keys stay with the page for plain presses outside controls', () => {
  assert.equal(!!arrowKeyIsReserved(key(), pageWith()), false);
});

test('arrow keys are reserved for modifiers, composition and handled events', () => {
  for (const fields of [{ altKey: true }, { ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { isComposing: true }, { keyCode: 229 }, { defaultPrevented: true }])
    assert.ok(arrowKeyIsReserved(key(fields), pageWith()), JSON.stringify(fields));
});

test('arrow keys are reserved inside text, trees and sheets', () => {
  for (const selector of ['input', 'textarea', 'select', '[role="tree"]', '.zen-native-ui', '.zen-achievements'])
    assert.ok(arrowKeyIsReserved(key({}, [matching(selector)]), pageWith()), selector);
  assert.ok(arrowKeyIsReserved(key({}, [{ isContentEditable: true }]), pageWith()));
});

test('a guest is the site flag or user id 0, and a signed-in player is neither', () => {
  const had = globalThis.window;
  try {
    for (const [state, expected] of [[{ besogoNoLogin: true }, true], [{ besogoUserId: 0 }, true], [{ besogoNoLogin: false, besogoUserId: 7 }, false], [{}, false]]) {
      globalThis.window = state;
      assert.equal(isGuest(), expected, JSON.stringify(state));
    }
  } finally { globalThis.window = had; }
});

test('the heart counter parses the site format and nothing else', () => {
  assert.deepEqual(parseHearts(' 3 / 5 '), { remaining: 3, total: 5 });
  assert.deepEqual(parseHearts('-1/5'), { remaining: -1, total: 5 });
  for (const text of [undefined, '', 'three', '3 of 5']) assert.ok(Number.isNaN(parseHearts(text).remaining));
});

test('a problem title splits into its set and number', () => {
  assert.deepEqual(splitProblemTitle('Easy Life 93/200'), { set: 'Easy Life', number: '93/200' });
  assert.deepEqual(splitProblemTitle('Tesuji Training #2 281 / 416'), { set: 'Tesuji Training #2', number: '281 / 416' });
  assert.deepEqual(splitProblemTitle('No number here'), { set: 'No number here', number: '' });
});

test('feedback joins the continuation with training notes under their heading', () => {
  assert.equal(composeFeedback('Text', 'Correct!', []), 'Text');
  assert.equal(composeFeedback('', 'Correct!', []), '');
  assert.equal(composeFeedback('Text', 'Correct!', ['Note']), 'Text\n\nCorrect!\n\nNote');
  assert.equal(composeFeedback('', undefined, ['Note']), 'Note');
});

function nextButton() {
  const attributes = new Map();
  return { attributes, setAttribute: (name, value) => attributes.set(name, value), removeAttribute: name => attributes.delete(name) };
}

test('Next shows nothing below the delay, waits, then stops at the limit', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const button = nextButton(), wait = createNextWait(button);
  wait.start(); t.mock.timers.tick(NEXT_SPINNER_DELAY - 1);
  assert.equal(button.attributes.has('aria-busy'), false, 'A fast page shows nothing');
  t.mock.timers.tick(1);
  assert.equal(button.attributes.get('aria-busy'), 'true');
  t.mock.timers.tick(NEXT_SPINNER_LIMIT - NEXT_SPINNER_DELAY);
  assert.equal(button.attributes.has('aria-busy'), false, 'Back to normal at the limit');
});

test('clearing Next stops a wait before it shows, and a new press can wait again', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const button = nextButton(), wait = createNextWait(button);
  wait.start(); wait.clear(); t.mock.timers.tick(NEXT_SPINNER_LIMIT);
  assert.equal(button.attributes.has('aria-busy'), false);
  wait.start(); t.mock.timers.tick(NEXT_SPINNER_DELAY);
  assert.equal(button.attributes.get('aria-busy'), 'true');
});

test('a second press during a wait does not extend it', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const button = nextButton(), wait = createNextWait(button);
  wait.start(); t.mock.timers.tick(NEXT_SPINNER_LIMIT - 1); wait.start(); t.mock.timers.tick(1);
  assert.equal(button.attributes.has('aria-busy'), false);
});

