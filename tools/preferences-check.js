// Test-only document-start observer; no writes or account calls.
function observePreferencePaint() {
  window.__zenPreferenceTrace={paint:[],phases:[]};
  function tick() {
    const d=document.documentElement?.dataset,t=__zenPreferenceTrace;
    if(d) {
      if(d.zenHandoff&&!t.phases.includes(d.zenHandoff))t.phases.push(d.zenHandoff);
      const svg=document.querySelector('.besogo-board > svg');
      if(d.zen==='on'&&d.zenReady==='on'&&!d.zenPreparing&&svg&&getComputedStyle(svg).opacity==='1') {
        const values=[d.zenTheme,d.zenMargin,d.zenMotion,d.zenSurround];
        if(t.paint.length<20&&JSON.stringify(t.paint.at(-1))!==JSON.stringify(values))t.paint.push(values);
      }
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}
function checkPreferencePaint(expected=['site','on','on','auto']) {
  const d=document.documentElement.dataset,trace=window.__zenPreferenceTrace;
  if(JSON.stringify([d.zenTheme,d.zenMargin,d.zenMotion,d.zenSurround])!==JSON.stringify(expected))throw Error('Current preferences differ');
  if(!trace.paint.length||trace.paint.some(p=>JSON.stringify(p)!==JSON.stringify(expected)))throw Error('First/visible paint has wrong preferences: '+JSON.stringify(trace));
  for(const [label,value] of [['Board appearance',expected[0]],['Board edge margin',expected[1]],['Board transition',expected[2]],['Outside board',expected[3]]])
    if(document.querySelector(`select[aria-label="${label}"]`).value!==value)throw Error('Menu preference differs: '+label);
  return trace;
}
async function* checkFeedbackPresentation() {
  const q=s=>document.querySelector(s),pause=ms=>new Promise(r=>setTimeout(r,ms)),checks=[],e=besogo.editor;
  const check=(ok,label)=>{if(!ok)throw Error(label);checks.push(label)};
  const dark=el=>getComputedStyle(el).color==='rgb(23, 28, 25)';
  async function* hit(move) {
    const svg=q('.besogo-board > svg'),g=svg.querySelector('rect.besogo-svg-lines'),step=+g.getAttribute('width')/(e.getRoot().getSize().x-1);
    const p=new DOMPoint(+g.getAttribute('x')+(move.x-1)*step,+g.getAttribute('y')+(move.y-1)*step).matrixTransform(svg.getScreenCTM());
    yield {click:[p.x,p.y]};await pause(700);
  }
  check((window.besogoNoLogin===true||window.besogoUserId===0),'Anonymous native test context');
  yield* hit(e.getRoot().children.find(n=>!n.canStillEndCorrect()).move);
  check(q('#status').textContent.includes('Incorrect')&&q('.zen-live-status').textContent===q('#status').textContent.trim()&&dark(q('.zen-live-status')),'Native failure remains exact and dark');
  yield {screenshot:'failure-wide'};q('.zen-reset').click();await pause(100);
  for(let i=0;i<8&&!q('#status').textContent.includes('Correct!');i++) {const next=e.getCurrent().children.find(n=>n.canStillEndCorrect());if(!next)break;yield* hit(next.move);}
  check(q('#status').textContent.includes('Correct!')&&dark(q('.zen-live-status'))&&location.pathname==='/5193','Native multi-step success stays dark and waits for manual Next');
  yield {screenshot:'success-wide'};
  const status=q('#status'),comment=q('#theComment'),palette=document.documentElement.dataset.theme,mode=window.mode;
  const saved=[status.innerHTML,comment.innerHTML,comment.getAttribute('style')];
  try {
    document.documentElement.dataset.theme='dark';
    for(const width of [1180,440]) {
      yield {resize:[width,820]};await pause(100);
      for(const text of ['Incorrect!','Correct!','White to kill. (No Ko)','Black to live.']) {
        window.mode=mode;comment.style.display='none';status.innerHTML=`<h2 style="color:lightskyblue"><span>${text}</span></h2>`;
        await pause(80);check(q('.zen-live-status').textContent===text&&dark(q('.zen-live-status')),`${width}: exact dark status from nested native markup: ${text}`);
      }
      for(const text of ['Correct, but what about this move?','Try another answer.','Retry this problem. Replay complete.']) {
        comment.style.display='';comment.innerHTML=`<span style="color:lightskyblue">${text}</span><a href="#" style="color:lightskyblue"> More</a>`;
        await pause(80);const b=q('.zen-feedback button');
        check(b.textContent===text+' More'&&dark(b)&&q('.zen-live-status').hidden,`${width}: continuation/comment text stays exact, dark and visible`);
        b.click();await pause(30);check(q('.zen-feedback-dialog').open&&dark(q('.zen-feedback-dialog p'))&&q('.zen-feedback-dialog p').textContent===b.textContent,'Full feedback dialog retains readable exact text');
        q('.zen-feedback-dialog').close();
      }
      window.mode=5;comment.style.display='none';status.innerHTML='<h2>Incorrect!</h2><span class="mistake-training-note" style="color:lightskyblue">Retry tomorrow.</span><span class="mistake-training-outcome">Replay complete.</span>';
      await pause(80);check(dark(q('.zen-feedback button'))&&q('.zen-feedback button').textContent==='Incorrect!\n\nRetry tomorrow.\n\nReplay complete.','Training presentation fixture preserves joined feedback and dark text');
      yield {screenshot:'feedback-'+width};window.mode=mode;
      const color=getComputedStyle(status.querySelector('.mistake-training-note')).color,markup=status.innerHTML;
      [...q('.zen-toolbar').querySelectorAll('button')].find(b=>b.textContent==='Site page').click();await pause(100);
      check(getComputedStyle(status.querySelector('.mistake-training-note')).color===color&&status.innerHTML===markup,'Regular retains original native message markup and styles');
      q('.zen-resume').click();await pause(100);
    }
  } finally {
    window.mode=mode;status.innerHTML=saved[0];comment.innerHTML=saved[1];saved[2]===null?comment.removeAttribute('style'):comment.setAttribute('style',saved[2]);document.documentElement.dataset.theme=palette;
  }
  return {checks};
}
