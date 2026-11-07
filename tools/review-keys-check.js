// Driven one key at a time by CDP or the isolated WebKit host's native event
// queue. Synthetic DOM events are used only for composition/handled edge cases.
async function* checkReviewKeys() {
  const e=besogo.editor, root=e.getRoot(), original=e.getCurrent(), checks=[];
  const pause=()=>new Promise(r=>setTimeout(r,100)), q=s=>document.querySelector(s);
  const check=(ok,text)=>{if(!ok)throw Error(text);checks.push(text)};
  const focus=s=>s==='body'?document.activeElement?.blur():q(s).focus();
  const clicks={};let documentKeys=0,trusted=0;
  const countClick=event=>{const name=event.target.closest('.zen-rewind,.zen-forward,.zen-branch-up,.zen-branch-down')?.className;if(name)clicks[name]=(clicks[name]||0)+1};
  const countDocument=()=>documentKeys++;
  const countTrusted=event=>{if(event.isTrusted&&event.key.startsWith('Arrow'))trusted++};
  document.addEventListener('click',countClick,true);document.addEventListener('keydown',countDocument);
  window.addEventListener('keydown',countTrusted,true);
  const count=()=>Object.values(clicks).reduce((a,b)=>a+b,0);
  const first=root.children[0], reply=first.children[0];
  check((window.besogoNoLogin===true||window.besogoUserId===0)&&e.getReviewMode()&&root.children.length>1&&reply,'Anonymous Review with multiple branches');
  try {
    for(const source of ['body','.besogo-board','#target','.zen-review']) {
      e.setCurrent(reply);await pause();focus(source);let before=count();
      yield {key:'ArrowLeft'};await pause();
      check(e.getCurrent()===first&&count()===before+1,`${source}: Left invokes exactly one Review Back`);
      yield {key:'ArrowRight'};await pause();
      check(e.getCurrent()===reply&&count()===before+2,`${source}: Right invokes exactly one Review Forward`);
    }
    e.setCurrent(first);await pause();focus('.besogo-board');let before=count();
    yield {key:'ArrowDown'};await pause();check(e.getCurrent()===root.children[1]&&count()===before+1,'Down selects exactly the next sibling');
    yield {key:'ArrowUp'};await pause();check(e.getCurrent()===first&&count()===before+2,'Up restores exactly the previous sibling');
    check(e.getCurrent().navTreeMarker.classList.contains('zen-current-tree-node'),'Keyboard selection updates native current-node highlight');
    e.setCurrent(root);await pause();before=count();
    for(const key of ['ArrowLeft','ArrowUp','ArrowDown']){yield {key};await pause();check(e.getCurrent()===root&&count()===before,'Unavailable root direction does not move or navigate');}
    let leaf=first;while(leaf.children.length)leaf=leaf.children[0];e.setCurrent(leaf);await pause();before=count();
    yield {key:'ArrowRight'};await pause();check(e.getCurrent()===leaf&&count()===before,'Unavailable end direction does not become problem Next');
    e.setCurrent(reply);await pause();
    for(const modifier of ['shift','control','alt','meta']){yield {key:'ArrowLeft',modifier};await pause();check(e.getCurrent()===reply,'Modified arrow is not a Review shortcut: '+modifier);}
    yield {key:'ArrowLeft',repeat:true};await pause();check(e.getCurrent()===reply,'Held-key repeat does not repeat a move');
    // These flags cannot be reliably requested via physical-key automation.
    for(const extra of [{isComposing:true},{keyCode:229}]){
      const event=new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true,cancelable:true,...extra});q('.besogo-board').dispatchEvent(event);
      check(e.getCurrent()===reply&&!event.defaultPrevented,'Synthetic composition event retains default behavior and does not move');
    }
    const box=document.createElement('div');box.style='position:fixed;top:0;left:0;z-index:2147483647;background:white';
    box.innerHTML='<input value="abcd"><textarea>abcd</textarea><select size="2"><option>First</option><option>Second</option></select><div contenteditable="true">abcd</div><div role="slider" tabindex="0">widget</div><div class="handled" tabindex="0">handled</div>';
    document.body.append(box);
    try {
      for(const selector of ['input','textarea','select','[contenteditable]','[role="slider"]','.handled']) {
        const el=box.querySelector(selector);if(selector==='select')el.selectedIndex=0;el.focus();if(el.setSelectionRange)el.setSelectionRange(2,2);
        let widgetKeys=0;const handled=event=>{widgetKeys++;if(selector==='.handled')event.preventDefault()};el.addEventListener('keydown',handled);
        const key=selector==='select'?'ArrowDown':'ArrowLeft';yield {key};await pause();
        check(e.getCurrent()===reply&&widgetKeys===1,'Focused control receives its arrow without Review movement: '+selector);
        if(el.setSelectionRange)check(el.selectionStart===1&&el.selectionEnd===1,'Arrow preserves text caret movement: '+selector);
        if(selector==='select')check(el.selectedIndex===1,'Arrow preserves native select behavior');
        el.removeEventListener('keydown',handled);
      }
    } finally {box.remove();}
    for(const [trigger,dialog] of [['.zen-nav-trigger','.zen-navigation-sheet'],['.zen-options summary','.zen-problem-sheet']]) {
      q(trigger).click();await pause();before=count();yield {key:'ArrowLeft'};await pause();
      check(q(dialog).open&&e.getCurrent()===reply&&count()===before,'Open native menu keeps keyboard focus without Review movement');q(dialog).close();await pause();
    }
    check(documentKeys===0,'Review keys never reach the competing native document listener');
    [...q('.zen-toolbar').querySelectorAll('button')].find(b=>b.textContent==='Site page').click();await pause();focus('#target');before=count();
    yield {key:'ArrowLeft'};await pause();
    check(document.documentElement.dataset.zen==='off'&&e.getCurrent()===reply&&count()===before&&documentKeys===1,'Regular mode passes the key to the native page without extension actions');
    q('.zen-resume').click();await pause();
    const slowNativeReview=()=>{
      const native=q('[id^="besogo-review-button"]');
      native.addEventListener('click',event=>{
        event.preventDefault();event.stopImmediatePropagation();setTimeout(()=>native.click(),350);
      },{capture:true,once:true});
    };
    slowNativeReview();q('.zen-review').click(); // Pending close: never problem Next.
    focus('body');yield {key:'ArrowRight'};await pause();
    check(location.pathname==='/5193','Pending Review close does not navigate problems');
    for(let i=0;i<50&&q('.zen-review').hasAttribute('aria-busy');i++)await pause();
    check(!e.getReviewMode(),'Review exit completes normally');
    // Keep the opened state/position expected by the surrounding host checks.
    slowNativeReview();q('.zen-review').click();
    focus('body');yield {key:'ArrowRight'};await pause();check(location.pathname==='/5193','Pending Review open does not navigate problems');
    for(let i=0;i<50&&q('.zen-review').hasAttribute('aria-busy');i++)await pause();
    check(e.getReviewMode(),'Review reopens normally');e.setCurrent(original);await pause();
    check(trusted>0,'Browser/native event queue delivered trusted keyboard events');
  } finally {
    document.removeEventListener('click',countClick,true);document.removeEventListener('keydown',countDocument);window.removeEventListener('keydown',countTrusted,true);
  }
  return {checks,trusted};
}
