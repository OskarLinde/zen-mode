#!/usr/bin/env node
// Disposable-profile verification. Never attaches to an existing browser.
// Node 22+, or Node 20 with --experimental-websocket. No npm dependencies.
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
const { values } = parseArgs({ options: {
  chrome: { type: 'string' }, preview: { type: 'string' }, output: { type: 'string' }, live: { type: 'boolean', default: false },
  extension: { type: 'string' },
  'reload-only': { type: 'boolean', default: false },
  'presented-only': { type: 'boolean', default: false },
  'review-state-only': { type: 'boolean', default: false },
  coverage: { type: 'string' },
  'turn-only': { type: 'boolean', default: false },
  'taps-only': { type: 'boolean', default: false },
  'next-only': { type: 'boolean', default: false },
  'menu-only': { type: 'boolean', default: false },
  'tree-only': { type: 'boolean', default: false },
  'random-only': { type: 'boolean', default: false },
  'reset-only': { type: 'boolean', default: false },
  'comments-only': { type: 'boolean', default: false },
  'tatami-only': { type: 'boolean', default: false },
  'coordinates-only': { type: 'boolean', default: false },
  'defaults-only': { type: 'boolean', default: false },
  'layout-only': { type: 'boolean', default: false },
  'live-only': { type: 'boolean', default: false },
  'edges-only': { type: 'boolean', default: false },
  'review-only': { type: 'boolean', default: false },
  'keys-only': { type: 'boolean', default: false },
  'notices-only': { type: 'boolean', default: false },
  'compat-only': { type: 'boolean', default: false },
  'contrast-only': { type: 'boolean', default: false },
  'solid-only': { type: 'boolean', default: false },
} });
if (!values.chrome || !values.preview || !values.output) throw Error('Use --chrome /path/to/Chrome --preview http://local-preview/index.html --output /path/to/artifacts [--live]');
const preview = new URL(values.preview);
if (!['localhost', '127.0.0.1'].includes(preview.hostname) && !preview.hostname.endsWith('.localhost')) throw Error('Use a confined local preview URL.');
const source = values.extension ? resolve(values.extension) : fileURLToPath(new URL('../extension', import.meta.url)), output = resolve(values.output);
if (output.startsWith(fileURLToPath(new URL('../', import.meta.url)))) throw Error('Keep generated evidence outside the source tree.');
await mkdir(output, { recursive: true });
const profile = await mkdtemp(join(tmpdir(), 'zen-chrome-check-'));
const browser = spawn(values.chrome, [...(values['reload-only'] || values['coordinates-only'] || values['presented-only'] ? [] : ['--headless=new']), `--user-data-dir=${profile}`, '--remote-debugging-port=0',
  '--enable-unsafe-extension-debugging', '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });
let browserError; browser.on('error', error => { browserError = error; });
const pause = ms => new Promise(r => setTimeout(r, ms));
let root, page;
async function connect(url) {
  const socket = new WebSocket(url), pending = new Map(), on = {}; let id = 0;
  await new Promise((r, j) => { socket.onopen = r; socket.onerror = j; });
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data), item = pending.get(message.id); on[message.method]?.(message.params); if (!item) return;
    pending.delete(message.id); clearTimeout(item.timer);
    message.error ? item.reject(Error(JSON.stringify(message.error))) : item.resolve(message.result);
  };
  return { on, close: () => socket.close(), send(method, params = {}) {
    return new Promise((resolve, reject) => { const key = ++id;
      const timer = setTimeout(() => { pending.delete(key); reject(Error(`Timed out: ${method}`)); }, 30000);
      pending.set(key, { resolve, reject, timer }); socket.send(JSON.stringify({ id: key, method, params }));
    });
  } };
}
const results = [];
const check = (ok, label) => { if (!ok) throw Error(label); results.push(label); };
const ev = async expression => {
  const r = await page.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};
