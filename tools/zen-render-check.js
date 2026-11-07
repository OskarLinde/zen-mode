// Isolated native-page presentation checks. Never calls account/theme APIs.
// Drivers supply viewport changes, screenshots and native pointer input.
async function* checkZenRendering() {
  const q=s=>document.querySelector(s), pause=ms=>new Promise(r=>setTimeout(r,ms)), checks=[];
  const check=(ok,label)=>{if(!ok)throw Error(label);checks.push(label)};
  const button=text=>[...q('.zen-toolbar').querySelectorAll('button')].find(b=>b.textContent===text);
  const choose=(label,value)=>{const s=q(`select[aria-label="${label}"]`);s.value=value;s.dispatchEvent(new Event('change'))};
  const board=()=>q('.besogo-board'), e=besogo.editor, root=e.getRoot();
  function viewport(label) {
    const b=board().getBoundingClientRect(), h=q('.zen-toolbar').getBoundingClientRect().top;
    check(b.left===0&&b.width===innerWidth&&b.height>=h,`${label}: drawing and mat cover the viewport before any option changes`);
    for(const x of [4,innerWidth/2,innerWidth-4])for(const y of [4,h/2,h-4])
      check(document.elementFromPoint(x,y)?.closest('.besogo-board')===board(),`${label}: no native page/card rectangle at ${Math.round(x)},${Math.round(y)}`);
    checks.push(...checkFiniteBoardEdges().checks);
  }
  check((window.besogoNoLogin===true||window.besogoUserId===0),'Fresh anonymous native page; no account writes');
  await pause(300);viewport('Fresh load');yield {screenshot:'wide-fresh'};
  // Repeat the native height-fit constraint even when random orientation gave
  // this particular page a generous cap. Zen mode must tolerate either shape.
  const cap=board().style.maxWidth;board().style.maxWidth='min(100%, 320px)';await pause(100);
  viewport('Native narrow cap');board().style.maxWidth=cap;
  const originalPalette=document.documentElement.dataset.theme;
  const nativePrompt=q('#descriptionText')||q('#titleDescription'), originalPrompt=nativePrompt.innerHTML;
  const nativeStatus=q('#status'), originalStatus=nativeStatus.innerHTML;
  try {
    for(const [width,height] of [[1800,1000],[1440,550],[820,1000],[440,956],[1800,1000]]) {
      yield {resize:[width,height]};await pause(200);viewport(`${innerWidth}×${innerHeight}`);
      yield {screenshot:`wide-resize-${width}x${height}`};
    }
    // Fix orientation within this one page. Root/variations are transformed by
    // native APIs, never reconstructed, and both screenshots use the same tree.
    const t=besogo.makeTransformation();t.rotateClockwise=true;e.applyTransformation(t);await pause(150);
    viewport('Native quarter turn');
    await preparePresentationCheck(); // Native texture baseline in Regular.
    const nativeCap=board().style.maxWidth;
    check(getComputedStyle(board()).maxWidth!=='none','Regular retains native board height cap');
    q('.zen-resume').click();await pause(120);
    // Full board exposes a real mat region on wide windows, independently of
    // which native corner/orientation was randomly chosen for this puzzle.
    button('Full board').click();
    for(const theme of ['plain','site'])for(const surround of ['auto','natural','woven']) {
      choose('Outside board',surround);
      checks.push(...(await checkPresentationCase(theme,true,false)).checks);viewport(`${theme}/${surround}`);
      const background=getComputedStyle(board()).backgroundImage;
      check(background.includes('tatami.png')===(surround==='natural'||(surround==='auto'&&theme==='site')),`${theme}/${surround}: correct selected mat source`);
      if(background.includes('tatami.png')) {
        const url=getComputedStyle(document.documentElement).getPropertyValue('--zen-tatami-image').trim().slice(4,-1).replace(/^['"]|['"]$/g,'');
        const image=new Image();image.src=url;await image.decode();
        check(image.naturalWidth>0&&image.naturalHeight>0,`${theme}/${surround}: packaged extension image decodes`);
      }
      yield {screenshot:`wide-full-${theme}-${surround}`,surface:checkFiniteBoardEdges().surface};
    }
    choose('Outside board','natural');button('Auto-fit').click();
    for(const [width,height] of [[1440,550],[440,956]]) {
      yield {resize:[width,height]};await pause(150);
      for(const theme of ['plain','site'])for(const coordinates of [false,true]) {
        checks.push(...(await checkPresentationCase(theme,coordinates,width<600)).checks);viewport('Auto-fit '+width);
        for(const color of ['Black','White']) {
          // Presentation fixture on the actual native text channel, including
          // colored nested spans and suffix. No puzzle/answer state is altered.
          document.documentElement.dataset.theme='dark';nativeStatus.textContent='';
          nativePrompt.innerHTML=`<span style="color:lightskyblue">${color} to kill.</span> <span style="color:lightskyblue">(No Ko)</span>`;
          document.dispatchEvent(new Event('zen:preferences'));await pause(80);const live=q('.zen-live-status');
          check(live.textContent===`${color} to kill. (No Ko)`&&live.dataset.turn===color.toLowerCase(),'Exact instruction/suffix and displayed stone cue preserved');
          check(getComputedStyle(live).color==='rgb(23, 28, 25)'&&![...live.children].some(n=>getComputedStyle(n).color!=='rgb(23, 28, 25)'),`${width}/${theme}: neutral ${color} prompt readable on gray despite native palette/spans`);
        }
        yield {screenshot:`prompt-${width}-${theme}-${coordinates}`};
      }
    }
    // All mirrored status text stays readable; native result wording is retained.
    nativeStatus.innerHTML='<h2>Incorrect!</h2>';await pause(80);
    check(q('.zen-live-status').dataset.turn===''&&getComputedStyle(q('.zen-live-status')).color==='rgb(23, 28, 25)','Result channel uses readable Zen mode feedback color');
    nativePrompt.innerHTML=originalPrompt;nativeStatus.innerHTML=originalStatus;
    document.documentElement.dataset.theme=originalPalette;await pause(100);
    yield {resize:[1180,820]};await pause(100);button('Auto-fit').click();await pause(100);
    // Actual pointer-to-native mapping after resizing, rotation and coordinates.
    const actualClick=e.click;let calls=[];e.click=function(...args){calls.push(args);return actualClick.apply(this,args)};
    try {
      const move=root.children.find(n=>n.canStillEndCorrect()).move;
      const s=board().querySelector('svg'),g=s.querySelector('rect.besogo-svg-lines'),d=+g.getAttribute('width')/(root.getSize().x-1);
      const p=new DOMPoint(+g.getAttribute('x')+(move.x-1)*d,+g.getAttribute('y')+(move.y-1)*d).matrixTransform(s.getScreenCTM());
      yield {input:'click',x:p.x,y:p.y};await pause(700);
      check(calls.length===1&&calls[0][0]===move.x&&calls[0][1]===move.y&&e.getCurrent()!==root,'Native pointer maps exactly once after resize/rotation/theme/coordinates');
    } finally {e.click=actualClick;}
    q('.zen-reset').click();await pause(120);check(e.getCurrent()===root,'Native Reset restores root after mapped move');
    button('Site page').click();await pause(140);
    check(getComputedStyle(board()).maxWidth!=='none'&&board().style.maxWidth,'Regular still uses native cap after all Zen mode cases');
    const regular={box:board().querySelector('svg').getAttribute('viewBox'),cap:board().style.maxWidth,color:getComputedStyle(nativePrompt).color,markup:nativePrompt.innerHTML};
    q('.zen-resume').click();await pause(100);button('Site page').click();await pause(100);
    check(board().querySelector('svg').getAttribute('viewBox')===regular.box&&board().style.maxWidth===regular.cap&&getComputedStyle(nativePrompt).color===regular.color&&nativePrompt.innerHTML===regular.markup,'Regular restores native geometry, cap, prompt markup and color in place');
    q('.zen-resume').click();await pause(100);
  } finally {nativePrompt.innerHTML=originalPrompt;nativeStatus.innerHTML=originalStatus;document.documentElement.dataset.theme=originalPalette;}
  return {checks};
}
