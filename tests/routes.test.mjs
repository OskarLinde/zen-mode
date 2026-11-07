import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const script = readFileSync(new URL('../extension/content.js', import.meta.url), 'utf8');
function boot(pathname, { board = true, svg = false, hostname = 'tsumego.com', saved = {}, demo = false, readyState = 'complete' } = {}) {
  const observers = [], events = new Map(), dataset = {}, styles = new Map();
  const timers = new Map(), frames = new Map(), notices = [], scripts = [];
  let now = 0, id = 0;
  if (demo) dataset.zenDemo = 'authored';
  const on = (name, fn) => { if (!events.has(name)) events.set(name, new Set()); events.get(name).add(fn); };
  const off = (name, fn) => events.get(name)?.delete(fn);
  const emit = name => { for (const fn of [...(events.get(name) || [])]) fn({ type: name }); };
  const drawing = { getAttribute: () => '0 0 100 100', querySelectorAll: () => [],
    getBoundingClientRect: () => ({ x: 0, y: 0, width: 100, height: 100 }) };
  const document = {
    documentElement: { dataset, style: { setProperty: (name, value) => styles.set(name, value) },
      append: el => scripts.push(el), removeAttribute: name => {
        delete dataset[name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())];
      } },
    body: { prepend: el => notices.push(el) }, readyState,
    querySelector: selector => selector === '#target' && board ? {} : selector.endsWith('> svg') && svg ? drawing : null,
    addEventListener: on, removeEventListener: off, dispatchEvent: event => emit(event.type),
    createElement: () => ({ setAttribute() {}, remove() {} })
  };
  runInNewContext(script, {
    document, location: { hostname, pathname },
    chrome: { runtime: { getURL: path => `chrome-extension://test/${path}` }, storage: { local: { get: async () => saved } } },
    localStorage: { getItem: key => saved[key] ?? null },
    MutationObserver: class {
      constructor(fn) { this.fn = fn; observers.push(this); }
      observe() { this.active = true; } disconnect() { this.active = false; }
    },
    addEventListener: on, removeEventListener: off, Event: class { constructor(type) { this.type = type; } },
    Date: { now: () => now },
    setTimeout: (fn, ms) => { const key = ++id; timers.set(key, { fn, at: now + ms }); return key; },
    clearTimeout: key => timers.delete(key),
    requestAnimationFrame: fn => { const key = ++id; frames.set(key, fn); return key; },
    cancelAnimationFrame: key => frames.delete(key)
  });
  return { dataset, styles, emit, observers, notices, scripts, addBoard() {
    board = true;
    for (const observer of [...observers]) if (observer.active) observer.fn();
  }, finishLoading() {
    document.readyState = 'complete'; emit('load');
  }, addSVG() {
    svg = true;
    for (const observer of [...observers]) if (observer.active) observer.fn();
  }, advance(ms, { suspended = false } = {}) {
    const end = now + ms;
    if (!suspended) {
      for (;;) {
        const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
        if (!next || next[1].at > end) break;
        now = next[1].at; timers.delete(next[0]); next[1].fn();
      }
    }
    now = end;
  }, frame() {
    const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn());
  } };
}

test('actual document-start script matches the supported play routes only', () => {
  const accepted = ['/6500', '/6500/', '/tsumegos/play/15352', '/mistake-training',
    '/mistake-training/', '/mistake-training/play/5658', '/mistake-training/play/5658/'];
  const rejected = ['/', '/users/login', '/sets/104', '/editor', '/editor/', '/tsumegos/play/x', '/6500/export', '/rating-mode',
    '/time-mode', '/mistake-training/overview', '/mistake-training/import',
    '/mistake-training/play', '/mistake-training/play/x', '/mistake-training/play/5/export'];
  for (const path of [...accepted, ...rejected]) {
    const page = boot(path);
    assert.equal(page.dataset.zen === 'on', accepted.includes(path), `content script: ${path}`);
    if (accepted.includes(path)) assert.equal(page.styles.get('--zen-tatami-image'), 'url("chrome-extension://test/tatami.png")', 'Texture resolves inside the extension, not against the site');
  }
  assert.equal(boot('/mistake-training', { hostname: 'other.example' }).dataset.zen, undefined);
});

test('training entry stays native when it renders an overview without a board', () => {
  const page = boot('/mistake-training', { board: false });
  assert.equal(page.dataset.zen, undefined);
  assert.equal(page.observers.length, 1);
  page.emit('DOMContentLoaded');
  assert.equal(page.observers[0].active, false);
  assert.equal(page.dataset.zen, undefined);
});

test('training enhancement begins when the parser reaches its native board target', () => {
  const page = boot('/mistake-training/play/5658', { board: false });
  assert.equal(page.dataset.zen, undefined);
  page.addBoard();
  assert.equal(page.dataset.zen, 'on');
  assert.equal(page.dataset.zenPreparing, 'on');
  assert.equal(page.observers[0].active, false);
});