async function wait(expression, timeout = 18000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { try { if (await ev(expression)) return; } catch {} await pause(100); }
  const state = await ev(`JSON.stringify({ path: location.pathname, data: { ...document.documentElement.dataset }, editor: !!window.besogo?.editor, board: !!document.querySelector('.besogo-board > svg'), loading: document.readyState })`).catch(() => 'unreadable');
  throw Error(`Readiness: ${state} waiting for ${expression.slice(0, 120)}`);
}
async function navigate(url) { await page.send('Page.navigate', { url }); }
async function shot(name) {
  const r = await page.send('Page.captureScreenshot', { format: 'png' });
  await writeFile(join(output, name + '.png'), Buffer.from(r.data, 'base64'));
}
try {
  let port;
  for (let n = 0; n < 100; n++) {
    if (browserError) throw browserError;
    try { port = +(await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break; } catch { await pause(100); }
  }
  if (!port) throw Error('Disposable Chrome did not start.');
  const endpoint = `http://127.0.0.1:${port}`;
  const version = await (await fetch(endpoint + '/json/version')).json(); root = await connect(version.webSocketDebuggerUrl);
  const installed = await root.send('Extensions.loadUnpacked', { path: source });
  const target = (await (await fetch(endpoint + '/json')).json()).find(t => t.type === 'page'); page = await connect(target.webSocketDebuggerUrl);
  // CSS coverage for evidence: which rules of zen.css any flow in this run used.
  const zenCss = values.coverage ? await readFile(new URL('../extension/zen.css', import.meta.url), 'utf8') : null;
  const coverage = { seen: new Set(), used: new Set(), sheets: new Set() }, coverageDelta = async () => {
    for (const { styleSheetId, startOffset, used } of (await page.send('CSS.takeCoverageDelta')).coverage)
      if (coverage.sheets.has(styleSheetId)) { coverage.seen.add(startOffset); if (used) coverage.used.add(startOffset); } };
  let coverageTimer;
  if (values.coverage) {
    page.on['CSS.styleSheetAdded'] = ({ header }) => { if (header.length === zenCss.length) coverage.sheets.add(header.styleSheetId); };
    await page.send('DOM.enable'); await page.send('CSS.enable'); await page.send('CSS.startRuleUsageTracking');
    coverageTimer = setInterval(() => coverageDelta().catch(() => {}), 200);
  }
  await page.send('Page.enable'); await page.send('Page.bringToFront'); await page.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  let harness = null;
  if(values['comments-only']) {
    // Real problems with authored comments. The Review hook builds the button enabled, as the site does when solved.
    const probe=await page.send('Page.addScriptToEvaluateOnNewDocument',{source:await readFile(new URL('./review-state-check.js',import.meta.url),'utf8')+';observeReviewState(["/6490","/12730","/14810"])'});
    const check_script=await readFile(new URL('./comment-check.js',import.meta.url),'utf8');
    const ready='!!window.besogo?.editor && document.documentElement.dataset.zenReady==="on" && !document.documentElement.dataset.zenPreparing && !document.documentElement.dataset.zenHandoff';
    for(const [path,width,height,scale,turn] of [['/6490',1440,1000,1],['/6490',390,844,2],['/12730',390,844,2],['/14810',320,568,2],['/6490',390,844,2,true]]) {
      await page.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:scale,mobile:width<600,screenWidth:width,screenHeight:height});
      await navigate('https://tsumego.com'+path);await wait("location.pathname==='"+path+"'&&("+ready+")");await pause(500);
      const label=path+' at '+width+(turn?' turned':'');
      if(turn){await ev('document.documentElement.dataset.zenMinStep="70";window.dispatchEvent(new Event("resize"))');await page.send('Emulation.setDeviceMetricsOverride',{width:width-2,height,deviceScaleFactor:scale,mobile:true,screenWidth:width-2,screenHeight:height});await pause(600);
        // Auto-fit's stones-first crop of this corner problem is nearly square, so turning gains nothing and it stays upright.
        if(await ev('besogo.scaleParameters.rotation!==-1'))results.push('Board turned before Review: '+label);else results.push('Not turnable under the stones-first crop, checked upright: '+label);}
      await ev(check_script);await ev('window.__comment=checkReviewComment()');
      for(let i=0;i<40;i++){const step=await ev('__comment.next()');if(step.done){results.push(...step.value.map(c=>label+': '+c));break;}
        const a=step.value;if(a.key){await page.send('Input.dispatchKeyEvent',{type:'rawKeyDown',key:a.key,code:a.key,windowsVirtualKeyCode:a.code});await page.send('Input.dispatchKeyEvent',{type:'keyUp',key:a.key,code:a.key,windowsVirtualKeyCode:a.code});await pause(250);}
        if(a.shot)await shot('comment-'+path.slice(1)+'-'+width+(turn?'-turned':'')+'-'+a.shot);}
    }
    await page.send('Page.removeScriptToEvaluateOnNewDocument',{identifier:probe.identifier});
  }

  if(values['solid-only']) {
    // iOS Safari paints a solid bar where a full-width fixed layer or a modal backdrop meets
    // the viewport edge, and keeps it. Walk real interactions as an iPhone; none may do that.
    const ready='!!window.besogo?.editor && document.documentElement.dataset.zenReady==="on" && !document.documentElement.dataset.zenPreparing && !document.documentElement.dataset.zenHandoff';
    const probe=await readFile(new URL('./edge-solid-check.js',import.meta.url),'utf8'), log=[];
    await page.send('Emulation.setUserAgentOverride',{userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',platform:'iPhone'}).catch(()=>{});
    await page.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
    await page.send('Emulation.setDeviceMetricsOverride',{width:440,height:796,deviceScaleFactor:3,mobile:true,screenWidth:440,screenHeight:956});
    const tapAt=async({x,y})=>{for(const type of ['touchStart','touchEnd'])await page.send('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'?[]:[{x,y}]});await pause(350);};
    const tapEl=async sel=>{const r=await ev(`(()=>{const n=${sel};if(!n)return null;const r=n.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);if(!r)return false;await tapAt(r);return true;};
    const button=label=>`[...document.querySelectorAll('button, summary, [role=button]')].find(b=>(b.getAttribute('aria-label')||b.textContent).trim()===${JSON.stringify(label)}&&b.getClientRects().length)`;
    const point=move=>ev(`(()=>{const s=document.querySelector('.besogo-board > svg'),g=s.querySelector('rect.besogo-svg-lines'),st=+g.getAttribute('width')/(besogo.editor.getRoot().getSize().x-1);const p=new DOMPoint(+g.getAttribute('x')+(${move.x}-1)*st,+g.getAttribute('y')+(${move.y}-1)*st).matrixTransform(s.getScreenCTM());return {x:p.x,y:p.y}})()`);
    const record=async step=>{await pause(250);await ev(probe);const state=await ev('edgeSolidState()');log.push({step,...state});await shot('solid-'+String(log.length).padStart(2,'0')+'-'+step);return state;};
    for (const taps of ['off','on']) {
    const pass='show taps '+taps+': ';
    await navigate('https://tsumego.com/5193');await wait("location.pathname==='/5193'&&("+ready+")");await pause(800);
    await ev(`(s=>{s.value='${taps}';s.dispatchEvent(new Event('change',{bubbles:true}))})(document.querySelector('select[aria-label="Show taps (for recording)"]'))`);await pause(200);
    await record(pass+'load');
    let m=await ev('JSON.stringify(besogo.editor.getRoot().children.find(n=>!n.canStillEndCorrect()).move)');await tapAt(await point(JSON.parse(m)));await pause(600);await record(pass+'wrong move');{const o=await ev(`(b=>({glow:b.classList.contains('besogo-board-red-glow'),shadow:getComputedStyle(b).boxShadow,status:document.querySelector('#status').textContent.trim()}))(document.querySelector('.besogo-board'))`);check(o.glow&&o.shadow==='none',pass+'the site marks a mistake, and no red outline shows: '+JSON.stringify(o));}
    await tapEl(button('Reset problem'))||await tapEl('document.querySelector(".zen-reset")');await pause(500);await record(pass+'reset');
    for(let i=0;i<8;i++){const n=await ev('JSON.stringify(besogo.editor.getCurrent().children.find(n=>n.canStillEndCorrect())?.move||null)');if(n==='null'||await ev('document.querySelector("#status").textContent.includes("Correct!")'))break;await tapAt(await point(JSON.parse(n)));await pause(700);await record(pass+'move '+(i+1));}
    await record(pass+'solved');{const o=await ev(`(b=>({inline:b.style.boxShadow,shadow:getComputedStyle(b).boxShadow,status:document.querySelector('#status').textContent.trim()}))(document.querySelector('.besogo-board'))`);check(/67, 255, 40/.test(o.inline)&&o.shadow==='none',pass+'the site marks the solve, and no green outline shows: '+JSON.stringify(o));}
    if(await tapEl(`document.querySelector('.zen-toolbar [id^="besogo-review-button"]:not([id$=inactive]), .zen-review-toggle, .zen-toolbar button.zen-review')`)){await pause(600);await record(pass+'review');}
    await tapEl('document.querySelector(".zen-options summary")');await pause(500);await record(pass+'menu open');
    await ev(`(s=>{s.value='glass';s.dispatchEvent(new Event('change',{bubbles:true}))})(document.querySelector('select[aria-label="Edge fade"]'))`);await pause(300);await record(pass+'setting changed');
    await tapEl('document.querySelector("#zen-problem-sheet header button")');await pause(500);await record(pass+'menu closed');
    await ev(`(s=>{s.value='mat';s.dispatchEvent(new Event('change',{bubbles:true}))})(document.querySelector('select[aria-label="Edge fade"]'))`);
    await tapEl('document.querySelector(".zen-nav-trigger")');await pause(500);await record(pass+'navigation open');
    await tapEl('document.querySelector("#zen-navigation-sheet header button")');await pause(500);await record(pass+'navigation closed');
    await tapEl('document.querySelector(".zen-next")');await wait('location.pathname!=="/5193"&&('+ready+')',30000);await pause(800);await record(pass+'next');
    await tapEl('document.querySelector(".zen-reset")');await pause(900);await record(pass+'show differently');
    }
    await ev(`(s=>{s.value='off';s.dispatchEvent(new Event('change',{bubbles:true}))})(document.querySelector('select[aria-label="Show taps (for recording)"]'))`);
    await page.send('Emulation.setTouchEmulationEnabled',{enabled:false});await page.send('Emulation.setUserAgentOverride',{userAgent:''}).catch(()=>{});
    await writeFile(join(output,'solid.json'),JSON.stringify(log,null,1));
    const bad=log.filter(r=>r.top||r.bottom||r.scroll!==240||!r.edges);
    results.push(...log.map(r=>`${r.step}: top ${r.top||'clear'}, bottom ${r.bottom||'clear'}, modal ${r.modal.join(',')||'none'}, scroll ${r.scroll}`));
    check(!bad.length,'No interaction gives Safari a solid edge, with Show taps off or on: '+JSON.stringify(bad));
  }
  if(values['contrast-only']) {
    // WCAG contrast of every text in the ••• and ☰ sheets, light and dark, phone and desktop.
    const ready='!!window.besogo?.editor && document.documentElement.dataset.zenReady==="on" && !document.documentElement.dataset.zenPreparing && !document.documentElement.dataset.zenHandoff';
    const audit=await readFile(new URL('./contrast-check.js',import.meta.url),'utf8'), rows=[];
    for(const [form,width,height,phone] of [['phone',390,844,true],['desktop',1440,900,false]]) for(const scheme of ['light','dark']) for(const path of ['/5193','/6490']) {
      await page.send('Emulation.setUserAgentOverride',phone?{userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',platform:'iPhone'}:{userAgent:''}).catch(()=>{});
      await page.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:2,mobile:phone,screenWidth:width,screenHeight:height});
      await page.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:scheme}]});
      await navigate('https://tsumego.com'+path);await wait("location.pathname==='"+path+"'&&("+ready+")");await pause(700);await ev(audit);
      const label=[form,scheme,path.slice(1)].join('-');
      await ev('document.querySelector(".zen-options summary").click()');await pause(400);
      await ev(`[...document.querySelectorAll('#zen-problem-sheet button, #zen-problem-sheet summary')].filter(b=>/^(More|Show more)\b/.test(b.textContent.trim())&&b.getClientRects().length).forEach(b=>b.click())`);await pause(400);
      await shot('contrast-'+label+'-problem');
      rows.push(...(await ev('auditContrast("#zen-problem-sheet[open]")')).map(r=>({case:label,...r})));
      for(const [part,where] of [['middle',.5],['end',1]]){await ev(`(s=>s.scrollTop=(s.scrollHeight-s.clientHeight)*${where})(document.querySelector('#zen-problem-sheet'))`);await pause(200);await shot('contrast-'+label+'-problem-'+part);}
      await ev('document.querySelector("#zen-problem-sheet").close()');await pause(250);
      await ev('document.querySelector("[aria-label=\'Site navigation\'][aria-haspopup]").click()');await pause(400);
      await shot('contrast-'+label+'-navigation');
      rows.push(...(await ev('auditContrast("#zen-navigation-sheet[open]")')).map(r=>({case:label,...r})));
      await ev(`(s=>s.scrollTop=s.scrollHeight)(document.querySelector('#zen-navigation-sheet'))`);await pause(200);await shot('contrast-'+label+'-navigation-end');
      await ev('document.querySelector("#zen-navigation-sheet").close()');await pause(250);
    }
    await page.send('Emulation.setEmulatedMedia',{features:[]});await page.send('Emulation.setUserAgentOverride',{userAgent:''}).catch(()=>{});
    await writeFile(join(output,'contrast.json'),JSON.stringify(rows,null,1));
    const failing=rows.filter(r=>!r.pass&&!r.disabled);
    results.push(`${rows.length} texts measured, ${rows.filter(r=>r.pass).length} at AA`);
    check(!failing.length,'Every enabled text in the sheets meets WCAG AA: '+JSON.stringify(failing.slice(0,8)));
  }
  if(values['menu-only']) {
    // The saved view and the ••• sheet, with real clicks at 320, 390 and desktop.
    const probe=await page.send('Page.addScriptToEvaluateOnNewDocument',{source:await readFile(new URL('./menu-check.js',import.meta.url),'utf8')+';observeMenu()'});
    const ready='!!window.besogo?.editor && document.documentElement.dataset.zenReady==="on" && !document.documentElement.dataset.zenPreparing && !document.documentElement.dataset.zenHandoff';
    const size=(width,height)=>page.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:2,mobile:width<601,screenWidth:width,screenHeight:height});
    const settle=async()=>{await pause(350);await wait(ready);await pause(350);};
    const load=async path=>{await navigate('https://tsumego.com'+path);await settle();};
    const click=async sel=>{const r=await ev(`(()=>{const n=${sel};n.scrollIntoView({block:'nearest'});const r=n.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);for(const type of ['mousePressed','mouseReleased'])await page.send('Input.dispatchMouseEvent',{type,x:r.x,y:r.y,button:'left',clickCount:1});await pause(300);};
    const sheet=async()=>{await click('document.querySelector(".zen-options summary")');await pause(200);};
    const close=async()=>{await click('document.querySelector("#zen-problem-sheet header button")');await pause(250);};
    const view=name=>click(`[...document.querySelectorAll('.zen-site-sheet button, .zen-toolbar button')].find(b=>b.textContent==='${name}'&&b.getClientRects().length)`);
    for(const [width,height] of [[320,568],[390,844],[1440,900]]){
      const where=width+': ';await size(width,height);await load('/5193');
      check((await ev('__zenView()')).saved==='frame',where+'Auto-fit by default');
      await sheet();await view('Full board');await close();await settle();let v=await ev('__zenView()');check(v.whole&&v.saved==='full',where+'Full board shows the whole board');
      await ev('document.querySelector(".zen-next").click()');await wait('location.pathname==="/5194"&&('+ready+')');await settle();v=await ev('__zenView()');let f=await ev('__zenMenuTrace.first');
      check(v.whole&&f.view==='full'&&f.rotation===-1,where+'Next keeps Full board from the first visible frame '+JSON.stringify(f));
      const h=await page.send('Page.getNavigationHistory');await page.send('Page.navigateToHistoryEntry',{entryId:h.entries[h.currentIndex-1].id});await wait('location.pathname==="/5193"&&('+ready+')');await settle();check((await ev('__zenView()')).whole,where+'Back keeps Full board');
      await page.send('Page.reload');await settle();await wait('location.pathname==="/5193"&&('+ready+')');check((await ev('__zenView()')).whole,where+'Reload keeps Full board');
      await load('/5190');v=await ev('__zenView()');f=await ev('__zenMenuTrace.first');check(v.whole&&v.rotation===-1&&f.rotation===-1,where+'A new page keeps Full board and is not turned');
      await sheet();await view('Auto-fit');await close();await settle();v=await ev('__zenView()');check(!v.whole&&v.saved==='frame',where+'Auto-fit returns');
      if(width<=390)check((await ev('besogo.scaleParameters.rotation'))!==-1,where+'Auto-fit may turn a wide problem again');
      await load('/5193');check((await ev('__zenView()')).saved==='frame',where+'Auto-fit is saved too');
    }
    await size(390,844);await load('/6699');await sheet();await ev(`(()=>{const s=document.querySelector('select[aria-label="Random ±90° rotation"]');s.value='on';s.dispatchEvent(new Event('change'))})()`);await view('Full board');await close();await settle();
    for(let i=0;i<6;i++){await load('/6699');check((await ev('__zenMenuTrace.first')).rotation===-1&&(await ev('__zenView()')).rotation===-1,'Full board skips the random turn, load '+(i+1));}
    await sheet();await view('Auto-fit');await ev(`(()=>{const s=document.querySelector('select[aria-label="Random ±90° rotation"]');s.value='off';s.dispatchEvent(new Event('change'))})()`);await close();await settle();
    for(const [width,height] of [[320,568],[390,844],[1440,900]])for(const rungs of [false,true]){
      const where='tiles '+width+(rungs?' rungs':'')+': ';await size(width,height);await load('/5193');
      await ev(`(()=>{document.querySelector('.zen-options').open=true;[...document.querySelectorAll('button')].find(b=>b.textContent==='Site page').click()})()`);await wait('document.documentElement.dataset.zen==="off"');await pause(300);
      await ev('__zenPaintTiles('+rungs+')');const native=await ev('__zenTiles()');await ev('document.querySelector(".problem-nav").scrollIntoView({block:"center"})');await pause(200);await shot('tile-native-'+width+(rungs?'-rungs':''));
      await ev('document.querySelector(".zen-resume").click()');await settle();await sheet();await ev('document.querySelector(".problem-nav").scrollIntoView({block:"center"})');await pause(250);const focus=await ev('__zenTiles()');await shot('tile-focus-'+width+(rungs?'-rungs':''));
      check(focus.length===native.length&&focus.length>=8,where+'all states present');
      focus.forEach((tile,i)=>{const n=native[i];
        check(JSON.stringify(tile.box)===JSON.stringify(n.box)&&JSON.stringify(tile.link)===JSON.stringify(n.link),where+'tile '+i+' has the native box and link '+JSON.stringify([tile.link,n.link]));
        check(Math.abs(tile.x-n.x)<=1&&Math.abs(tile.y-n.y)<=1,where+'tile '+i+' number where native puts it '+JSON.stringify([tile.x,tile.y,n.x,n.y]));
        if(rungs)check(tile.rung&&JSON.stringify(tile.rung.map(Math.round))===JSON.stringify(n.rung.map(Math.round)),where+'tile '+i+' rung where native puts it '+JSON.stringify([tile.rung,n.rung]));});
      await close();
    }
    // A real solve, then the links, then the conversation.
    const solve=async()=>{for(let i=0;i<10&&!await ev('document.querySelector("#status")?.textContent.includes("Correct!")');i++){const m=await ev('(()=>{const n=besogo.editor.getCurrent().children.find(c=>c.canStillEndCorrect());return n?{x:n.move.x,y:n.move.y}:null})()');if(!m)break;
      const p=await ev('(()=>{const s=document.querySelector(".besogo-board > svg"),l=s.querySelector("rect.besogo-svg-lines"),c=s.getScreenCTM(),d=+l.getAttribute("width")/18;return {x:c.e+(+l.getAttribute("x")+('+m.x+'-1)*d)*c.a,y:c.f+(+l.getAttribute("y")+('+m.y+'-1)*d)*c.d}})()');
      for(const type of ['mousePressed','mouseReleased'])await page.send('Input.dispatchMouseEvent',{type,x:p.x,y:p.y,button:'left',clickCount:1});await pause(800);}};
    const row='(()=>{const l=document.querySelector("#editSection > p");if(!l||!l.getClientRects().length)return null;const r=l.getBoundingClientRect();return {links:[...l.querySelectorAll("a")].filter(a=>a.getClientRects().length).map(a=>a.textContent.trim()),left:r.left,right:r.right,width:innerWidth,more:!!document.querySelector("#editToggle")?.getClientRects().length}})()';
    const seen=()=>ev('(()=>{const c=document.querySelector("#editSection");return !!c&&c.getClientRects().length>0})()');
    for(const [width,height] of [[320,568],[390,844],[1440,900]]){
      const where='links '+width+': ';await size(width,height);await load('/5193');await sheet();
      // The links show in place of More exactly when the site offers More, before a solve too.
      {const offered=await ev('(()=>{const m=document.querySelector("#editToggle");return !!m&&(!m.classList.contains("play-edit-toggle--after-solve")||m.style.display==="inline")})()');
      check(await seen()===offered,where+'before a solve, the links show exactly when the site offers More: '+offered);}await close();
      await solve();check(await ev('document.querySelector("#status").textContent.includes("Correct!")'),where+'solved with real clicks');
      await sheet();const r=await ev(row);check(r&&r.links.includes('Find Similar Problems')&&!r.more,where+'links on a row of their own, no More (the site dropped Download SGF on 5 Nov 2026) '+JSON.stringify(r));
      check(!await ev('document.querySelector("#showFilters, .play-filters-toggle")?.getClientRects().length'),where+'hidden site links stay hidden');
      check(await ev('(()=>{const h=document.querySelector("#zen-problem-sheet header"),c=getComputedStyle(h);return (+c.zIndex||0)>20})()'),where+'the sheet header stays above the current tile ring');
      check(r.left>=0&&r.right<=r.width,where+'the row fits the sheet');await ev('document.querySelector("#editSection").scrollIntoView({block:"center"})');await pause(200);await shot('links-'+width);
      await close();
      await ev(`(()=>{document.querySelector('.zen-options').open=true;[...document.querySelectorAll('button')].find(b=>b.textContent==='Site page').click()})()`);await wait('document.documentElement.dataset.zen==="off"');await pause(300);
      // Older builds of the site have a More toggle; newer ones do not.
      if(await ev('!!document.querySelector("#editToggle")')){
        check(await ev('(()=>{const m=document.querySelector("#editToggle");return !!m.getClientRects().length&&!document.querySelector("#editSection").getClientRects().length})()'),where+'Regular keeps the native More, closed');
        await click('document.querySelector("#editToggle")');await pause(450);check(await seen(),where+'native More still opens the links');await click('document.querySelector("#editToggle")');await pause(450);
      } else check(await ev('!!document.querySelector("#findSimilarProblems")'),where+'Regular keeps the site\'s own links (the site has no More toggle now)');
      await ev('document.querySelector(".zen-resume").click()');await settle();
      const c=a=>'conversation '+width+': '+a;
      await ev('document.querySelector(".zen-review").click()');await wait('besogo.editor.getReviewMode()&&!document.querySelector(".zen-review").hasAttribute("aria-busy")');await pause(500);
      const line='(()=>{const b=document.querySelector(".zen-review-conversation");return b&&!b.hidden&&b.getClientRects().length?b.textContent:null})()';
      await ev('(()=>{const m=new Map();m.set(besogo.editor.getCurrent(),2);besogo.editor.setAnchoredComments(m)})()');await pause(350);
      check(await ev(line)===null,c('a guest, without the site comment section, gets no line'));
      await ev('__zenFixtureComments()');await ev('besogo.editor.notifyListeners({navChange:true})');await pause(350);check(await ev(line)==='2 player comments',c('a node with a bubble shows its count'));await shot('conversation-'+width);
      await ev('document.querySelector("#commentSpace").style.display="none";besogo.editor.notifyListeners({navChange:true})');await pause(300);check(await ev(line)===null,c('hidden by the site on an unsolved problem, no line'));
      await ev('document.querySelector("#commentSpace").style.display="";besogo.editor.notifyListeners({navChange:true})');await pause(300);
      const opened=await ev('__zenFixture.opened');const node=await ev('besogo.editor.getCurrent().moveNumber');await click('document.querySelector(".zen-review-conversation")');await pause(900);
      check(await ev('(()=>{const d=document.querySelector("#zen-problem-sheet"),s=document.querySelector("#commentSpace");return d.open&&d.contains(s)&&s.getClientRects().length>0})()'),c('the line opens the comment section, visible inside More, in the sheet'));
      check(await ev('__zenFixture.opened')===opened+1&&await ev('__zenFixture.filter')==='Here & ahead',c('through the site event and its Here & ahead filter'));
      check(await ev('besogo.editor.getReviewMode()&&besogo.editor.getCurrent().moveNumber')===node,c('Review keeps its position'));await shot('conversation-sheet-'+width);
      await close();check(await ev('!document.querySelector("#zen-problem-sheet").open&&besogo.editor.getReviewMode()'),c('closing returns to Review'));
      await ev('__zenFixture.filter=null;besogo.editor.notifyListeners({navChange:true})');await pause(300);
      const bubble=await ev('(()=>{const b=document.querySelector(".besogo-tree-comment-badge__bubble");if(!b)return null;b.scrollIntoView({block:"nearest",inline:"nearest"});const r=b.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()');check(!!bubble,c('the site draws the bubble'));
      for(const type of ['mousePressed','mouseReleased'])await page.send('Input.dispatchMouseEvent',{type,x:bubble.x,y:bubble.y,button:'left',clickCount:1});await pause(900);
      check(await ev('document.querySelector("#zen-problem-sheet").open'),c('tapping the bubble opens the conversation'));await close();
      await ev('document.querySelector("#commentSpace").remove()');
    }
    await page.send('Page.removeScriptToEvaluateOnNewDocument',{identifier:probe.identifier});
  }
  if(values['next-only']) {
    // The wait on Next, with the site's answer delayed. The page logs itself: see next-check.js.
    const ready='!!window.besogo?.editor && document.documentElement.dataset.zenReady==="on" && !document.documentElement.dataset.zenPreparing && !document.documentElement.dataset.zenHandoff';
    const probe=await page.send('Page.addScriptToEvaluateOnNewDocument',{source:await readFile(new URL('./next-check.js',import.meta.url),'utf8')+';observeNext()'});
    await page.send('Network.enable');
    const latency=ms=>page.send('Network.emulateNetworkConditions',{offline:false,latency:ms,downloadThroughput:-1,uploadThroughput:-1});
    const size=(width,height)=>page.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:2,mobile:width<601,screenWidth:width,screenHeight:height});
    const load=async path=>{await latency(0);await navigate('https://tsumego.com'+path);await pause(300);await wait(ready);await pause(400);await ev('sessionStorage.removeItem("zen-next-log")');};
    const box=()=>ev(`(()=>{const r=document.querySelector('.zen-next').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
    const tap=async()=>{const r=await box();for(const type of ['mousePressed','mouseReleased'])await page.send('Input.dispatchMouseEvent',{type,x:r.x,y:r.y,button:'left',clickCount:1});};
    const log=async()=>JSON.parse(await ev('sessionStorage.getItem("zen-next-log")')||'[]');
    const after=(rows,from,to)=>rows.filter(r=>r.at>=from&&r.at<=to);
    for(const [width,height,turn] of [[390,844,false],[320,568,false],[1440,900,false],[390,844,true]]){
      const where=width+(turn?' turned':'')+': ';await size(width,height);await load('/5193');
      if(turn){await ev('document.documentElement.dataset.zenMinStep="70"');await size(width-2,height);await pause(300);await size(width,height);await pause(700);check(await ev('besogo.scaleParameters.rotation!==-1'),where+'board is turned');}
      await ev(`setTimeout(()=>document.querySelector('.zen-next').click(),11000)`);await latency(13000);await pause(100);await tap();await wait('location.pathname==="/5194"&&('+ready+')',40000);await pause(300);
      const rows=await log();check(rows.length>100,where+'the page logged the wait '+rows.length);
      check(after(rows,0,180).every(r=>!r.busy),where+'nothing shown below 200 ms');
      const waiting=after(rows,250,9900);check(waiting.length>50&&waiting.every(r=>r.busy==='true'&&r.after!=='none'&&r.color==='rgba(0, 0, 0, 0)'),where+'spinner shown from 200 ms until the limit');
      check(new Set(rows.map(r=>r.box)).size===1,where+'the button keeps its size and place');check(rows.every(r=>!r.disabled),where+'the button stays usable');check(after(rows,0,9900).every(r=>!r.cover),where+'no cover over the wait');
      const stopped=after(rows,10100,10950);check(stopped.length>5&&stopped.every(r=>!r.busy&&r.color==='rgb(255, 255, 255)'&&r.after==='none'),where+'stopped at 10 s, with the label back and no message');
      check(after(rows,11300,14000).some(r=>r.busy==='true'),where+'a further press works and waits again');
      check(!await ev('document.querySelector(".zen-next").hasAttribute("aria-busy")'),where+'nothing survives into the next page');
    }
    await size(390,844);
    // The arrow key goes straight to the site's link.
    await load('/5193');await latency(2500);await pause(100);await page.send('Input.dispatchKeyEvent',{type:'rawKeyDown',key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39});await page.send('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39});
    await wait('location.pathname==="/5194"&&('+ready+')',40000);check((await log()).some(r=>r.busy==='true'),'The arrow key route shows the wait');
    // Other navigation does not.
    await load('/5193');await latency(2500);await pause(100);await ev('__nextMark();location.href="/5195"');await wait('location.pathname==="/5195"&&('+ready+')',40000);let rows=await log();check(rows.length>10&&rows.every(r=>!r.busy),'A navigation that is not Next shows nothing');
    // Cancelled: the page is still here, so ask it directly.
    await load('/5193');await ev(`setTimeout(()=>window.stop(),1000)`);await latency(6000);await pause(100);await tap();await pause(2500);await latency(0);
    check(await ev('location.pathname')==='/5193'&&!await ev('document.querySelector(".zen-next").hasAttribute("aria-busy")'),'A cancelled navigation clears the wait');
    // Reduced motion.
    await page.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});await load('/5193');await latency(2500);await pause(100);await tap();await wait('location.pathname==="/5194"&&('+ready+')',40000);rows=await log();
    check(rows.some(r=>r.busy==='true')&&rows.filter(r=>r.busy==='true').every(r=>r.animation==='none'),'Reduced Motion: a static busy state');await page.send('Emulation.setEmulatedMedia',{features:[]});
    // The look, set directly, because a screenshot can't be taken during a navigation.
    for(const [width,height] of [[390,844],[320,568]]){await size(width,height);await load('/5193');await ev('document.querySelector(".zen-next").setAttribute("aria-busy","true")');await pause(200);await shot('next-wait-'+width);}
    // Regular mode.
    await size(1440,900);await load('/5193');await ev(`(()=>{document.querySelector('.zen-options').open=true;[...document.querySelectorAll('button')].find(b=>b.textContent==='Site page').click()})()`);await wait('document.documentElement.dataset.zen==="off"');await pause(300);
    await latency(2500);await pause(100);await ev('__nextMark();location.href=new URL(window.nextButtonLink,location.href).href');await pause(4000);await latency(0);rows=await log();check(rows.every(r=>!r.busy),'Regular mode shows nothing');
    await ev(`document.querySelector('.zen-resume')?.click()`);await pause(500);
    // A fast page, which only a local server is: nothing may flash.
    await size(390,844);await navigate(new URL('harness/real.html?p=0',preview).href);await wait(ready);await pause(400);await ev('sessionStorage.removeItem("zen-next-log");__nextMark()');
    const local=await ev('performance.timeOrigin');await ev('location.href=document.querySelector("#besogo-next-button").href');await wait('performance.timeOrigin!=='+local+'&&('+ready+')');check(!(await log()).some(r=>r.busy),'A fast page shows no spinner');
    await page.send('Page.removeScriptToEvaluateOnNewDocument',{identifier:probe.identifier});
  }
  if(values['taps-only']) {
    // Show taps at 390 px, with real touch. Review through the same hook as --tree-only.
    const probe=await page.send('Page.addScriptToEvaluateOnNewDocument',{source:await readFile(new URL('./tree-check.js',import.meta.url),'utf8')+';observeTree()'});
    const ready='!!window.besogo?.editor && document.documentElement.dataset.zenReady==="on" && !document.documentElement.dataset.zenPreparing && !document.documentElement.dataset.zenHandoff';
    await page.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});await page.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:2,mobile:true,screenWidth:390,screenHeight:844});
    const load=async path=>{await navigate('https://tsumego.com'+path);await pause(300);await wait(ready);await pause(400);};
    const option=value=>ev(`(()=>{const s=document.querySelector('select[aria-label="Show taps (for recording)"]');s.value='${value}';s.dispatchEvent(new Event('change'));return s.value})()`);
    const tapAt=async p=>{await page.send('Input.synthesizeTapGesture',{x:p.x,y:p.y,tapCount:1,gestureSourceType:'touch'});await pause(120);};
    const watch=`(()=>{window.__rings=0;new MutationObserver(r=>{for(const m of r)for(const n of m.addedNodes)if(n.classList?.contains('zen-tap'))__rings++}).observe(document.documentElement,{childList:true,subtree:true})})()`;
    const firstMove='(()=>{const n=besogo.editor.getRoot().children[0].move;return {x:n.x,y:n.y}})()';
    const point=m=>ev('__zenPointFor('+m.x+','+m.y+')');
    const placed='(()=>{let n=besogo.editor.getCurrent();while(n&&n.parent&&n.parent.parent)n=n.parent;return n&&n.move?{x:n.move.x,y:n.move.y}:null})()';
    await load('/5193');check(await ev('document.documentElement.dataset.zenShowTaps')==='off'&&await ev(`document.querySelector('select[aria-label="Show taps (for recording)"]').value`)==='off','Show taps is off by default');
    await ev(watch);let m=await ev(firstMove);await tapAt(await point(m));await pause(500);check(await ev('__rings')===0,'Off: no ring is drawn');const offPlaced=await ev(placed);await ev('document.querySelector(".zen-reset").click()');await pause(300);
    await option('on');await pause(200);check(await ev('document.documentElement.dataset.zenShowTaps')==='on','Turning it on applies at once');
    await tapAt(await point(m));await pause(60);check(await ev('__rings')===1,'A tap draws one ring');await pause(500);const onPlaced=await ev(placed);check(onPlaced&&onPlaced.x===m.x&&onPlaced.y===m.y&&JSON.stringify(onPlaced)===JSON.stringify(offPlaced),'A tap lands on the same intersection as with it off');await shot('taps-board');
    check(await ev('getComputedStyle(document.querySelector(".zen-taps")).pointerEvents')==='none'&&await ev('!document.elementFromPoint(200,300)?.closest(".zen-taps,.zen-tap")'),'The overlay takes no pointer events');await pause(400);check(await ev('document.querySelectorAll(".zen-tap").length')===0,'Rings clear after their fade');
    await ev('document.querySelector(".zen-reset").click()');await pause(300);
    // Review tree drag and tap.
    await ev('document.querySelector(".zen-review").click()');await wait('besogo.editor.getReviewMode()&&!document.querySelector(".zen-review").hasAttribute("aria-busy")');await pause(500);
    const t0=await ev('__zenTree()');const c={x:(t0.box.left+t0.box.right)/2,y:(t0.box.top+t0.box.bottom)/2};await ev('__rings=0');await page.send('Input.synthesizeScrollGesture',{x:c.x,y:c.y,xDistance:0,yDistance:-90,gestureSourceType:'touch',speed:1200,preventFling:true});await pause(300);
    let t1=await ev('__zenTree()');check(t1.st>=60&&t1.node===t0.node&&t1.page===t0.page&&t1.view===t0.view,'A tree drag scrolls as before, and is not a tap '+t1.st);check(await ev('__rings')===1,'The drag draws one ring');
    await ev('document.querySelector(".besogo-tree").scrollTop=0');await pause(150);const near=await ev('__zenTreeTarget()');await tapAt(near);await pause(300);t1=await ev('__zenTree()');check(t1.node===near.key,'Tapping a tree node selects it');
    // Above a sheet.
    await ev('document.querySelector(".zen-options summary").click()');await pause(500);await ev('__rings=0');await tapAt({x:195,y:400});await pause(40);check(await ev('document.querySelector(".zen-taps").matches(":popover-open")&&__rings===1'),'Rings draw above an open sheet');await shot('taps-sheet');await pause(450);check(await ev('document.querySelector("#zen-problem-sheet").open'),'A tap inside the sheet leaves it open');await ev('document.querySelector("#zen-problem-sheet header button").click()');await pause(300);
    // Next, and the next page.
    await load('/5193');await pause(200);check(await ev('document.documentElement.dataset.zenShowTaps')==='on','It survives a reload');await ev('document.querySelector(".zen-next").click()');await wait('location.pathname==="/5194"&&('+ready+')');await pause(400);check(await ev('document.documentElement.dataset.zenShowTaps')==='on','It survives Next');await ev(watch);m=await ev(firstMove);await tapAt(await point(m));await pause(60);check(await ev('__rings')===1,'Rings draw on the next page');await pause(500);
    // Regular mode.
    await load('/5193');await ev(`(()=>{document.querySelector('.zen-options').open=true;[...document.querySelectorAll('button')].find(b=>b.textContent==='Site page').click()})()`);await wait('document.documentElement.dataset.zen==="off"');await pause(400);await ev(watch);await tapAt({x:195,y:300});await pause(300);check(await ev('__rings')===0&&await ev('!document.querySelector(".zen-taps")'),'Off in Regular mode');await ev('document.querySelector(".zen-resume").click()');await wait(ready);await pause(400);
    // Reduced motion.
    await page.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});await load('/5193');await tapAt({x:195,y:300});await pause(30);check(await ev(`(()=>{const r=document.querySelector('.zen-tap');if(!r)return true;const c=getComputedStyle(r);return c.transitionDuration==='0s'})()`),'Reduced Motion: a static dot');await page.send('Emulation.setEmulatedMedia',{features:[]});
    await option('off');await pause(200);await page.send('Emulation.setTouchEmulationEnabled',{enabled:false,maxTouchPoints:1});
    await page.send('Page.removeScriptToEvaluateOnNewDocument',{identifier:probe.identifier});
  }
  if(values['tree-only']) {
    // Review on real large trees, with real touch, wheel, keys and clicks.
    const probe=await page.send('Page.addScriptToEvaluateOnNewDocument',{source:await readFile(new URL('./tree-check.js',import.meta.url),'utf8')+';observeTree()'});
    const ready='!!window.besogo?.editor && document.documentElement.dataset.zenReady==="on" && !document.documentElement.dataset.zenPreparing && !document.documentElement.dataset.zenHandoff';
    const size=async(width,height,touch)=>{await page.send('Emulation.setTouchEmulationEnabled',{enabled:touch,maxTouchPoints:1});await page.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:2,mobile:touch,screenWidth:width,screenHeight:height});};
    const tree=()=>ev('__zenTree()');
    const load=async path=>{await navigate('https://tsumego.com'+path);await pause(300);await wait(ready);await pause(400);};
    const review=async()=>{await ev('document.querySelector(".zen-review").click()');await wait('besogo.editor.getReviewMode()&&!document.querySelector(".zen-review").hasAttribute("aria-busy")');await pause(500);};
    const center=async()=>{const m=await tree();return {x:(m.box.left+m.box.right)/2,y:(m.box.top+m.box.bottom)/2};};
    const drag=async(xDistance,yDistance,at)=>{const p=at||await center();await page.send('Input.synthesizeScrollGesture',{x:p.x,y:p.y,xDistance,yDistance,gestureSourceType:'touch',speed:1200,preventFling:true});await pause(300);};
    const wheel=async(deltaX,deltaY)=>{const p=await center();await page.send('Input.dispatchMouseEvent',{type:'mouseWheel',x:p.x,y:p.y,deltaX,deltaY});await pause(300);};
    const key=async name=>{for(const type of ['rawKeyDown','keyUp'])await page.send('Input.dispatchKeyEvent',{type,key:name,code:name,windowsVirtualKeyCode:{ArrowDown:40,ArrowUp:38,ArrowRight:39,ArrowLeft:37}[name]});await pause(220);};
    const click=async(x,y)=>{for(const type of ['mousePressed','mouseReleased'])await page.send('Input.dispatchMouseEvent',{type,x,y,button:'left',clickCount:1});await pause(350);};
    const tap=async(point,touch)=>{if(touch){await page.send('Input.synthesizeTapGesture',{x:point.x,y:point.y,tapCount:1,gestureSourceType:'touch'});await pause(350);}else await click(point.x,point.y);};
    for(const [label,path,width,height,touch,turn] of [['390','/5193',390,844,true],['320','/5193',320,568,true],['desktop','/5193',1440,900,false],['wide','/5193',1920,1080,false],['tablet','/5193',1180,820,true],['turned','/5193',390,844,true,true]]){
      await size(width,height,touch);await load(path);
      if(turn){await ev('document.documentElement.dataset.zenMinStep="70"');await size(width-2,height,touch);await pause(300);await size(width,height,touch);await pause(700);check(await ev('besogo.scaleParameters.rotation!==-1'),label+': board is turned');}
      await review();await shot('tree-'+label+'-entered');
      let m=await tree();const where=label+': ';
      check(m.sh>m.ch&&m.inPane,where+'a large tree overflows its own box '+m.sh+'/'+m.ch);
      check(m.box.bottom<=m.pane.bottom+1&&m.box.top>=m.legend.bottom-1,where+'the tree box stays inside its pane, under the legend');
      check(m.arrows.top>=m.pane.bottom-1&&m.arrows.bottom<=m.height&&m.next.bottom<=m.height,where+'arrows and Next stay on screen');
      check(m.visible,where+'Review starts at the current node');
      const view=m.view,page0=m.page,born=m.born,start=m.node;
      if(touch){
        const on=await ev('__zenTreeTarget()');await drag(0,-90,on);m=await tree();
        check(m.st>=60,where+'a touch drag starting on a node scrolls the tree '+m.st);check(m.node===start,where+'a drag is not a tap on the node');check(m.view===view&&m.page===page0,where+'a drag does not move the board or the page');
        await drag(0,-3000);m=await tree();check(Math.abs(m.st-(m.sh-m.ch))<=1&&m.page===page0&&m.view===view,where+'dragging past the end stays in the tree');
        await drag(0,4000);await pause(300);m=await tree();check(m.st===0&&m.page===page0&&m.born===born&&m.view===view,where+'pulling down at the top scrolls nothing else and does not refresh');
        if(m.sw>m.cw){await drag(-60,-60);m=await tree();check(m.st>0&&m.sl>0,where+'a diagonal drag scrolls both axes '+m.sl+'/'+m.st);await drag(4000,4000);}
      }
      if(width>600){
        m=await tree();check(m.box.right>=m.pane.right-3&&m.box.left<=m.pane.left+3,where+'the scroller fills the white box');
        const far={x:m.box.right-14,y:(m.box.top+m.box.bottom)/2};
        await ev('document.querySelector(".besogo-tree").scrollTop=0');await pause(120);
        await page.send('Input.dispatchMouseEvent',{type:'mouseWheel',x:far.x,y:far.y,deltaX:0,deltaY:110});await pause(300);m=await tree();
        check(m.st>=60&&m.page===page0&&m.view===view,where+'the wheel scrolls from the far right of the box '+m.st);
        await ev('document.querySelector(".besogo-tree").scrollTop=0');await pause(120);
        if(touch){await drag(0,-90,far);m=await tree();check(m.st>=60&&m.page===page0,where+'a touch drag scrolls from the far right of the box '+m.st);await ev('document.querySelector(".besogo-tree").scrollTop=0');await pause(120);}
        const was=(await tree()).node;await tap(far,touch);m=await tree();check(m.node===was&&m.view===view,where+'tapping empty space does nothing');
      }
      await wheel(0,110);m=await tree();check(m.st>=60&&m.page===page0&&m.view===view,where+'the wheel scrolls the tree '+m.st);
      await wheel(0,6000);await wheel(0,6000);m=await tree();check(m.page===page0&&m.view===view,where+'the wheel past the end stays in the tree');
      if(m.sw>m.cw){await wheel(70,0);m=await tree();check(m.sl>0,where+'the horizontal wheel scrolls the tree '+m.sl);await wheel(-6000,0);}
      await wheel(0,-6000);await wheel(0,-6000);await pause(150);
      const near=await ev('__zenTreeTarget()');await tap(near,touch);m=await tree();check(m.node===near.key,where+'tapping a node selects it, as before');
      // Down through the first moves, far past the box.
      await ev('document.querySelector(".besogo-tree").scrollTop=0;besogo.editor.setCurrent(besogo.editor.getRoot().children[0])');await pause(350);
      let moves=0,jump=0;for(let i=0;i<30&&(await ev('__zenNextVisible(1)'))!==null;i++){const seen=await ev('__zenNextVisible(1)');const before=await tree();await key('ArrowDown');const after=await tree();if(after.node===before.node)break;moves++;check(after.visible,where+'ArrowDown reveals the node '+i);if(seen&&after.st!==before.st)jump++;}
      check(moves>=3&&jump===0,where+'arrow keys reveal each node without jumping when it is already shown: '+moves+' moves');
      const buttons=async selector=>{const b=await ev('(()=>{const r=document.querySelector(\''+selector+'\').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()');await tap(b,touch);};
      await buttons('.zen-review-controls button:nth-child(3)');m=await tree();check(m.visible,where+'the up button reveals the node');
      await ev('document.querySelector(".besogo-tree").scrollTop=0;document.querySelector(".besogo-tree").scrollLeft=0');await pause(100);
      const child=await ev('(()=>{const n=besogo.editor.getCurrent().children[0];return n&&n.move?{x:n.move.x,y:n.move.y}:null})()');
      if(child){const p=await ev('__zenPointFor('+child.x+','+child.y+')');await tap(p,touch);m=await tree();check(m.visible,where+'a board tap reveals the node');}
      await ev('(()=>{const n=__zenDeepest(()=>true);besogo.editor.setCurrent(n)})()');await pause(350);check((await tree()).visible,where+'the deepest node is revealed');
      await ev(`document.querySelector('.zen-options').open=true;[...document.querySelectorAll('button')].find(b=>b.textContent==='Site page').click()`);await wait('document.documentElement.dataset.zen==="off"');await pause(350);
      const native=await ev(`(()=>{const t=document.querySelector('.besogo-tree'),c=getComputedStyle(t);return {pane:!!t.closest('.zen-review-tree'),flex:c.flexGrow,max:c.maxHeight,touch:c.touchAction,over:c.overscrollBehaviorY,inline:t.getAttribute('style')}})()`);
      check(!native.pane&&native.max==='350px'&&native.flex==='0'&&native.touch==='auto'&&native.over==='auto',where+'Regular keeps the native tree box '+JSON.stringify(native));
      await ev('document.querySelector(".zen-resume").click()');await wait(ready);await pause(450);check((await tree()).inPane&&(await tree()).visible,where+'Zen mode returns to Review with the current node shown');
    }
    // Comments beside the tree, on a real commented tree.
    for(const [label,width,height] of [['390',390,844],['320',320,568]]){
      await size(width,height,true);await load('/6490');await review();const where='comments '+label+': ';
      const plain=await tree();check(plain.note===null,where+'no comment at the root');
      await ev('(()=>{const n=__zenDeepest(x=>x.comment&&x.comment.trim());besogo.editor.setCurrent(n)})()');await pause(450);
      let m=await tree();check(m.note&&m.ch<plain.ch&&Math.abs(m.box.bottom-plain.box.bottom)<1,where+'the tree shrinks for a comment and keeps its bottom edge '+plain.ch+'→'+m.ch);check(m.visible,where+'the node stays shown after the tree shrinks');
      check(m.note.top>=m.legend.bottom-1&&m.note.bottom<=m.box.top+1,where+'the comment sits between legend and tree');
      const noteTop=m.note.top;await drag(0,-60);m=await tree();check(m.note.top===noteTop&&(m.sh<=m.ch||m.st>0),where+'the comment stays put while the tree scrolls');
      await ev('(()=>{const c=besogo.editor.getCurrent();window.__keep=c.comment;c.comment="Long comment line one\\nline two\\nline three\\nline four\\nline five with more words than fit on one line at this width";besogo.editor.notifyListeners({navChange:true})})()');await pause(450);
      m=await tree();check(m.note.height<=(width<=360?47:67)&&m.ch>=(width<=360?40:60)&&m.visible,where+'a long comment leaves room for the tree '+m.note.height+'/'+m.ch);await shot('tree-comment-long-'+label);
      await ev('(()=>{const c=besogo.editor.getCurrent();c.comment=__keep;besogo.editor.notifyListeners({navChange:true})})()');await pause(300);
      await ev('(()=>{const m=new Map();m.set(besogo.editor.getCurrent(),2);besogo.editor.setAnchoredComments(m)})()');await pause(450);
      const badge='(()=>{const b=document.querySelector(".besogo-tree-comment-badge__bubble")||document.querySelector(".besogo-tree-comment-badge");return b?b.getBoundingClientRect().top:null})()';
      const b1=await ev(badge);check(b1!==null,where+'the site draws its blue bubble in the moved tree');await shot('tree-bubble-'+label);
      await ev('document.querySelector(".besogo-tree").scrollTop=0');await pause(150);const s1=(await tree()).st,b2=await ev(badge);await ev('document.querySelector(".besogo-tree").scrollTop=40');await pause(150);const s2=(await tree()).st,b3=await ev(badge);check(Math.abs((b2-b3)-(s2-s1))<1,where+'the bubble scrolls with its node');
    }
    // Past the Zen mode budget, on a synthetic tree: the site's own page, then Zen mode again.
    await size(1440,900,false);await ev('sessionStorage.setItem("zen-test-huge","1")');await navigate('https://tsumego.com/5193');await wait('document.documentElement.dataset.zenMode==="off"&&!!window.besogo?.editor');await pause(700);
    check(await ev('__zenNodeCount()')>1662,'a tree past the budget is loaded');
    check(await ev('document.querySelector(".zen-resume").textContent')==='Retry Zen mode'&&await ev('!document.querySelector(".zen-resume").hidden'),'past the budget, the page says so and offers Retry Zen mode');
    check(await ev('document.documentElement.dataset.zen')==='off',"past the budget, the site's own page shows");
    await ev('document.querySelector("#besogo-review-button").click()');await wait('besogo.editor.getReviewMode()');await pause(900);
    const huge=await ev(`(()=>{const t=document.querySelector('.besogo-tree'),c=getComputedStyle(t);return {sh:t.scrollHeight,ch:t.clientHeight,max:c.maxHeight,pane:!!t.closest('.zen-review-tree')}})()`);
    check(!huge.pane&&huge.max==='350px'&&huge.sh>huge.ch,"past the budget, Review uses the site's own scrolling tree box "+JSON.stringify(huge));
    await ev('sessionStorage.removeItem("zen-test-huge")');await navigate('https://tsumego.com/5194');await wait(ready);await pause(500);check(await ev('document.documentElement.dataset.zenMode')==='on','the next problem returns to Zen mode');
    await size(1440,900,false);await page.send('Emulation.clearDeviceMetricsOverride').catch(()=>{});
    await page.send('Page.removeScriptToEvaluateOnNewDocument',{identifier:probe.identifier});
  }
  if(values['random-only']) {
    // The optional random rotation on real problems, anonymous. The site draws the orientation, so reload until each appears.
    const probe=await page.send('Page.addScriptToEvaluateOnNewDocument',{source:await readFile(new URL('./turn-check.js',import.meta.url),'utf8')+';observeTurn([])'});
    const size=(width,height)=>page.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:2,mobile:width<601,screenWidth:width,screenHeight:height});
    await page.send('Emulation.setUserAgentOverride',{userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',platform:'iPhone'}).catch(()=>{});
    await size(390,844);
    const ready='!!window.besogo?.editor && document.documentElement.dataset.zenReady==="on" && !document.documentElement.dataset.zenPreparing && !document.documentElement.dataset.zenHandoff';
    const settle=async()=>{await pause(350);await wait(ready);await pause(250);};
    const load=async path=>{await navigate('https://tsumego.com'+path);await settle();};
    const state=()=>ev('__zenTurnState()'),native=()=>ev('__zenNativeTurn');
    const option=value=>ev(`(()=>{const s=document.querySelector('select[aria-label="Random ±90° rotation"]');s.value='${value}';s.dispatchEvent(new Event('change'));return s.value})()`);
    const menu=()=>ev(`document.querySelector('select[aria-label="Random ±90° rotation"]').value`);
    // Turned: always the fixed clockwise direction. Auto-fit's crop of the stones may
    // fit upright at a comfortable grid, and then it needs no turn.
    const fixed=`(()=>{const c=besogo.boardParameters.corner,r=besogo.scaleParameters.rotation;if(r===-1)return parseFloat(getComputedStyle(document.querySelector('.besogo-board')).getPropertyValue('--zen-grid-step'))>=34;return r===(c==='bottom-left'?0:3)})()`;
    await load('/6699');
    check(await menu()==='off'&&await ev('document.documentElement.dataset.zenRandomTurn')==='off','Fresh install: the option is Off');
    check(await ev('!!document.querySelector(".zen-option-help")?.textContent.includes("Original")'),'The help text says the option also applies with Original');
    for(let i=0;i<6;i++){await load('/6699');check(await ev(fixed),'Off: fixed clockwise when turned, or upright at a comfortable grid, load '+(i+1));}
    await option('on');await settle();check((await ev('__zenPlacement()')).blocked.length===0,'Turning it On applies at once and nothing playable is blocked');
    await load('/6699');check(await menu()==='on'&&await ev('document.documentElement.dataset.zenRandomTurn')==='on','On survives a reload');
    const steady=async label=>{const t=await ev('__zenTurnTrace');check(t.views.length===1,'One orientation from the first visible frame: '+label+' '+JSON.stringify(t.views));};
    await steady('after turning it on');
    await option('off');await settle();check(await ev(fixed),'Turning it Off returns to the fixed turn at once');await load('/6699');check(await menu()==='off'&&await ev(fixed),'Off survives a reload');
    await option('on');await settle();
    const tap=async label=>{const m=await ev('(()=>{const n=besogo.editor.getRoot().children[0].move;return {x:n.x,y:n.y}})()'),p=await ev('__zenPointFor('+m.x+','+m.y+')');
      for(const type of ['mousePressed','mouseReleased'])await page.send('Input.dispatchMouseEvent',{type,x:p.x,y:p.y,button:'left',clickCount:1});await pause(500);
      const placed=await ev('(()=>{let n=besogo.editor.getCurrent();while(n&&n.parent&&n.parent.parent)n=n.parent;return n&&n.move?{x:n.move.x,y:n.move.y}:null})()');
      check(placed&&placed.x===m.x&&placed.y===m.y,'Real click lands on the intersection shown: '+label);await ev('document.querySelector(".zen-reset").click()');await pause(300);};
    const orient=`JSON.stringify((({transpose,flipX,flipY})=>[transpose,flipX,flipY])(besogo.editor.getTransformationFromSgf()))`;
    const clear=async(where,clicks=true)=>{const p=await ev('__zenPlacement()');
      check(p.menu.left<60&&p.menu.top<60&&(!p.hearts||p.hearts.right>p.width-60&&p.hearts.top<60),where+'menu top left and hearts top right, as on every problem '+JSON.stringify([p.menu,p.hearts]));
      check(p.under.length===0&&p.problemTop>=p.controls+7.5,where+'no stone or move tile under the menu or hearts; play starts '+(p.problemTop-p.controls).toFixed(1)+' px below them '+p.under+' '+JSON.stringify({frame:p.frame,crop:p.crop,firstRow:p.firstRow,shown:p.shownCount,controls:p.controls,step:p.step,vb:p.vb}));
      if(!clicks)return p;
      for(const t of await ev('__zenTopMoves(3)')){for(const type of ['mousePressed','mouseReleased'])await page.send('Input.dispatchMouseEvent',{type,x:t.at.x,y:t.at.y,button:'left',clickCount:1});await pause(500);
        const placed=await ev('(()=>{let n=besogo.editor.getCurrent();while(n&&n.parent&&n.parent.parent)n=n.parent;return n&&n.move?{x:n.move.x,y:n.move.y}:null})()');
        check(placed&&placed.x===t.col&&placed.y===t.row,where+'real click on topmost move point '+t.col+','+t.row+' at y '+Math.round(t.at.y)+' lands there');
        await ev('document.querySelector(".zen-reset").click()');await pause(300);}
      return p;};
    for(const [path,width,height,want,restore] of [['/6699',390,844,4,true],['/6077',390,844,8,true],['/6699',1440,900,8,true]]){
      await size(width,height);const seen=new Set(),label=path+' at '+width;
      for(let i=0;i<70&&seen.size<want;i++){await load(path);const o=await ev(orient);if(seen.has(o))continue;seen.add(o);
        const where=label+' '+o+': ',p=await ev('__zenPlacement()'),facing=(await state()).facing;await steady(where.slice(0,-2));
        check(p.blocked.length===0,where+'no stone or possible move under a control '+p.blocked);check(p.outsideStones.length===0,where+(p.frame==='play'?'touch fallback: every stone play touches is on screen ':'every setup stone is on screen ')+p.outsideStones);
        if(width>600)check(p.menu.left<120&&p.menu.top>height-120,where+'on a wide screen the menu stays at the bottom left of the bar '+JSON.stringify(p.menu));
        check(await ev('__zenStonesInSgf()===__zenNativeStones'),where+'stones map to the same stored SGF points, so comment anchors hold');
        check(await ev(`(()=>{const e=besogo.editor;return ['C3','D16','Q4','K10'].every(l=>e.viewLabelToSgf(e.sgfLabelToView(l))===l)})()`),where+'coordinate labels convert both ways');
        const text=await ev('__zenCommentText()');check(text.shown===text.expected,where+'problem comment text is what the site shows');
        await shot('random-'+path.slice(1)+'-'+width+'-'+seen.size);
        // Wrong tries add nodes to the tree, so this follows the checks that read it.
        if(width<601)await clear(where);
        await tap(where);check((await state()).facing===facing,where+'Reset keeps the orientation');
        if(!restore)continue;
        await ev(`document.querySelector('.zen-options').open=true;[...document.querySelectorAll('button')].find(b=>b.textContent==='Site page').click()`);
        await wait('document.documentElement.dataset.zen==="off"');await pause(300);
        check((await state()).native===await native()&&await ev('document.querySelector(".besogo-board > svg").getAttribute("viewBox")===__zenNativeBox'),where+'Site page restores the exact native orientation, viewBox and width');
        await ev('document.querySelector(".zen-resume").click()');await settle();check((await state()).facing===facing,where+'Zen mode returns to the same orientation');
        if(width<601){await size(height,width);await pause(450);await size(width,height);await settle();check((await state()).facing===facing,where+'phone rotation returns to the same orientation');}
      }
      check(seen.size===want,label+': all '+want+' orientations appeared across reloads: '+seen.size);}
    await size(390,844);await load('/5190');const before=await ev('location.pathname');
    await ev('document.querySelector(".zen-next").click()');await wait(`location.pathname!=="${before}"&&(${ready})`);await settle();await steady('Next');check((await ev('__zenPlacement()')).blocked.length===0,'Next with the option on: nothing playable blocked');await clear('Next with the option on: ',false);
    const h=await page.send('Page.getNavigationHistory');await page.send('Page.navigateToHistoryEntry',{entryId:h.entries[h.currentIndex-1].id});await wait(`location.pathname==="${before}"&&(${ready})`);await settle();
    check((await ev('__zenPlacement()')).blocked.length===0,'Back with the option on: nothing playable blocked');await clear('Back with the option on: ',false);
    // The play flow on a counter-clockwise turn.
    await size(320,568);let flow=false;
    for(let i=0;i<14&&!flow;i++){await load('/5193');flow=await ev('besogo.scaleParameters.rotation===1||besogo.scaleParameters.rotation===2');}
    check(flow,'A counter-clockwise turn appeared on /5193 at 320');
    await ev('window.__zenProbe={lastFrame:performance.now()};requestAnimationFrame(function tick(){__zenProbe.lastFrame=performance.now();requestAnimationFrame(tick)})');
    await ev(await readFile(new URL('./webkit-check.js',import.meta.url),'utf8'));results.push(...(await ev('checkVisibleReview({playOnly:true})')).checks.map(c=>'Random: '+c));
    await shot('random-review');await option('off');
    await page.send('Emulation.setUserAgentOverride',{userAgent:''}).catch(()=>{});
    await page.send('Page.removeScriptToEvaluateOnNewDocument',{identifier:probe.identifier});
  }
  if(values['reset-only']) {
    // Reset with no move made shows the problem differently, through the site's own controls. Anonymous.
    const probe=await page.send('Page.addScriptToEvaluateOnNewDocument',{source:await readFile(new URL('./turn-check.js',import.meta.url),'utf8')+';observeTurn([])'});
    const size=(width,height)=>page.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:2,mobile:width<601,screenWidth:width,screenHeight:height});
    await page.send('Emulation.setUserAgentOverride',{userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',platform:'iPhone'}).catch(()=>{});
    const ready='!!window.besogo?.editor && document.documentElement.dataset.zenReady==="on" && !document.documentElement.dataset.zenPreparing && !document.documentElement.dataset.zenHandoff';
    const settle=async()=>{await pause(200);await wait(ready);await pause(250);};
    const load=async path=>{await navigate('https://tsumego.com'+path);await settle();};
    const shown=()=>ev('JSON.stringify(besogo.editor.getTransformationFromSgf())'),label=()=>ev('document.querySelector(".zen-reset").getAttribute("aria-label")');
    const option=(name,value)=>ev(`(()=>{const s=document.querySelector('select[aria-label="${name}"]');s.value='${value}';s.dispatchEvent(new Event('change'));return s.value})()`);
    // Every state the board transition passes through during one press.
    const press=async()=>{const before=await shown(),title=await ev('document.querySelector(".zen-problem").textContent');
      await ev(`window.__zenStates=[];window.__zenStateWatch?.disconnect();window.__zenStateWatch=new MutationObserver(()=>__zenStates.push(document.documentElement.dataset.zenHandoff||'none'));__zenStateWatch.observe(document.documentElement,{attributes:true,attributeFilter:['data-zen-handoff']});document.querySelector(".zen-reset").click()`);
      await settle();await pause(700);const states=await ev('__zenStates.join(" ")');
      return {before,after:await shown(),states,moved:states.includes('moving'),title:title===await ev('document.querySelector(".zen-problem").textContent')};};
    const tapFirst=async where=>{const m=await ev('(()=>{const n=besogo.editor.getRoot().children[0].move;return {x:n.x,y:n.y}})()'),p=await ev('__zenPointFor('+m.x+','+m.y+')');
      for(const type of ['mousePressed','mouseReleased'])await page.send('Input.dispatchMouseEvent',{type,x:p.x,y:p.y,button:'left',clickCount:1});await pause(500);
      const placed=await ev('(()=>{let n=besogo.editor.getCurrent();while(n&&n.parent&&n.parent.parent)n=n.parent;return n&&n.move?{x:n.move.x,y:n.move.y}:null})()');
      check(placed&&placed.x===m.x&&placed.y===m.y,where+'a real click lands on the intersection shown');};
    for(const [path,width,height,random,want] of [['/6077',390,844,'off',8],['/6077',390,844,'on',16],['/6077',1440,900,'on',16],['/5193',320,568,'off',4]]){
      await size(width,height);await load(path);await option('Random ±90° rotation',random);await load(path);
      const where=path+' at '+width+', Random '+random+': ',seen=new Set([await shown()]);
      check(await label()==='Show differently','Before a move, Reset reads Show differently: '+where);
      for(let i=0;i<(width===1440?6:12);i++){const r=await press();seen.add(r.after);
        check(r.after!==r.before,where+'press '+(i+1)+' shows something else');check(r.moved,where+'press '+(i+1)+' moves through the board transition: '+r.states);
        check(r.title,where+'the bar keeps its problem title');
        if(i%4===0){check(await ev('__zenStonesInSgf()===__zenNativeStones'),where+'stones keep their stored SGF points, so comment anchors hold');
          check(await ev(`(()=>{const e=besogo.editor;return ['C3','D16','Q4','K10'].every(l=>e.viewLabelToSgf(e.sgfLabelToView(l))===l)})()`),where+'coordinate labels convert both ways');
          const text=await ev('__zenCommentText()');check(text.shown===text.expected,where+'problem text follows the colours, as the site writes it');
          if(width<601){const p=await ev('__zenPlacement()');check(p.under.length===0&&p.blocked.length===0&&p.outsideStones.length===0,where+'nothing playable under ☰ or the hearts, and the problem as set up on screen '+JSON.stringify([p.under,p.blocked,p.outsideStones,p.frame]));}
          await shot('reset-'+path.slice(1)+'-'+width+'-'+random+'-'+i);}}
      await tapFirst(where);check(await label()==='Reset problem',where+'after a move, Reset is the site\'s Reset again');
      const facing=await shown();await ev('document.querySelector(".zen-reset").click()');await settle();
      check(await shown()===facing&&await ev('besogo.editor.getCurrent()===besogo.editor.getRoot()'),where+'native Reset returns to the start in the same presentation');
      check(await label()==='Show differently',where+'back at the start, Reset shows differently again');
      // 16 equally likely presentations need about 50 presses on average to see them all.
      if(width===390&&random==='on'){let presses=12;while(seen.size<want&&presses<150){seen.add((await press()).after);presses++;}
        check(seen.size===want,where+'all '+want+' presentations appeared, after '+presses+' presses: '+seen.size);}
      else check(seen.size>=Math.min(want,4),where+'several presentations appear: '+seen.size);}
    // Steady and Reduced Motion swap at once.
    await size(390,844);await load('/6077');await option('Board transition','off');await settle();
    let r=await press();check(r.after!==r.before&&!r.moved,'Steady: it changes in one swap, without moving: '+r.states);await option('Board transition','on');
    await page.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});await load('/6077');
    r=await press();check(r.after!==r.before&&!r.moved,'Reduced Motion: it changes in one swap, without moving: '+r.states);
    await page.send('Emulation.setEmulatedMedia',{features:[]});
    // Then the whole play flow on the new presentation: failure, solve and Review.
    await load('/5193');for(let i=0;i<3;i++)await press();
    await ev('window.__zenProbe={lastFrame:performance.now()};requestAnimationFrame(function tick(){__zenProbe.lastFrame=performance.now();requestAnimationFrame(tick)})');
    await ev(await readFile(new URL('./webkit-check.js',import.meta.url),'utf8'));results.push(...(await ev('checkVisibleReview({playOnly:true})')).checks.map(c=>'After Show differently: '+c));
    await shot('reset-review');await option('Random ±90° rotation','off');
    await page.send('Emulation.setUserAgentOverride',{userAgent:''}).catch(()=>{});
    await page.send('Page.removeScriptToEvaluateOnNewDocument',{identifier:probe.identifier});
  }
  if(values['turn-only']) {
    // Phone emulation of the real site. /5193 uses a raised threshold; /5194 does not.
    const probe=await page.send('Page.addScriptToEvaluateOnNewDocument',{source:await readFile(new URL('./turn-check.js',import.meta.url),'utf8')+';observeTurn(["/5193"])'});
    const size=(width,height)=>page.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:2,mobile:true,screenWidth:width,screenHeight:height});
    await page.send('Emulation.setUserAgentOverride',{userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',platform:'iPhone'}).catch(()=>{});
    await size(390,844);
    const ready='!!window.besogo?.editor && document.documentElement.dataset.zenReady==="on" && !document.documentElement.dataset.zenPreparing && !document.documentElement.dataset.zenHandoff';
    const at=async path=>{await wait("location.pathname==='"+path+"'&&("+ready+")");await pause(350);};
    const state=()=>ev('__zenTurnState()'),saved=()=>ev('JSON.stringify([document.cookie,{...localStorage}])');
    const native=()=>ev('__zenNativeTurn');
    const steady=async label=>{const t=await ev('__zenTurnTrace');await writeFile(join(output,'turn-'+label+'.json'),JSON.stringify(t));check(t.views.length===1,'One orientation from first visible frame: '+label+' '+JSON.stringify(t.views));};
    await navigate('https://tsumego.com/5193');await at('/5193');await pause(300);
    const turned=await state();check(turned.native!==await native(),'Wide problem turned by the native rotation on a portrait screen');await steady('load');await shot('turn-390-turned');
    const tap=async label=>{const m=await ev('(()=>{const n=besogo.editor.getRoot().children[0].move;return {x:n.x,y:n.y}})()'),p=await ev('__zenPointFor('+m.x+','+m.y+')');
      for(const type of ['mousePressed','mouseReleased'])await page.send('Input.dispatchMouseEvent',{type,x:p.x,y:p.y,button:'left',clickCount:1});await pause(500);
      const placed=await ev('(()=>{let n=besogo.editor.getCurrent();while(n&&n.parent&&n.parent.parent)n=n.parent;return n&&n.move?{x:n.move.x,y:n.move.y}:null})()');
      check(placed&&placed.x===m.x&&placed.y===m.y,'Real click lands on the intersection shown: '+label);await shot('turn-after-tap-'+label);};
    const clear=async(where,clicks=true)=>{const p=await ev('__zenPlacement()');
      check(p.menu.left<60&&p.menu.top<60&&(!p.hearts||p.hearts.right>p.width-60&&p.hearts.top<60),where+'menu top left and hearts top right, as on every problem '+JSON.stringify([p.menu,p.hearts]));
      check(p.under.length===0&&p.problemTop>=p.controls+7.5,where+'no stone or move tile under the menu or hearts; play starts '+(p.problemTop-p.controls).toFixed(1)+' px below them '+p.under+' '+JSON.stringify({frame:p.frame,crop:p.crop,firstRow:p.firstRow,shown:p.shownCount,controls:p.controls,step:p.step,vb:p.vb}));
      if(!clicks)return p;
      for(const t of await ev('__zenTopMoves(3)')){for(const type of ['mousePressed','mouseReleased'])await page.send('Input.dispatchMouseEvent',{type,x:t.at.x,y:t.at.y,button:'left',clickCount:1});await pause(500);
        const placed=await ev('(()=>{let n=besogo.editor.getCurrent();while(n&&n.parent&&n.parent.parent)n=n.parent;return n&&n.move?{x:n.move.x,y:n.move.y}:null})()');
        check(placed&&placed.x===t.col&&placed.y===t.row,where+'real click on topmost move point '+t.col+','+t.row+' at y '+Math.round(t.at.y)+' lands there');
        await ev('document.querySelector(".zen-reset").click()');await pause(300);}
      return p;};
    await clear('/5193 turned at 390: ');await tap('turned');
    await ev('document.querySelector(".zen-reset").click()');await pause(300);
    check((await state()).facing===turned.facing,'Reset keeps the turned board');
    await size(390,500);await pause(350);check((await state()).facing===turned.facing,'Height change (keyboard or browser bars) does not toggle it');await size(390,844);await pause(300);
    const storage=await saved(),requests=await ev('performance.getEntriesByType("resource").filter(e=>!e.name.endsWith("/keepalive.txt")).length');
    await size(844,390);await pause(450);check((await state()).native===await native(),'Landscape restores the exact native orientation and width');
    await size(390,844);await pause(450);check((await state()).facing===turned.facing,'Portrait turns it again');
    const after=await saved(),requested=await ev('performance.getEntriesByType("resource").filter(e=>!e.name.endsWith("/keepalive.txt")).length'),lastRequests=await ev('performance.getEntriesByType("resource").filter(e=>!e.name.endsWith("/keepalive.txt")).slice(-3).map(e=>e.name.slice(-60)).join(" ")');
    check(after===storage&&requested===requests,'Turning changes no storage and makes no request '+(after===storage?'':after.slice(0,200)+' was '+storage.slice(0,200))+' '+requests+'/'+requested+' '+lastRequests);
    await tap('after-orientation-change');await ev('document.querySelector(".zen-reset").click()');await pause(300);
    await page.send('Page.reload');await pause(300);await at('/5193');check((await state()).native!==await native(),'Reload turns it again');await steady('reload');
    await ev('document.querySelector(".zen-next").click()');await at('/5194');
    // The next problem decides its own orientation under the rule, exactly as a direct load does.
    const viaNext=(await state()).native!==await native();await steady('next');await shot('turn-next');
    let h=await page.send('Page.getNavigationHistory');await page.send('Page.navigateToHistoryEntry',{entryId:h.entries[h.currentIndex-1].id});await at('/5193');
    check((await state()).native!==await native(),'Back to the turned problem: still turned');
    await navigate('https://tsumego.com/5194');await at('/5194');await pause(300);
    check(((await state()).native!==await native())===viaNext,'Next to another problem turns it or not exactly as loading it directly does: '+viaNext);
    h=await page.send('Page.getNavigationHistory');await page.send('Page.navigateToHistoryEntry',{entryId:h.entries[h.currentIndex-1].id});await at('/5193');
    await ev(`document.querySelector('.zen-options').open=true;[...document.querySelectorAll('button')].find(b=>b.textContent==='Site page').click()`);
    await wait('document.documentElement.dataset.zen==="off"');await pause(300);
    check((await state()).native===await native(),'Site page restores the exact native orientation, rotation state and width');
    check(await ev('document.querySelector(".besogo-board > svg").getAttribute("viewBox")===__zenNativeBox'),'Site page restores the exact native viewBox');
    check(await ev('typeof besogoRotation==="undefined"||besogoRotation===besogo.scaleParameters.rotation'),'Native hover coordinates keep their rotation state');
    await ev('document.querySelector(".zen-resume").click()');await wait(ready);await pause(350);
    check((await state()).native!==await native(),'Zen mode turns it again');
    await size(1440,1000);await pause(400);check((await state()).native===await native(),'Desktop width: native orientation');
    await size(390,844);await pause(450);
    // A deliberate transition from a turned board to one that stays native.
    const events=[];let complete;page.on['Tracing.dataCollected']=({value})=>events.push(...value.filter(e=>e.name==='Screenshot'||e.name==='zen-moving'));page.on['Tracing.tracingComplete']=()=>complete();
    await page.send('Tracing.start',{transferMode:'ReportEvents',traceConfig:{includedCategories:['disabled-by-default-devtools.screenshot','blink.user_timing']}});await pause(250);
    await ev('document.querySelector(".zen-next").click()');await pause(300);await at('/5194');await pause(500);
    const traced=new Promise(r=>{complete=r});await page.send('Tracing.end');await traced;
    const mark=events.filter(e=>e.name==='zen-moving').map(e=>e.ts).at(-1),frames=events.filter(e=>e.name==='Screenshot'&&mark&&e.ts>=mark-40000&&e.ts<mark+760000).sort((a,b)=>a.ts-b.ts);
    const moving=new Set(frames.filter(e=>e.ts>=mark&&e.ts<mark+360000).map(e=>e.args.snapshot)).size;
    check(moving>=8,'Next from turned to native presents a real transition: '+moving+' frames');await mkdir(join(output,'turn-next'),{recursive:true});
    for(const [i,f] of frames.entries())await writeFile(join(output,'turn-next',String(i).padStart(3,'0')+'_'+Math.round((f.ts-mark)/1000)+'.jpg'),Buffer.from(f.args.snapshot,'base64'));
    h=await page.send('Page.getNavigationHistory');await page.send('Page.navigateToHistoryEntry',{entryId:h.entries[h.currentIndex-1].id});await at('/5193');
    await page.send('Page.reload');await pause(300);await at('/5193');check((await state()).native!==await native(),'Turned board before the full play flow');
    await ev('window.__zenProbe={lastFrame:performance.now()};requestAnimationFrame(function tick(){__zenProbe.lastFrame=performance.now();requestAnimationFrame(tick)})');
    await ev(await readFile(new URL('./webkit-check.js',import.meta.url),'utf8'));results.push(...(await ev('checkVisibleReview({playOnly:true})')).checks.map(c=>'Turned: '+c));
    // Real wide problems at the default threshold. The site draws the placement, so reload until both appear.
    for(const [path,width,height] of [['/6699',390,844],['/6699',320,568],['/5190',320,568]]){
      await size(width,height);const seen=new Set(),label=path+' at '+width;
      for(let i=0;i<16&&seen.size<2;i++){await navigate('https://tsumego.com'+path);await at(path);
        const p=await ev('__zenPlacement()'),left=p.corner==='bottom-left';if(seen.has(p.corner))continue;seen.add(p.corner);
        const where=label+' '+(left?'left':'right')+': ',facing=(await state()).facing;
        // Auto-fit crops to the stones as set up, so a problem that fits upright at a
        // comfortable grid is not turned; a turned one keeps one fixed direction.
        if(p.rotation===-1)check(p.step>=34,where+'fits upright at a comfortable grid, so it is not turned: '+p.step.toFixed(1)+' px');
        else{check(p.rotation===(left?0:3)&&p.side===(left?'left':'right'),where+'one fixed direction keeps the site\'s placement '+JSON.stringify([p.corner,p.rotation,p.side]));
        if(p.frame==='play')check(p.step>=34,where+'touch fallback: cropped to where play happens, at a comfortable grid '+p.step.toFixed(1)+' px');
        else check(p.edges[0]==='1'&&p.edges[left?3:1]==='1'&&p.edges[left?1:3]==='0',where+'true edges are the top and the '+(left?'left':'right')+' only '+p.edges+' '+JSON.stringify({frame:p.frame,step:p.step,stones:await ev(`(()=>{const r=besogo.editor.getRoot(),z=r.getSize(),a=[];for(let x=1;x<=z.x;x++)for(let y=1;y<=z.y;y++)if(r.getStone(x,y))a.push([x,y]);const xs=a.map(q=>q[0]),ys=a.map(q=>q[1]);return [Math.min(...xs),Math.max(...xs),Math.min(...ys),Math.max(...ys)]})()`),vb:await ev(`document.querySelector('.besogo-board svg').getAttribute('viewBox')`)}));}
        check(p.blocked.length===0,where+'no stone or possible move under a control '+p.blocked);check(p.outsideStones.length===0,where+(p.frame==='play'?'touch fallback: every stone play touches is on screen ':'every setup stone is on screen ')+p.outsideStones);
        await clear(where);
        await shot('turn-side-'+path.slice(1)+'-'+width+'-'+(left?'left':'right'));
        if(left){await tap('left-'+path.slice(1)+'-'+width);await ev('document.querySelector(".zen-reset").click()');await pause(300);
          check((await state()).facing===facing,where+'Reset keeps the turned board');
          await size(height,width);await pause(450);check((await state()).native===await native(),where+'landscape restores the exact native orientation');
          await size(width,height);await pause(450);check((await state()).facing===facing,where+'portrait turns it back');await clear(where+'back in portrait: ',false);
          await ev(`document.querySelector('.zen-options').open=true;[...document.querySelectorAll('button')].find(b=>b.textContent==='Site page').click()`);
          await wait('document.documentElement.dataset.zen==="off"');await pause(300);
          check((await state()).native===await native()&&await ev('document.querySelector(".besogo-board > svg").getAttribute("viewBox")===__zenNativeBox'),where+'Site page restores the exact native orientation, viewBox and width');
          await ev('document.querySelector(".zen-resume").click()');await wait(ready);await pause(350);check((await state()).facing===facing,where+'Zen mode turns it the same way');await clear(where+'after Zen mode: ',false);}}
      check(seen.size===2,label+': both placements appeared across reloads '+[...seen]);}
    await page.send('Emulation.setUserAgentOverride',{userAgent:''}).catch(()=>{});
    await page.send('Page.removeScriptToEvaluateOnNewDocument',{identifier:probe.identifier});
  }

  if(values['review-state-only']) {
    // Review mirrors the native button. /5194 is built enabled by the real engine.
    const probe=await page.send('Page.addScriptToEvaluateOnNewDocument',{source:await readFile(new URL('./review-state-check.js',import.meta.url),'utf8')+';observeReviewState(["/5194"])'});
    const ready='!!window.besogo?.editor && document.documentElement.dataset.zenReady==="on" && !document.documentElement.dataset.zenPreparing && !document.documentElement.dataset.zenHandoff';
    const state=()=>ev('__zenReviewState()'),review=()=>ev('document.querySelector(".zen-review").click()');
    const reviewOpen='besogo.editor.getReviewMode()===true && !document.querySelector(".zen-review").hasAttribute("aria-busy")';
    const at=async path=>{await wait("location.pathname==='"+path+"'&&("+ready+")");await pause(250);};
    const mirrored=async label=>{const t=await ev('__zenReviewTrace');await writeFile(join(output,'review-state-'+label+'.json'),JSON.stringify(t,null,2));check(t.frames>0&&!t.mismatches.length,'Review followed the native button in every frame: '+label+' ('+t.frames+' frames)');};
    await navigate('https://tsumego.com/5193');await at('/5193');
    const off=await state();check(!off.active&&!off.visible&&off.nativeId==='besogo-review-button-inactive','Native disabled at load: Review hidden');
    await mirrored('disabled-load');await shot('review-disabled');
    await ev('document.getElementById("besogo-review-button-inactive").id="besogo-review-button";besogo.editor.setReviewEnabled(true)');await pause(120);
    const mid=await state();check(mid.active&&mid.visible,'Native mid-session enable: Review follows with no engine event');
    check(mid.contextRight===off.contextRight,'Bottom bar keeps its layout when Review appears');await mirrored('mid-session');await shot('review-mid-session');
    await review();await wait(reviewOpen);check((await state()).visible,'Review opens through the native handler');
    await ev('document.querySelector("[id^=besogo-review-button]").id="besogo-review-button-inactive"');await pause(120);
    check((await state()).visible,'Exit stays available while inside Review');
    await ev('document.querySelector("[id^=besogo-review-button]").id="besogo-review-button"');await review();await wait('besogo.editor.getReviewMode()===false');
    await ev('document.querySelector(".zen-next").click()');await at('/5194');
    const on=await state();check(on.active&&on.visible&&on.nativeId==='besogo-review-button','Native enabled at load: Review visible before any move');
    check(on.contextRight===off.contextRight,'Bottom bar has the same layout in both native states');await mirrored('enabled-load');await shot('review-enabled-load');
    await review();await wait(reviewOpen);check(await ev('!!document.querySelector(".zen-review-tree:not([hidden])")'),'Review opens at load through the native path');await review();await wait('besogo.editor.getReviewMode()===false');
    await ev('document.querySelector(".zen-next").click()');await at('/5195');
    const next=await state();check(!next.active&&!next.visible,'Next to a native disabled problem: no stale Review');await mirrored('next-to-disabled');
    let h=await page.send('Page.getNavigationHistory');await page.send('Page.navigateToHistoryEntry',{entryId:h.entries[h.currentIndex-1].id});await at('/5194');
    const back=await state();check(back.active&&back.visible,'Back to a native enabled problem: Review visible');await mirrored('back-to-enabled');
    h=await page.send('Page.getNavigationHistory');await page.send('Page.navigateToHistoryEntry',{entryId:h.entries[h.currentIndex-1].id});await at('/5193');
    const earlier=await state();check(earlier.visible===earlier.active,'Back again: Review matches that page\'s own native state');await mirrored('back-again');
    await ev(`[...document.querySelectorAll('.zen-toolbar button')].find(b=>b.textContent==='Site page').click()`);
    const regular='(()=>{const n=document.querySelector("[id^=besogo-review-button]");return {native:n.getClientRects().length,ours:document.querySelector(".zen-review").getClientRects().length,id:n.id}})()';
    let shown;for(let n=0;n<40;n++){shown=await ev(regular);if(shown.native&&!shown.ours)break;await pause(100);}
    check(shown.native&&!shown.ours,'Regular mode renders only the native button '+JSON.stringify(shown));
    await page.send('Page.removeScriptToEvaluateOnNewDocument',{identifier:probe.identifier});
  }

  if(values['presented-only']) {
    // DOM frames cannot prove motion reached the screen: count distinct
    // compositor screenshots, keyed to a mark at the first moving frame.
    const probe=await page.send('Page.addScriptToEvaluateOnNewDocument',{source:await readFile(new URL('./reload-shadow-check.js',import.meta.url),'utf8')+';observeReloadShadows()'});
    const ready='!!window.besogo?.editor && document.documentElement.dataset.zenReady==="on" && !document.documentElement.dataset.zenPreparing && !document.documentElement.dataset.zenHandoff';
    const next='document.querySelector(".zen-next").click()',button=name=>"[...document.querySelectorAll('.zen-toolbar button')].find(b=>b.textContent==='"+name+"').click()";
    const motion=value=>"(()=>{const s=document.querySelector('select[aria-label=\"Board transition\"]');s.value='"+value+"';s.dispatchEvent(new Event('change'))})()";
    await navigate('https://tsumego.com/5193');await wait(ready);await pause(1500);const summary=[];
    for(const [name,action,prepare,animated] of [['next',next,'',true],['next-scale',next,button('+'),true],['next-full',next,button('Full board'),true],['back','back',button('Auto-fit'),true],['reload','reload','',true],['steady',next,motion('off'),false],['reduced',next,motion('on'),false]]) {
      await page.send('Emulation.setEmulatedMedia',{features:name==='reduced'?[{name:'prefers-reduced-motion',value:'reduce'}]:[]});
      if(prepare)await ev(prepare);await pause(900);await ev('__zenSaveReloadExpected()');
      const events=[];let complete;page.on['Tracing.dataCollected']=({value})=>events.push(...value.filter(e=>e.name==='Screenshot'||e.name==='zen-moving'));page.on['Tracing.tracingComplete']=()=>complete();
      await page.send('Tracing.start',{transferMode:'ReportEvents',traceConfig:{includedCategories:['disabled-by-default-devtools.screenshot','blink.user_timing']}});await pause(250);
      const before=await ev('location.href+performance.now()'),frames=await ev('__zenReloadTrace.frames.length');
      if(action==='back'){const h=await page.send('Page.getNavigationHistory');await page.send('Page.navigateToHistoryEntry',{entryId:h.entries[h.currentIndex-1].id});}
      else if(action==='reload')await page.send('Page.reload');else await ev(action);
      await pause(300);await wait(ready);await pause(800);
      const done=new Promise(r=>{complete=r});await page.send('Tracing.end');await done;
      const trace=await ev('__zenReloadTrace'),own=action==='back'&&trace.frames.length>frames?trace.frames.slice(frames):trace.frames;
      const mark=events.filter(e=>e.name==='zen-moving').map(e=>e.ts).at(-1),shots=events.filter(e=>e.name==='Screenshot').sort((a,b)=>a.ts-b.ts);
      const windowed=(from,to)=>new Set(shots.filter(e=>e.ts>=mark+from*1000&&e.ts<mark+to*1000).map(e=>e.args.snapshot)).size;
      const sweep=mark?windowed(0,160):0,pan=mark?windowed(160,360):0,build=mark?windowed(360,700):0;
      summary.push({name,sweep,pan,build,errors:[...new Set(trace.errors)],moving:own.filter(f=>f.phase==='moving').length});await writeFile(join(output,'presented.json'),JSON.stringify(summary,null,2));
      const directory=join(output,'presented-'+name);await mkdir(directory,{recursive:true});
      if(mark)for(const [index,shot] of shots.filter(e=>e.ts>mark-40000&&e.ts<mark+760000).entries())await writeFile(join(directory,String(index).padStart(3,'0')+'_'+Math.round((shot.ts-mark)/1000)+'.jpg'),Buffer.from(shot.args.snapshot,'base64'));
      check(!trace.errors.length,'Native shadows match the cover and stay paired with stones: '+name);
      if(animated)check(sweep>=4&&pan>=4&&build>=4,'Sweep, pan and build reach the screen as distinct presented frames: '+name+' '+[sweep,pan,build].join('/'));
      else check(!mark,'No camera motion in fallback: '+name);
      if(before===await ev('location.href+performance.now()'))throw Error('Navigation did not happen: '+name);
    }
    await page.send('Emulation.setEmulatedMedia',{features:[]});
    await page.send('Page.removeScriptToEvaluateOnNewDocument',{identifier:probe.identifier});
  }

  if(values['tatami-only']) {
    // Real screenshots for tools/check_tatami_scale.py. Full board exposes mat
    // at each scale, whichever corner this page's random orientation chose.
    await navigate('https://tsumego.com/5193');
    await wait('!!window.besogo?.editor && document.documentElement.dataset.zenReady==="on" && !document.documentElement.dataset.zenPreparing');
    await ev(await readFile(new URL('./presentation-check.js',import.meta.url),'utf8'));
    await ev("(()=>{const s=document.querySelector('select[aria-label=\"Outside board\"]');s.value='natural';s.dispatchEvent(new Event('change'));[...document.querySelectorAll('.zen-toolbar button')].find(b=>b.textContent==='Full board').click()})()");
    const surfaces=[];
    for(const [width,height,scale] of [[1100,620,1],[1440,1000,1],[1440,1000,2],[2400,1820,1],[3440,1440,1]]) {
      await page.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:scale,mobile:false});await pause(500);
      const name=`tatami-${width}x${height}@${scale}`,rect=await ev('checkFiniteBoardEdges().surface'),bar=await ev("document.querySelector('.zen-toolbar').getBoundingClientRect().top");
      await shot(name);surfaces.push({name,rect,scale,bar,step:parseFloat(await ev("getComputedStyle(document.querySelector('.besogo-board')).getPropertyValue('--zen-grid-step')"))});
    }
    // The Auto-fit cap itself, in a window wide enough to expose mat beside it.
    await ev("[...document.querySelectorAll('.zen-toolbar button')].find(b=>b.textContent==='Auto-fit').click()");
    await page.send('Emulation.setDeviceMetricsOverride',{width:2800,height:1000,deviceScaleFactor:1,mobile:false});await pause(500);
    const cap={name:'tatami-autofit-2800x1000@1',rect:await ev('checkFiniteBoardEdges().surface'),scale:1,bar:await ev("document.querySelector('.zen-toolbar').getBoundingClientRect().top"),step:parseFloat(await ev("getComputedStyle(document.querySelector('.besogo-board')).getPropertyValue('--zen-grid-step')"))};
    await shot(cap.name);surfaces.push(cap);check(cap.step<=80.01,'Auto-fit stays at its 80 CSS-pixel cap');
    await writeFile(join(output,'surfaces.json'),JSON.stringify(surfaces,null,2));
    check(surfaces.length===6,'Tatami screenshots captured at each board scale');
  }

  if(values['reload-only']) {
    const probe=await page.send('Page.addScriptToEvaluateOnNewDocument',{source:await readFile(new URL('./reload-shadow-check.js',import.meta.url),'utf8')+';observeReloadShadows()'});
    const ready='!!window.besogo?.editor && document.documentElement.dataset.zenReady==="on" && !document.documentElement.dataset.zenPreparing && !document.documentElement.dataset.zenHandoff';
    await navigate('https://tsumego.com/5193');await wait(ready);const traces=[];
    for(const [name,coordinates,motion,reduced] of [['pan',true,'on',false],['steady-off',false,'off',false],['reduced',true,'on',true],['no-shadow-fixture',true,'on',false]]) {
      await ev("((enabled,motion)=>{const b=[...document.querySelectorAll('.zen-toolbar button')].find(b=>b.textContent==='Coordinates');if((b.getAttribute('aria-pressed')==='true')!==enabled)b.click();const s=[...document.querySelectorAll('select')].find(s=>s.getAttribute('aria-label')==='Board transition');s.value=motion;s.dispatchEvent(new Event('change'))})("+JSON.stringify(coordinates)+","+JSON.stringify(motion)+")");
      await page.send('Emulation.setEmulatedMedia',{features:reduced?[{name:'prefers-reduced-motion',value:'reduce'}]:[]});
      if(name==='no-shadow-fixture')await ev("(()=>{const e=besogo.editor,style=e.getCoordStyle();e.SHADOWS=false;e.setCoordStyle(style==='none'?'western':'none');e.setCoordStyle(style)})()");
      await page.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:1400,y:970});await pause(600);
      check(await ev('document.visibilityState==="visible" && document.hasFocus()'),'Visible foreground Chrome before reload: '+name);
      const expected=await ev('__zenSaveReloadExpected()'),origin=await ev('performance.timeOrigin');
      await shot('reload-before-'+name);await page.send('Page.reload');
      await wait('performance.timeOrigin!=='+origin+'&&!!document.querySelector(".zen-mode-handoff")');
      await shot('reload-cover-'+name);await wait(ready);await pause(60);
      const trace=await ev('__zenReloadTrace');traces.push({name,...trace});await writeFile(join(output,'reload.json'),JSON.stringify(traces,null,2));
      if(name==='no-shadow-fixture')check(expected.shadows.length===0,'No-shadow native presentation fixture exercised');
      check(!trace.errors.length,'Native shadow/coordinate appearance and stone pairing preserved: '+name);
      check(trace.frames.some(f=>f.phase==='waiting'),'Actual reload covered by measured presentation: '+name);
      check(trace.frames.every(f=>coordinates||f.labels===0),'Coordinates Off remains absent: '+name);
      check(trace.frames.some(f=>f.phase==='moving')===(motion==='on'&&!reduced),'Requested motion/fallback respected: '+name);
      await shot('reload-after-'+name);
    }
    check(traces.some(t=>t.expected.shadows.length>0),'Real native shadow presentation exercised');
    // An unrecognized native shadow filter must not produce an incomplete cover.
    await ev("document.querySelector('.besogo-board #blur').setAttribute('filterUnits','userSpaceOnUse');__zenSaveReloadExpected()");
    const before=await ev('performance.timeOrigin');await page.send('Page.reload');
    await wait('performance.timeOrigin!=='+before+'&&('+ready+')');await pause(80);
    check(await ev('!__zenReloadTrace.frames.length && !document.querySelector(".zen-mode-handoff") && !!besogo.editor.getCurrent()'),'Unknown shadow contract uses bounded native fallback without a stale cover');
    await page.send('Page.removeScriptToEvaluateOnNewDocument',{identifier:probe.identifier});
  }

  if(values['coordinates-only']) {
    const probe=await page.send('Page.addScriptToEvaluateOnNewDocument',{source:await readFile(new URL('./coordinate-transition-check.js',import.meta.url),'utf8')+';observeCoordinateTransition()'});
    const ready='!!window.besogo?.editor && document.documentElement.dataset.zenReady==="on" && !document.documentElement.dataset.zenPreparing && !document.documentElement.dataset.zenHandoff';
    await navigate('https://tsumego.com/5193');await wait(ready);const traces=[];
    for(const [index,kind] of ['on','rotated-scale','native-style','off'].entries()) {
      await ev("((enabled)=>{const b=[...document.querySelectorAll('.zen-toolbar button')].find(b=>b.textContent==='Coordinates');if((b.getAttribute('aria-pressed')==='true')!==enabled)b.click()})("+JSON.stringify(kind!=='off')+")");await pause(100);
      if(kind==='rotated-scale')await ev("(()=>{const t=besogo.makeTransformation();t.rotateClockwise=true;t.invertColors=true;besogo.editor.applyTransformation(t);[...document.querySelectorAll('.zen-toolbar button')].find(b=>b.textContent==='+').click()})()");
      if(kind==='native-style') {
        await ev("[...document.querySelectorAll('.zen-toolbar button')].find(b=>b.textContent==='Site page').click()");await wait("document.querySelector('.zen-toolbar').hidden && !document.querySelector('.besogo-board').hasAttribute('data-zen-fit')");
        await ev("besogo.editor.setCoordStyle('eastern')");await pause(100);
        await ev("document.querySelector('.zen-resume').click()");await wait(ready);
        check(await ev("besogo.editor.getCoordStyle()==='eastern'"),'Native Eastern coordinate style is active before departure');
      }
      await pause(150);await shot('coordinates-before-'+kind);
      const oldLabels=await ev('__zenNativeLabels()');
      await ev('document.querySelector(".zen-next").click()');await wait("location.pathname==='/"+(5194+index)+"'&&document.documentElement.dataset.zenHandoff==='moving'");
      await shot('coordinates-moving-'+kind);await wait(ready);await pause(80);
      const trace=await ev('__zenCoordinateTrace');traces.push({kind,...trace});await writeFile(join(output,'coordinates.json'),JSON.stringify(traces,null,2));await shot('coordinates-after-'+kind);
      check(!trace.errors.length,'Every measured coordinate matches native text/style and interpolated grid: '+kind);
      check(trace.frames.some(f=>f.phase==='moving')&&trace.frames.some(f=>f.phase==='building'),'Measured actual moving and building frames: '+kind);
      check(trace.frames.every(f=>f.mat!==null&&f.edge!==null),'Natural tatami measured on the handoff layer and top region in every frame: '+kind);
      check(JSON.stringify(trace.previous.coordinates)===JSON.stringify(oldLabels),'Record contains exactly native gutter labels: '+kind);
      check(trace.frames.every(f=>kind==='off'?f.labels===0:f.labels>=oldLabels.length),'Coordinates remain separate from stone sweep/build, or absent when Off: '+kind);
      if(kind==='native-style')check(trace.frames.some(f=>f.labels>oldLabels.length),'Differing native coordinate styles crossfade on the registered grid');
      if(kind==='rotated-scale')check(Math.abs(trace.frames.at(-1).step-trace.previous.grid[2])>1,'Coordinates remain registered through a genuine scale change');
    }
    const h=await page.send('Page.getNavigationHistory');await page.send('Page.navigateToHistoryEntry',{entryId:h.entries[h.currentIndex-1].id});
    await wait("location.pathname==='/5196'&&("+ready+")");
    check(await ev('!document.querySelector(".zen-mode-handoff") && !!besogo.editor.getCurrent()'),'Native Back restores usable board without stale labels/cover');
    await writeFile(join(output,'coordinates.json'),JSON.stringify(traces,null,2));
    await page.send('Page.removeScriptToEvaluateOnNewDocument',{identifier:probe.identifier});
  }

  if(values['defaults-only']) {
    const script=await readFile(new URL('./preferences-check.js',import.meta.url),'utf8');
    const probe=await page.send('Page.addScriptToEvaluateOnNewDocument',{source:script+';observePreferencePaint()'});
    const ready='!!window.besogo?.editor && document.documentElement.dataset.zenReady==="on" && !document.documentElement.dataset.zenPreparing && !document.documentElement.dataset.zenHandoff && __zenPreferenceTrace.paint.length';
    await navigate('https://tsumego.com/5193');await wait(ready);
    check(!!await ev('checkPreferencePaint()'),'Fresh installed defaults match first painted board and controls');await shot('defaults-fresh');
    await ev('window.__feedback=checkFeedbackPresentation()');let done=false;
    for(let i=0;i<80;i++) {
      const step=await ev('__feedback.next()');if(step.done){results.push(...step.value.checks);done=true;break;}
      const a=step.value;
      if(a.resize){const [width,height]=a.resize;await page.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});}
      else if(a.screenshot)await shot(a.screenshot);
      else for(const type of ['mousePressed','mouseReleased'])await page.send('Input.dispatchMouseEvent',{type,x:a.click[0],y:a.click[1],button:'left',clickCount:1});
    }
    check(done,'Native outcome and all feedback channel checks complete');
    await ev('document.querySelector(".zen-next").click()');await wait('location.pathname==="/5194"&&('+ready+')');
    const trace=await ev('checkPreferencePaint()');
    check(trace.phases.includes('moving')&&trace.phases.includes('building'),'Default native Next actually pans and builds, then reveals matching defaults');await shot('defaults-next');
    await writeFile(join(output,'default-next-trace.json'),JSON.stringify(trace,null,2));
    await page.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
    await ev('document.querySelector(".zen-next").click()');await wait('location.pathname==="/5195"&&('+ready+')');
    const reduced=await ev('checkPreferencePaint()');check(!reduced.phases.includes('moving')&&!reduced.phases.includes('building'),'Reduce Motion retains requested Pan preference but skips camera/build animation');
    await page.send('Emulation.setEmulatedMedia',{features:[]});
    await ev(`(()=>{for(const [label,value] of [['Board appearance','plain'],['Board edge margin','off'],['Board transition','off']]){const s=document.querySelector('select[aria-label="'+label+'"]');s.value=value;s.dispatchEvent(new Event('change'))}})()`);
    await pause(150);await page.send('Page.reload');await wait(ready);
    check(!!await ev("checkPreferencePaint(['plain','off','off','auto'])"),'Explicit Plain/None/Steady persist through reload and first visible paint');
    await page.send('Page.removeScriptToEvaluateOnNewDocument',{identifier:probe.identifier});
    const unsupported=await page.send('Page.addScriptToEvaluateOnNewDocument',{source:script+`;Object.defineProperty(window,'PageSwapEvent',{value:undefined});Object.defineProperty(window,'PageRevealEvent',{value:undefined});const listen=window.addEventListener;window.addEventListener=function(type,...args){if(!['pageswap','pagereveal'].includes(type))return listen.call(this,type,...args)};observePreferencePaint()`});
    await navigate(new URL('harness/real.html?p=0&orientation=0',preview).href);await wait(ready);
    check(!!await ev('checkPreferencePaint()'),'Fresh authored demo matches extension defaults');
    check(await ev(`document.querySelector('select[aria-label="Board transition"]').disabled && document.querySelector('select[aria-label="Board transition"]').selectedOptions[0].textContent.includes("unavailable")`),'Unsupported capability fixture clearly marks requested animation unavailable');
    await ev('document.querySelector(".zen-next").click()');await wait('location.search.includes("p=1")&&('+ready+')');
    check(!!await ev('checkPreferencePaint()')&&!await ev('__zenPreferenceTrace.phases.length'),'Unsupported event/capability fixture navigates normally without a stale cover');
    await page.send('Page.removeScriptToEvaluateOnNewDocument',{identifier:unsupported.identifier});
  }

  if(values['layout-only']) {
    await navigate('https://tsumego.com/5193');
    await wait('!!window.besogo?.editor && document.documentElement.dataset.zen==="on" && document.documentElement.dataset.zenReady==="on" && !document.documentElement.dataset.zenPreparing');
    await ev(await readFile(new URL('./presentation-check.js',import.meta.url),'utf8'));
    await ev(await readFile(new URL('./zen-render-check.js',import.meta.url),'utf8'));
    await ev('window.__render=checkZenRendering()');let done=false;const surfaces=[];
    for(let i=0;i<100;i++) {
      const step=await ev('__render.next()');if(step.done){results.push(...step.value.checks);done=true;break;}
      const a=step.value;
      if(a.resize){const [width,height]=a.resize;await page.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});}
      else if(a.screenshot){await shot(a.screenshot);if(a.surface)surfaces.push({name:a.screenshot,rect:a.surface});}
      else for(const type of ['mousePressed','mouseReleased'])await page.send('Input.dispatchMouseEvent',{type,x:a.x,y:a.y,button:'left',clickCount:1});
    }
    check(done,'Complete native Zen mode render/contrast flow');await writeFile(join(output,'surfaces.json'),JSON.stringify(surfaces,null,2));
    await ev('window.__zenProbe={lastFrame:performance.now()};requestAnimationFrame(function tick(){__zenProbe.lastFrame=performance.now();requestAnimationFrame(tick)})');
    await ev(await readFile(new URL('./webkit-check.js',import.meta.url),'utf8'));results.push(...(await ev('checkVisibleReview()')).checks);
    await page.send('Emulation.setDeviceMetricsOverride',{width:1440,height:550,deviceScaleFactor:1,mobile:false});
    await ev('preparePresentationCheck()');results.push(...(await ev("checkPresentationCase('site',true,false,'on')")).checks);await shot('wide-review');
    await ev("[...document.querySelectorAll('.zen-toolbar button')].find(b=>b.textContent==='+').click()");await pause(100);
    check(await ev('document.querySelector(".besogo-board").clientWidth===innerWidth'),'Manual zoom keeps full viewport canvas');
    await ev('document.querySelector(".besogo-board").scrollBy(100,50)');await pause(100);await shot('wide-manual-pan');
    await ev("[...document.querySelectorAll('.zen-toolbar button')].find(b=>b.textContent==='Auto-fit').click()");await pause(100);
    await ev("(()=>{const s=document.querySelector('select[aria-label=\"Board transition\"]');s.value='on';s.dispatchEvent(new Event('change'))})()");
    await ev('document.querySelector(".zen-next").click()');await wait('location.pathname==="/5194"&&document.documentElement.dataset.zenReady==="on"&&!document.documentElement.dataset.zenPreparing&&!document.documentElement.dataset.zenHandoff');await pause(800);
    check(await ev('document.querySelector(".besogo-board").clientWidth===innerWidth'),'Animated native Next settles on a full viewport board/mat');await shot('wide-after-next');
    const history=await page.send('Page.getNavigationHistory');await page.send('Page.navigateToHistoryEntry',{entryId:history.entries[history.currentIndex-1].id});await wait('location.pathname==="/5193"&&document.documentElement.dataset.zenReady==="on"');check(true,'Native history preserved after layout checks');
  }

  if(values['notices-only']) {
    await navigate('https://tsumego.com/5193');
    await wait('!!window.besogo?.editor?.getRoot()?.children?.length && document.documentElement.dataset.zen==="on" && !document.documentElement.dataset.zenPreparing');
    await ev('window.__zenProbe={lastFrame:performance.now()};requestAnimationFrame(function tick(){__zenProbe.lastFrame=performance.now();requestAnimationFrame(tick)})');
    await ev(await readFile(new URL('./webkit-check.js',import.meta.url),'utf8'));
    results.push(...(await ev('checkVisibleReview()')).checks);
    await ev(await readFile(new URL('./achievement-check.js',import.meta.url),'utf8'));
    await ev('window.__notices=checkAchievementNotices()');
    let completed=false;
    for(let i=0;i<100;i++) {
      const step=await ev('__notices.next()');
      if(step.done){results.push(...step.value.checks);completed=true;break;}
      const action=step.value;
      if(action.resize){const [width,height]=action.resize;await page.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});}
      else if(action.screenshot)await shot(action.screenshot);
      else if(action.key){const key=action.key,code={Enter:13,' ':32,Escape:27,ArrowDown:40}[key];for(const type of ['keyDown','keyUp'])await page.send('Input.dispatchKeyEvent',{type,key,code:{Enter:'Enter',' ':'Space',Escape:'Escape',ArrowDown:'ArrowDown'}[key],windowsVirtualKeyCode:code,...(type==='keyDown'&&['Enter',' '].includes(key)?{text:key==='Enter'?'\r':' '}: {})});}
      else if(action.input==='touch'){
        await page.send('Emulation.setTouchEmulationEnabled',{enabled:true});
        await page.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:action.x,y:action.y}]});await pause(30);
        await page.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
        await page.send('Emulation.setTouchEmulationEnabled',{enabled:false});
      } else if(action.input==='drag') {
        await page.send('Emulation.setTouchEmulationEnabled',{enabled:true});
        await page.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[action.from]});
        for(let n=1;n<=8;n++){await page.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:action.from.x+(action.to.x-action.from.x)*n/8,y:action.from.y+(action.to.y-action.from.y)*n/8}]});await pause(30);}
        await page.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.send('Emulation.setTouchEmulationEnabled',{enabled:false});
      } else for(const type of ['mousePressed','mouseReleased'])await page.send('Input.dispatchMouseEvent',{type,x:action.x,y:action.y,button:'left',clickCount:1});
    }
    check(completed,'Complete native presentation-only popup flow');
    await ev('document.querySelector(".zen-next").click()');await wait('location.pathname==="/5194"&&document.documentElement.dataset.zen==="on"');check(true,'Next still works after popup lifecycle and restoration');
    const h=await page.send('Page.getNavigationHistory');await page.send('Page.navigateToHistoryEntry',{entryId:h.entries[h.currentIndex-1].id});await wait('location.pathname==="/5193"&&document.documentElement.dataset.zen==="on"');check(true,'Normal browser history after popup checks');
  }

  if(values['compat-only']) {
    await navigate('https://tsumego.com/5193');
    await wait('!!window.besogo?.editor && document.documentElement.dataset.zen==="on" && document.querySelector(".zen-next")?.getBoundingClientRect().width>0 && !document.documentElement.dataset.zenPreparing');
    check(await ev('(window.besogoNoLogin===true||window.besogoUserId===0)'), 'Native compatibility checks are anonymous');
    check(await ev('document.querySelectorAll(".besogo-board svg rect[fill=transparent]").length===361'), 'Settled native SVG exposes all 361 transparent-fill hit targets');
    await ev(await readFile(new URL('./presentation-check.js',import.meta.url),'utf8'));
    await ev('preparePresentationCheck()');
    await ev(`(()=>{const e=besogo.editor,click=e.click;window.__nativeHits=[];e.click=function(x,y,...args){__nativeHits.push([x,y]);return click.call(this,x,y,...args)}})()`);
    for(const [width,height,coordinates,rotate] of [[440,956,false,false],[820,1000,true,false],[1180,650,false,true],[440,956,true,false]]) {
      await page.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
      if(rotate)await ev(`(()=>{const t=besogo.makeTransformation();t.rotateClockwise=true;besogo.editor.applyTransformation(t)})()`);
      results.push(...(await ev(`checkPresentationCase('plain',${coordinates},${width<600})`)).checks);
      const move=await ev('besogo.editor.getRoot().children.find(n=>n.canStillEndCorrect()).move');
      const point=await ev(`(()=>{const svg=document.querySelector('.besogo-board svg'),grid=svg.querySelector('rect.besogo-svg-lines'),step=+grid.getAttribute('width')/18,p=new DOMPoint(+grid.getAttribute('x')+(${move.x}-1)*step,+grid.getAttribute('y')+(${move.y}-1)*step).matrixTransform(svg.getScreenCTM());__nativeHits.length=0;return{x:p.x,y:p.y}})()`);
      for(const type of ['mousePressed','mouseReleased'])await page.send('Input.dispatchMouseEvent',{type,...point,button:'left',clickCount:1});await pause(650);
      check(await ev(`__nativeHits.length===1&&__nativeHits[0][0]===${move.x}&&__nativeHits[0][1]===${move.y}&&besogo.editor.getCurrent()!==besogo.editor.getRoot()`), `${width}px coordinates ${coordinates}, rotated ${rotate}: native pointer maps to the intended intersection exactly once`);
      await ev('document.querySelector(".zen-reset").click()');await pause(100);
      check(await ev('besogo.editor.getCurrent()===besogo.editor.getRoot()'),'Native Reset restores root after mapped move');
    }
    await ev(`(()=>{[...document.querySelectorAll('.zen-toolbar button')].find(b=>b.textContent==='Site page').click();besogo.editor.setCoordStyle('none');document.documentElement.dataset.zenCoordinates='off';document.querySelector('.zen-resume').click()})()`);
    await wait('document.documentElement.dataset.zen==="on"');
    await ev(`(()=>{window.__hitSVG=document.querySelector('.besogo-board svg');window.__removedHit=__hitSVG.querySelector('rect[fill="transparent"]');__removedHit.remove();document.dispatchEvent(new Event('zen:preferences'))})()`);
    await wait('document.documentElement.dataset.zen==="off"');
    check(await ev('!document.querySelector(".zen-mode-fallback").hidden&&document.querySelector(".zen-resume").textContent==="Retry Zen mode"&&document.querySelector("#target svg").getBoundingClientRect().height>0'),'Missing one hit cell retains usable native page and explicit accessible fallback');
    await shot('incomplete-hit-grid');
    await ev('document.querySelector(".zen-resume").click()');await pause(150);
    check(await ev(`document.documentElement.dataset.zen==='off' ? !document.querySelector('.zen-mode-fallback').hidden : document.querySelectorAll('.besogo-board svg rect[fill="transparent"]').length===361`),'Retry only recovers after the native engine restores a complete grid');
    await ev('if(__hitSVG.isConnected)__hitSVG.append(__removedHit);document.querySelector(".zen-resume").click()');
    await wait('document.documentElement.dataset.zen==="on"&&document.querySelector(".zen-mode-fallback").hidden');
    check(true,'Restored complete native grid recovers Zen mode and clears fallback');await shot('zen-restored');
    await ev(`(()=>{for(const cell of document.querySelectorAll('.besogo-board svg rect[fill="transparent"]')){cell.setAttribute('opacity','0');cell.removeAttribute('fill')}document.dispatchEvent(new Event('zen:preferences'))})()`);await pause(100);
    check(await ev(`document.documentElement.dataset.zen==='on'&&document.querySelectorAll('.besogo-board svg rect[opacity="0"]').length===361`),'Previous zero-opacity contract still passes complete-grid validation');
    await page.send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});await pause(120);
    await ev('window.__zenProbe={lastFrame:performance.now()};requestAnimationFrame(function tick(){__zenProbe.lastFrame=performance.now();requestAnimationFrame(tick)})');
    await ev(await readFile(new URL('./webkit-check.js',import.meta.url),'utf8'));
    results.push(...(await ev('checkVisibleReview()')).checks);
    await ev('document.querySelector(".zen-next").click()');
    await wait('location.pathname==="/5194"&&document.documentElement.dataset.zen==="on"&&!document.documentElement.dataset.zenPreparing');
    check(true,'Native Next initializes current transparent-cell contract in Zen mode');
    const h=await page.send('Page.getNavigationHistory');await page.send('Page.navigateToHistoryEntry',{entryId:h.entries[h.currentIndex-1].id});
    await wait('location.pathname==="/5193"&&document.documentElement.dataset.zen==="on"');check(true,'Browser Back restores Zen mode on the native page');
  }

  if (values['review-only'] || values['keys-only']) {
    await navigate('https://tsumego.com/5193');
    await wait('!!window.besogo?.editor?.getRoot()?.children?.length && !!document.querySelector(".zen-resume") && !document.documentElement.dataset.zenPreparing');
    await ev('window.__zenProbe={lastFrame:performance.now()};requestAnimationFrame(function tick(){__zenProbe.lastFrame=performance.now();requestAnimationFrame(tick)})');
    await ev(await readFile(new URL('./webkit-check.js',import.meta.url),'utf8'));
    results.push(...(await ev('checkVisibleReview()')).checks);
    if(values['keys-only']) {
      await ev(await readFile(new URL('./review-keys-check.js',import.meta.url),'utf8'));
      await ev('window.__zenKeys=checkReviewKeys()');
      let keysCompleted=false;
      for(let i=0;i<80;i++) {
        const step=await ev('__zenKeys.next()');
        if(step.done){results.push(...step.value.checks);keysCompleted=true;break;}
        const {key,modifier,repeat}=step.value, code={ArrowLeft:37,ArrowUp:38,ArrowRight:39,ArrowDown:40}[key];
        for(const type of ['keyDown','keyUp']) await page.send('Input.dispatchKeyEvent',{type,key,code:key,windowsVirtualKeyCode:code,modifiers:{alt:1,control:2,meta:4,shift:8}[modifier]||0,autoRepeat:!!repeat});
      }
      check(keysCompleted,'Complete browser-key regression flow');
    }
    await ev(await readFile(new URL('./review-colors-check.js',import.meta.url),'utf8'));
    results.push(...(await ev('checkReviewColors()')).checks);
    for (const solver of [-1,1]) {
      await ev(`(()=>{const e=besogo.editor;if(e.getRoot().firstMove!==${solver}){const t=besogo.makeTransformation();t.invertColors=true;e.applyTransformation(t)}e.setCurrent(e.getRoot().children.find(n=>n.children.length))})()`);await pause(180);
      await shot(`review-reply-${solver===-1?'white':'black'}`);
    }
    await ev('document.querySelector(".zen-reset").click()');await pause(160);
    check(await ev('besogo.editor.getCurrent()===besogo.editor.getRoot() && [...document.querySelectorAll("#nextMoveGroup circle")].every(n=>!n.dataset.zenReply)'), 'Reset clears opponent board markers at the solver root');
    if(values['keys-only']) {
      if(await ev('besogo.editor.getReviewMode()')) {await ev('document.querySelector(".zen-review").click()');await wait('!besogo.editor.getReviewMode() && !document.querySelector(".zen-review").hasAttribute("aria-busy")');}
      for(const [key,selector] of [['ArrowRight','#besogo-next-button'],['ArrowLeft','#besogo-back-button']]) {
        const href=await ev(`document.querySelector('${selector}').href`), before=(await page.send('Page.getNavigationHistory')).currentIndex;
        await ev('document.activeElement?.blur()');
        for(const type of ['keyDown','keyUp']) await page.send('Input.dispatchKeyEvent',{type,key,code:key,windowsVirtualKeyCode:key==='ArrowRight'?39:37});
        await wait(`location.href===${JSON.stringify(href)}&&!!document.querySelector('.zen-next')&&!document.documentElement.dataset.zenPreparing`);
        check((await page.send('Page.getNavigationHistory')).currentIndex===before+1,'Outside Review '+key+': native link, one navigation, no replacement handler');
      }
      const history=await page.send('Page.getNavigationHistory');await page.send('Page.navigateToHistoryEntry',{entryId:history.entries[history.currentIndex-1].id});await wait('location.pathname==="/5194"&&!!document.querySelector(".zen-next")');
      check(true,'Browser Back follows native arrow navigation history');
    }
  }
  if (values['edges-only']) {
    const cases = [];
    for (const [name,path,mode] of [['interior','harness/puzzle.html?framing=1','Auto-fit'],
      ['top','harness/puzzle.html?p=0','Auto-fit'],['full','harness/puzzle.html?p=1','Full board']]) {
      await navigate(new URL(path,preview).href);
      await wait('!!window.besogo?.editor && !!document.querySelector(".zen-next") && !document.documentElement.dataset.zenPreparing');
      await ev(await readFile(new URL('./presentation-check.js', import.meta.url), 'utf8'));
      await ev('preparePresentationCheck()');
      for (const [width,height,reach] of [[900,600,false],[440,956,true]]) {
        await page.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
        await ev('document.querySelector(".zen-resume").click()');
        await ev(`[...document.querySelectorAll('.zen-toolbar button')].find(b=>b.textContent==='${mode}').click()`);
        for (const coordinates of [false,true]) for (const margin of ['off','on']) {
          const result = await ev(`checkPresentationCase('site',${coordinates},${reach},'${margin}')`);
          results.push(...result.checks);
          const edges = await ev('checkFiniteBoardEdges()');
          if (name==='interior' && width===900) check(edges.view[1]>0 && edges.mat===0 && edges.inset[0]===0,
            'Interior crop: real board continues above; no top mat or rim is painted');
          if (name==='top') check(edges.view[1]===0 && edges.inset[0]<0,
            'True top: only the physical outer edge can show its rim');
          cases.push({name,width,height,reach,coordinates,margin,...edges});
          if(coordinates && margin==='on') await shot(`edge-${name}-${width}`);
        }
      }
      results.push(await ev('checkPresentationRestore()'));
    }
    await writeFile(join(output,'edges.json'),JSON.stringify(cases,null,2));
  }
  if (!values['random-only'] && !values['reset-only'] && !values['tree-only'] && !values['next-only'] && !values['taps-only'] && !values['menu-only'] && !values['live-only'] && !values['edges-only'] && !values['review-only'] && !values['keys-only'] && !values['compat-only'] && !values['notices-only'] && !values['layout-only'] && !values['defaults-only'] && !values['coordinates-only'] && !values['reload-only'] && !values['tatami-only'] && !values['presented-only'] && !values['review-state-only'] && !values['turn-only'] && !values['comments-only'] && !values['contrast-only'] && !values['solid-only']) {
    preview.searchParams.set('checks', '1'); await navigate(preview.href);
    await wait('!!window.zenCheckResults', 90000);
    harness = await ev('window.zenCheckResults'); check(!harness.error && harness.passed >= 356, `Complete local behavior/viewport suite (${harness.passed} passed${harness.error ? ': ' + harness.error : ''})`);
  }
  if (values.live || values['live-only']) {
    await navigate('https://tsumego.com/5193');
    await wait('!!window.besogo?.editor?.getRoot()?.children?.length && !!document.querySelector(".zen-resume") && !document.documentElement.dataset.zenPreparing');
    check(await ev('(window.besogoNoLogin===true||window.besogoUserId===0)'), 'Fresh anonymous real-site context');
    await ev(await readFile(new URL('./presentation-check.js', import.meta.url), 'utf8'));
    const native = await ev('preparePresentationCheck()');
    await shot('theme-native');
    await ev("checkPresentationCase('site',true)");
    // Native orientation is randomized. Show all four true edges so the old
    // gutter defect cannot happen to fall outside this negative-test crop.
    await ev(`[...document.querySelectorAll('.zen-toolbar button')].find(b=>b.textContent==='Full board').click()`); await pause(100);
    await ev(`window.__oldWood=document.createElement('style');__oldWood.textContent='html[data-zen="on"] #target .besogo-board[data-zen-fit="on"] > svg {background-position:calc(var(--zen-grid-x) - var(--zen-edge-x) - var(--zen-grid-step)*.5) calc(var(--zen-grid-y) - var(--zen-edge-y) - var(--zen-grid-step)*.5) !important;background-size:var(--zen-grid-span) var(--zen-grid-span) !important}';document.head.append(__oldWood)`);
    await shot('theme-regression-before');
    let caught = false;
    let regression='no error';try { await ev("checkPresentationCase('site',true)"); } catch (error) { regression=error.message.slice(0,200);caught = error.message.includes('wood covers'); }
    check(caught, 'Regression check rejects the former exposed coordinate-gutter rule: '+regression);
    await ev('__oldWood.remove()'); await ev("checkPresentationCase('site',true)");
    await shot('theme-regression-after');
    await ev(`[...document.querySelectorAll('.zen-toolbar button')].find(b=>b.textContent==='Auto-fit').click()`); await pause(100);
    for (const [width,height,reach] of [[440,1000,true],[820,1200,false],[1180,500,false]]) {
      await page.send('Emulation.setDeviceMetricsOverride', {width,height,deviceScaleFactor:1,mobile:false});
      for (const coordinates of [false,true]) {
        const margin = await ev(`checkEdgeMarginCase(${coordinates},${reach})`); results.push(...margin.checks);
        await ev(`[...document.querySelectorAll('.zen-toolbar button')].find(b=>b.textContent==='Full board').click()`); await pause(100);
        await shot(`margin-${width}-${coordinates}`);
        await ev(`[...document.querySelectorAll('.zen-toolbar button')].find(b=>b.textContent==='Auto-fit').click()`);
      }
    }
    const presentation = { native, cases: [] };
    for (const [width, height] of [[440,1000], [1180,820], [2600,1900]]) {
      await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
      for (const theme of ['site', 'plain']) for (const coordinates of [true, false]) {
        const result = await ev(`checkPresentationCase('${theme}',${coordinates})`);
        presentation.cases.push(result); results.push(...result.checks);
        await shot(`theme-${theme}-${coordinates}-${width}`);
      }
    }
    await page.send('Emulation.setDeviceMetricsOverride', {width:2600,height:1900,deviceScaleFactor:2,mobile:false});
    const retina = await ev("checkPresentationCase('site',true)");
    check(Math.abs(retina.spacing - 80) < .01, 'Auto-fit cap remains 80 CSS pixels at devicePixelRatio 2');
    await ev(`[...document.querySelectorAll('.zen-toolbar button')].find(b=>b.textContent==='+').click()`); await pause(100);
    check(await ev(`(()=>{const s=document.querySelector('.besogo-board>svg'),g=s.querySelector('rect.besogo-svg-lines');return +g.getAttribute('width')/(besogo.editor.getRoot().getSize().x-1)*s.getScreenCTM().a>80})()`), 'Explicit manual zoom can exceed the automatic cap');
    await ev(`[...document.querySelectorAll('.zen-toolbar button')].find(b=>b.textContent==='Auto-fit').click()`); await pause(100);
    // CSS pixels, not physical pixels; normal phone reach remains unchanged.
    await page.send('Emulation.setDeviceMetricsOverride', { width:440, height:1000, deviceScaleFactor:2, mobile:false });
    presentation.cases.push(await ev("checkPresentationCase('site',true,true)"));
    results.push(await ev('checkPresentationRestore()'));
    await writeFile(join(output, 'presentation.json'), JSON.stringify(presentation, null, 2));
    await page.send('Emulation.setDeviceMetricsOverride', { width:1180, height:820, deviceScaleFactor:1, mobile:false });
    await ev('document.querySelector(".zen-resume").click()'); await pause(150);
    const hit = async move => {
      const pt = await ev(`(()=>{const s=document.querySelector('.besogo-board>svg'),r=s.querySelector('rect.besogo-svg-lines'),d=+r.getAttribute('width')/(besogo.editor.getRoot().getSize().x-1);const p=new DOMPoint(+r.getAttribute('x')+(${move.x}-1)*d,+r.getAttribute('y')+(${move.y}-1)*d).matrixTransform(s.getScreenCTM());return{x:p.x,y:p.y}})()`);
      for (const type of ['mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type, button: 'left', clickCount: 1, ...pt });
      await pause(700);
    };
    await hit(await ev('besogo.editor.getRoot().children.find(n=>!n.canStillEndCorrect()).move'));
    check(await ev('document.querySelector("#status").textContent.includes("Incorrect")'), 'Native failure through actual pointer input');
    await ev('document.querySelector(".zen-reset").click()'); await pause(100);
    check(await ev('besogo.editor.getCurrent()===besogo.editor.getRoot()'), 'Reset restores native root');
    for (let n = 0; n < 8; n++) {
      if (await ev('document.querySelector("#status").textContent.includes("Correct!")')) break;
      const move = await ev('besogo.editor.getCurrent().children.find(n=>n.canStillEndCorrect())?.move'); if (!move) break; await hit(move);
    }
    check(await ev('location.pathname==="/5193" && document.querySelector("#status").textContent.includes("Correct!")'), 'Native multi-step success waits for manual advance');
    await ev('document.querySelector(".zen-review").click()'); await wait('besogo.editor.getReviewMode()&&!document.querySelector(".zen-review").hasAttribute("aria-busy")');
    await ev('preparePresentationCheck()');
    results.push(...(await ev('checkEdgeMarginCase(true,false)')).checks);
    for (const [width,height] of [[440,1100],[2600,1900]]) {
      await page.send('Emulation.setDeviceMetricsOverride', {width,height,deviceScaleFactor:1,mobile:false});
      const result=await ev("checkPresentationCase('site',true)"); results.push(...result.checks);
      await shot(`theme-review-${width}`);
    }
    await ev('window.__node=besogo.editor.getCurrent();window.__tree=document.querySelector(".besogo-tree");undefined');
    for (const [width, height] of [[320,568],[440,956],[540,720],[820,1180],[1180,820],[1024,500],[1280,800]]) {
      await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }); await pause(180);
      check(await ev(`(()=>{const b=document.querySelector('.besogo-board').getBoundingClientRect(),n=document.querySelector('.zen-next').getBoundingClientRect(),t=document.querySelector('.zen-review-tree').getBoundingClientRect();return b.x===0&&b.y===0&&b.width===${width}&&n.width>=44&&n.bottom<=${height}&&t.height>0&&t.bottom<=${height}&&document.documentElement.scrollWidth<=${width}&&besogo.editor.getCurrent()===__node})()`), `${width}×${height}: native Review fits without changing position`);
      if (width <= 360) check(await ev(`(()=>{const exit=document.querySelector('.zen-review').getBoundingClientRect(),status=document.querySelector('.zen-live-status');return status.scrollHeight<=status.clientHeight&&[...document.querySelectorAll('.zen-review-controls button')].filter(b=>b!==document.querySelector('.zen-review')).every(b=>{const r=b.getBoundingClientRect();return r.width>=44&&r.right<=exit.left})})()`), 'Narrow Review retains the turn prompt and separate 44px navigation targets');
      if ([820,1024,1280].includes(width)) {
        const menu = await ev(`(()=>{window.__header=document.querySelector('.whitebox1');window.__headerParent=__header.parentNode;window.__menuBox=document.querySelector('.besogo-board>svg').getAttribute('viewBox');const r=document.querySelector('.zen-nav-trigger').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
        for (const type of ['mousePressed','mouseReleased']) await page.send('Input.dispatchMouseEvent', { type, button:'left', clickCount:1, ...menu });
        await wait('document.querySelector(".zen-navigation-sheet").open');
        check(await ev('document.querySelector(".zen-navigation-sheet").contains(__header)&&besogo.editor.getCurrent()===__node&&location.pathname==="/5193"'), `${width}: pointer opens original navigation without a move or Next`);
        for (const type of ['keyDown','keyUp']) await page.send('Input.dispatchKeyEvent', { type, key:'Escape', code:'Escape', windowsVirtualKeyCode:27 });
        await wait('!document.querySelector(".zen-navigation-sheet").open'); await pause(100);
        check(await ev('__header.parentNode===__headerParent&&document.activeElement===document.querySelector(".zen-nav-trigger")&&document.querySelector(".besogo-board>svg").getAttribute("viewBox")===__menuBox'), `${width}: Escape restores native header, keyboard focus and crop`);
      }
      await shot('chrome-review-' + width);
    }
    await ev('[...document.querySelectorAll(".zen-toolbar button")].find(b=>b.textContent==="Site page").click()'); await pause(180);
    check(await ev('document.documentElement.dataset.zen==="off"&&document.querySelector("#target").contains(__tree)&&besogo.editor.getCurrent()===__node'), 'Regular mode restores original tree and native position');
    await shot('chrome-regular'); await page.send('Page.reload');
    await wait('!!document.querySelector(".zen-resume")&&document.documentElement.dataset.zen==="off"');
    check(await ev('!document.querySelector(".zen-resume").hidden'), 'Installed preference survives reload');
    await ev('document.querySelector(".zen-resume").click()'); await pause(100);
    const y = await ev('document.querySelector(".zen-next").getBoundingClientRect().y');
    await ev('document.querySelector(".zen-next").click()');
    await wait('location.pathname==="/5194"&&!!document.querySelector(".zen-next")&&!document.documentElement.dataset.zenPreparing');
    check(await ev('document.querySelector(".zen-next").getBoundingClientRect().y') === y, 'Native Next keeps control placement');
    const h = await page.send('Page.getNavigationHistory');
    for (const [index, path] of [[h.currentIndex-1,'/5193'],[h.currentIndex,'/5194']]) {
      await page.send('Page.navigateToHistoryEntry', { entryId: h.entries[index].id });
      await wait(`location.pathname==='${path}'&&!!document.querySelector('.zen-next')`); check(true, 'Native history ' + path);
    }
    for (const path of ['/collections', '/users/login']) {
      await navigate('https://tsumego.com' + path); await wait('document.readyState==="complete"');
      check(await ev('location.hostname==="tsumego.com"&&!document.documentElement.hasAttribute("data-zen")&&!document.querySelector(".zen-toolbar")&&document.body.innerText.length>100'), 'Non-target page remains native: ' + path);
    }
  }
  if (values.coverage) {
    clearInterval(coverageTimer); await coverageDelta().catch(() => {});
    await writeFile(values.coverage, JSON.stringify({ length: zenCss.length, seen: [...coverage.seen], used: [...coverage.used] }));
  }
  await writeFile(join(output, 'result.json'), JSON.stringify({ testedAt: new Date().toISOString(), browser: version.Browser, extension: installed.id, harness, live: values.live || values['live-only'] || values['review-only'] || values['keys-only'] || values['compat-only'] || values['notices-only'] || values['layout-only'] || values['defaults-only'] || values['coordinates-only'] || values['reload-only'] || values['tatami-only'] || values['presented-only'] || values['review-state-only'] || values['turn-only'] || values['comments-only'], checks: results }, null, 2));
  console.log(JSON.stringify({ harness: harness?.passed, checks: results.length, live: values.live || values['live-only'] || values['review-only'] || values['keys-only'] || values['compat-only'] || values['notices-only'] || values['layout-only'] || values['defaults-only'] || values['coordinates-only'] || values['reload-only'] || values['tatami-only'] || values['presented-only'] || values['review-state-only'] || values['turn-only'] || values['comments-only'], output }));
} finally {
  page?.close(); if (root) { try { await root.send('Browser.close'); } catch {} root.close(); }
  browser.kill('SIGTERM');
  if (browser.exitCode === null && browser.signalCode === null)
    await Promise.race([new Promise(resolve => browser.once('exit', resolve)), pause(2000)]);
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
