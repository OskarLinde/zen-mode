// Presentation-only fake native notifications. This never calls award/account APIs.
// Drivers provide browser input; the same assertions run in Chromium and WebKit.
async function* checkAchievementNotices({ touch = true } = {}) {
  const q=s=>document.querySelector(s), pause=ms=>new Promise(r=>setTimeout(r,ms)), checks=[];
  const check=(ok,label)=>{if(!ok)throw Error(label);checks.push(label)};
  const e=besogo.editor, path=location.pathname;
  check((window.besogoNoLogin===true||window.besogoUserId===0) && typeof showAchievementPopup==='function', 'Anonymous native presentation function; no achievement issued');
  if(e.getReviewMode()){q('.zen-review').click();for(let i=0;i<60&&q('.zen-review').hasAttribute('aria-busy');i++)await pause(100);}
  q('.zen-reset').click();await pause(120);
  for(let i=0;i<8&&!q('#status').textContent.includes('Correct!');i++) {
    const move=e.getCurrent().children.find(n=>n.canStillEndCorrect())?.move;if(!move)break;
    const svg=q('.besogo-board > svg'),grid=svg.querySelector('rect.besogo-svg-lines'),step=+grid.getAttribute('width')/(e.getRoot().getSize().x-1);
    const p=new DOMPoint(+grid.getAttribute('x')+(move.x-1)*step,+grid.getAttribute('y')+(move.y-1)*step).matrixTransform(svg.getScreenCTM());
    yield {input:'click',x:p.x,y:p.y};await pause(700);
  }
  check(!e.getReviewMode() && q('#status').textContent.includes('Correct!'), 'Solved native page exercises click-anywhere advancement protection');
  const node=e.getCurrent();
  const actualClick=e.click;let boardClicks=0,documentClicks=0,closeClicks=0,linkClicks=0,trusted=0;
  const documentClick=()=>documentClicks++, track=event=>{if(event.isTrusted)trusted++};
  e.click=function(...args){boardClicks++;return actualClick.apply(this,args)};
  document.addEventListener('click',documentClick);window.addEventListener('click',track,true);
  const geometry=()=>{const s=q('.besogo-board > svg'),m=s.getScreenCTM(),t=q('.zen-toolbar').getBoundingClientRect();return JSON.stringify([s.getAttribute('viewBox'),m.a,m.d,m.e,m.f,t.x,t.y,t.width,t.height])};
  const point=(el,dx=.5,dy=.5)=>{const r=el.getBoundingClientRect();return{x:r.x+r.width*dx,y:r.y+r.height*dy}};
  const inject=async long=>{
    showAchievementPopup({color:'green',image:'hp1',name:'TEST ONLY · Practice streak',description:long?'Fake display sample — no achievement earned. '.repeat(14)+'LongUnbrokenAchievementLabelForWrapping1234567890':'Fake display sample — no achievement earned.',xp:0,id:0});
    const t=[...document.querySelectorAll('.toast--achievement')].at(-1);
    t.querySelector('.toast__close').addEventListener('click',()=>closeClicks++);
    t.querySelector('a').addEventListener('click',event=>{event.preventDefault();linkClicks++}); // Never follow the fake achievement URL.
    await pause(680);return t;
  };
  const hidden=t=>getComputedStyle(t).display==='none';
  const noLeak=(before,label)=>check(boardClicks===0&&documentClicks===0&&e.getCurrent()===node&&location.pathname===path&&geometry()===before,label);
  try {
    for(const [width,height,long,input] of [[320,740,false,'click'],[440,956,true,touch?'touch':'click'],[820,1000,false,'click'],[1180,650,true,'click'],[740,320,true,touch?'touch':'click']]) {
      yield {resize:[width,height]};await pause(160);const before=geometry(),t=await inject(long),r=t.getBoundingClientRect(),bar=q('.zen-toolbar').getBoundingClientRect();
      check(t.hasAttribute('data-zen-achievement')&&r.width<=420&&r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=bar.top,`${width}: card fits above controls within actual ${innerWidth}×${innerHeight} viewport`);
      check(t.scrollWidth<=t.clientWidth+1&&t.textContent.includes('no achievement earned'),`${width}: native text preserved and wraps without horizontal clipping`);
      const next=q('.zen-next'),p=point(next);
      check(document.elementFromPoint(p.x,p.y)?.closest('.zen-next')===next,`${width}: Next remains uncovered`);
      check(geometry()===before,`${width}: popup does not move board, mapping or footer`);
      if(long){check(t.scrollHeight>t.clientHeight || t.scrollHeight<bar.top-r.top,`${width}: long content is visible or scrollable`);t.scrollTop=t.scrollHeight;await pause(60);check(t.querySelector('a').getBoundingClientRect().bottom<=r.bottom+1,`${width}: final native content can be reached by scrolling`);t.scrollTop=0;}
      yield {screenshot:'achievement-'+width};
      const closeBefore=closeClicks;
      yield {input,...point(t.querySelector('.toast__banner'),.3)};await pause(570);
      check(hidden(t)&&closeClicks===closeBefore+1,`${width}: ${input} dismisses through native close exactly once`);
      noLeak(before,`${width}: dismissal cannot play, advance or change layout on solved page`);
    }
    yield {resize:[440,740]};await pause(100);
    let t=await inject(false),before=geometry(),links=linkClicks;
    yield {input:'click',...point(t.querySelector('a'))};await pause(100);
    check(linkClicks===links+1&&!hidden(t),'Original achievement link remains interactive without dismissing');
    noLeak(before,'Link handling does not leak a board or Next click');
    for(const key of ['Enter',' ','Escape']) {
      if(hidden(t))t=await inject(false);t.focus();const closes=closeClicks;
      yield {key};await pause(570);
      check(hidden(t)&&closeClicks===closes+1,'Focused card dismisses via keyboard '+JSON.stringify(key));
      noLeak(before,'Keyboard dismissal retains solved position and problem');
    }
    t=await inject(false);t.querySelector('.zen-achievement-dismiss').focus();
    yield {key:'Enter'};await pause(570);check(hidden(t),'Accessible dismiss button responds to native Enter');
    // Delayed independent insertions use the native renderer each time.
    const first=await inject(false);await pause(180);const second=await inject(false);await pause(180);const third=await inject(false);
    check([first,second,third].every(t=>t.hasAttribute('data-zen-achievement')&&!hidden(t)),'Repeated and delayed native notifications are independently enhanced');
    yield {input:'click',...point(first.querySelector('.zen-achievement-dismiss'))};await pause(570);
    check(hidden(first)&&!hidden(second)&&!hidden(third),'Dismissing one notification preserves later notifications');
    yield {input:'click',...point(second.querySelector('.zen-achievement-dismiss'))};await pause(570);
    yield {input:'click',...point(third.querySelector('.zen-achievement-dismiss'))};await pause(570);
    check(hidden(second)&&hidden(third),'Stack remains dismissible as earlier cards disappear');
    const later=await inject(true);yield {input:'drag',from:point(later,.5,.75),to:point(later,.5,.3)};await pause(150);
    check(!hidden(later),'Scrolling/dragging a long notification does not dismiss it');
    later.scrollTop=0;yield {input:'click',...point(later.querySelector('.zen-achievement-dismiss'))};await pause(570);
    check(hidden(later),'Later notification remains normally dismissible after scrolling');
    const restored=await inject(false), nativeClose=restored.querySelector('.toast__close');
    const unrelated=document.createElement('div');unrelated.className='toast';unrelated.textContent='TEST ONLY unrelated notice';document.body.append(unrelated);await pause(60);
    check(!unrelated.hasAttribute('data-zen-achievement')&&unrelated.parentNode===document.body,'Unrelated notices/errors are untouched');unrelated.remove();
    // DOM-triggered mode change is separate from the input/dismissal proof above.
    document.removeEventListener('click',documentClick);
    [...q('.zen-toolbar').querySelectorAll('button')].find(b=>b.textContent==='Site page').click();await pause(120);
    check(restored.parentNode===document.body&&!restored.hasAttribute('data-zen-achievement')&&!restored.hasAttribute('tabindex')&&!restored.hasAttribute('role')&&!restored.querySelector('.zen-achievement-dismiss'),'Regular restores native parent, attributes and original controls');
    check(getComputedStyle(restored).width==='1000px'&&restored.querySelector('.toast__close')===nativeClose&&getComputedStyle(nativeClose).display!=='none','Regular restores original native popup styling and handler');
    q('.zen-resume').click();await pause(120);
    check(restored.hasAttribute('data-zen-achievement')&&hidden(first)&&hidden(second),'Returning to Zen mode enhances current toast without resurrecting dismissed ones');
    restored.remove();await pause(30);
    [...q('.zen-toolbar').querySelectorAll('button')].find(b=>b.textContent==='Site page').click();await pause(80);q('.zen-resume').click();await pause(100);
    check(!restored.isConnected,'Removed native notification is not resurrected by mode switching');
    q('.zen-review').click();for(let i=0;i<60&&q('.zen-review').hasAttribute('aria-busy');i++)await pause(100);
    check(e.getReviewMode(),'Native Review reopens after popup lifecycle');
    const reviewing=await inject(true),reviewNode=e.getCurrent(),reviewGeometry=geometry(),bar=q('.zen-toolbar').getBoundingClientRect();
    check(reviewing.getBoundingClientRect().bottom<=bar.top,'Long notification stays above expanded Review controls and tree');
    reviewing.focus();yield {key:'ArrowDown'};await pause(120);
    check(e.getCurrent()===reviewNode&&location.pathname===path,'Arrow scrolls the focused notice without navigating the Review tree');
    yield {screenshot:'achievement-review'};
    reviewing.scrollTop=0;yield {input:'click',...point(reviewing.querySelector('.zen-achievement-dismiss'))};await pause(570);
    check(hidden(reviewing)&&e.getCurrent()===reviewNode&&geometry()===reviewGeometry,'Review popup dismissal preserves native node and board mapping');
    q('.zen-review').click();for(let i=0;i<60&&q('.zen-review').hasAttribute('aria-busy');i++)await pause(100);
    check(trusted>8,'Browser/native event queue delivered trusted popup input');
  } finally {e.click=actualClick;document.removeEventListener('click',documentClick);window.removeEventListener('click',track,true);}
  return {checks,trusted};
}