test('startup falls back even when the site never creates an SVG', () => {
  const page = boot('/5193');
  page.advance(9999);
  assert.equal(page.dataset.zenPreparing, 'on');
  page.advance(1);
  assert.equal(page.dataset.zenPreparing, undefined);
  assert.equal(page.dataset.zen, undefined);
  assert.match(page.notices[0].textContent, /Site view restored/);
  page.addSVG(); page.advance(10000); page.emit('pageshow');
  assert.equal(page.dataset.zen, undefined, 'late site rendering cannot restart the view');
  assert.equal(page.notices.length, 1);
});

test('an SVG without a working adapter reveals first, then restores the site', () => {
  const page = boot('/5193', { svg: true });
  page.advance(1000);
  assert.equal(page.dataset.zenPreparing, undefined, 'one-second reveal remains bounded');
  assert.equal(page.dataset.zen, 'on');
  page.advance(9000);
  assert.equal(page.dataset.zen, undefined);
  assert.equal(page.notices.length, 1);
});

test('successful initialization cancels fallback and retains stable-frame reveal', async () => {
  const page = boot('/5193', { svg: true });
  await new Promise(resolve => setImmediate(resolve)); // saved preferences settle
  page.emit('zen:prepared');
  page.frame(); page.frame();
  assert.equal(page.dataset.zenPreparing, 'on');
  page.frame();
  assert.equal(page.dataset.zenPreparing, undefined);
  page.advance(20000); page.emit('pageshow');
  assert.equal(page.dataset.zen, 'on');
  assert.equal(page.notices.length, 0);
});

test('late adapter readiness after early reveal still cancels the startup fallback', () => {
  const page = boot('/5193', { svg: true });
  page.advance(1500); page.emit('zen:prepared'); page.advance(20000);
  assert.equal(page.dataset.zen, 'on');
  assert.equal(page.notices.length, 0);
});

test('a page still loading keeps waiting past the patience, then has its own time', () => {
  const page = boot('/5193', { readyState: 'interactive' });
  page.advance(14000);
  assert.equal(page.dataset.zen, 'on', 'Slow is not failed');
  assert.equal(page.notices.length, 0);
  page.finishLoading(); page.advance(9000);
  assert.equal(page.dataset.zen, 'on', 'The patience restarts when loading ends');
  page.advance(1000);
  assert.equal(page.dataset.zen, undefined);
  assert.equal(page.notices.length, 1);
});

test('a slow page that becomes ready keeps Zen mode', () => {
  const page = boot('/5193', { svg: true, readyState: 'interactive' });
  page.advance(14000); page.emit('zen:prepared'); page.advance(60000);
  assert.equal(page.dataset.zen, 'on');
  assert.equal(page.notices.length, 0);
});

test('a page that never finishes loading gives up at the limit', () => {
  const page = boot('/5193', { readyState: 'interactive' });
  page.advance(59000);
  assert.equal(page.dataset.zen, 'on');
  page.advance(2000);
  assert.equal(page.dataset.zen, undefined);
  assert.equal(page.notices.length, 1);
});

test('returning from suspension checks the startup deadline without waiting for a timer', () => {
  const page = boot('/5193');
  page.advance(20000, { suspended: true });
  page.emit('pageshow');
  assert.equal(page.dataset.zen, undefined);
  assert.equal(page.notices.length, 1);
});

test('module load errors restore the site immediately with visible feedback', () => {
  const page = boot('/5193');
  page.scripts.find(element => element.type === 'module').onerror();
  assert.equal(page.dataset.zenPreparing, undefined);
  assert.equal(page.dataset.zen, undefined);
  page.advance(20000);
  assert.equal(page.notices.length, 1);
});

const preferences = page => ['zenTheme','zenMargin','zenMotion','zenSurround'].map(key => page.dataset[key]);
test('fresh defaults agree at document start and after asynchronous storage', async () => {
  const page=boot('/5193');
  assert.deepEqual(preferences(page),['site','on','on','auto']);
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(preferences(page),['site','on','on','auto']);
});
test('saved alternatives and partial preferences survive the new defaults', async () => {
  for(const [saved,expected] of [
    [{zenTheme:'plain',zenMargin:'off',zenMotion:'off'},['plain','off','off','auto']],
    [{zenTheme:'plain'},['plain','on','on','auto']],
    [{zenMargin:'off',zenSurround:'solid'},['site','off','on','solid']],
    [{zenMotion:'off',zenCoordinates:'off',zenReach:'off'},['site','on','off','auto']]
  ]) {
    const page=boot('/5193',{saved});await new Promise(resolve=>setImmediate(resolve));
    assert.deepEqual(preferences(page),expected);
    for(const key of ['zenCoordinates','zenReach']) if(key in saved)assert.equal(page.dataset[key],saved[key]);
  }
});
test('authored demo uses the same defaults without erasing stored alternatives', () => {
  assert.deepEqual(preferences(boot('/5193',{demo:true})),['site','on','on','auto']);
  assert.deepEqual(preferences(boot('/5193',{demo:true,saved:{'zen-demo-theme':'plain','zen-demo-zenMargin':'off','zen-demo-motion':'off'}})),['plain','off','off','auto']);
  assert.deepEqual(preferences(boot('/5193',{demo:true,saved:{'zen-demo-motion':'off'}})),['site','on','off','auto']);
});
