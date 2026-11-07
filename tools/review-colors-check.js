// Run only in an isolated anonymous native Review session. Transforms and the
// local transforms remain in this disposable page, never an account.
async function checkReviewColors() {
  const e = besogo.editor, root = e.getRoot(), original = e.getCurrent();
  const inverted = e.isColorInverted(), checks = [];
  const pause = () => new Promise(resolve => setTimeout(resolve, 160));
  const check = (ok, text) => { if (!ok) throw Error(text); checks.push(text); };
  const button = selector => document.querySelector(selector);
  const rgb = color => color === -1 ? 'rgb(0, 0, 0)' : 'rgb(255, 255, 255)';
  const nativeColor = {green:'rgb(0, 128, 0)',red:'rgb(255, 0, 0)',blue:'rgb(0, 0, 255)',grey:'rgb(128, 128, 128)'};
  const invert = () => { const t = besogo.makeTransformation(); t.invertColors = true; e.applyTransformation(t); };
  function markers() {
    const current = e.getCurrent(), dots = [...document.querySelectorAll('#nextMoveGroup > circle')];
    const grid = document.querySelector('.besogo-board svg rect.besogo-svg-lines');
    const step = +grid.getAttribute('width') / (root.getSize().x - 1);
    current.children.forEach((branch,i) => {
      const dot = dots[i], c = branch.move.color;
      check(!!dot && Math.abs(+dot.getAttribute('cx') - (+grid.getAttribute('x') + (branch.move.x - 1) * step)) < .01 &&
        Math.abs(+dot.getAttribute('cy') - (+grid.getAttribute('y') + (branch.move.y - 1) * step)) < .01,
      'Continuation marker maps to the corresponding native branch');
      if (branch.localEdit || c === root.firstMove) {
        check(!dot.dataset.zenReply && getComputedStyle(dot).fill === nativeColor[dot.getAttribute('fill')], 'Solver/local marker keeps its native red/green/blue semantics');
      } else check(getComputedStyle(dot).fill === rgb(c), `Opponent board marker is displayed ${c === -1 ? 'Black' : 'White'}`);
    });
  }
  check((window.besogoNoLogin===true||window.besogoUserId===0) && e.getReviewMode(), 'Color checks use anonymous native Review');
  for (const solver of [-1,1]) {
    if(root.firstMove !== solver) invert();
    e.setCurrent(root); await pause(); markers();
    const nodes=[root];let replyCount=0,solverCount=0;
    for(let i=0;i<nodes.length;i++) {
      const n=nodes[i];nodes.push(...n.children);if(!n.move)continue;
      const ring=n.navTreeIcon?.querySelector('circle[fill="none"]');if(!ring)continue;
      const stone=n.navTreeIcon.querySelector(n.move.color===-1?'.besogo-svg-blackStone':'.besogo-svg-whiteStone');
      check(!!stone,'Native tree stone agrees with the transformed move color');
      if(n.move.color!==solver&&!n.localEdit){
        check(getComputedStyle(ring).stroke===rgb(n.move.color),'Opponent tree ring matches its displayed stone');replyCount++;
      }else{check(!n.navTreeIcon.dataset.zenReply&&getComputedStyle(ring).stroke===nativeColor[ring.getAttribute('stroke')],'Solver tree outcome color remains native');solverCount++;}
    }
    check(replyCount>0&&solverCount>0,`Both roles checked with ${solver===-1?'Black':'White'} to play`);
    const first=root.children.find(n=>n.children.length);e.setCurrent(first);await pause();markers();
    e.setCurrent(root); await pause();
    const r=first.navTreeMarker.getBoundingClientRect();
    first.navTreeMarker.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:r.x+r.width/2,clientY:r.y+r.height/2}));await pause();
    check(e.getCurrent()===first,'Native tree click mapping remains intact');
    button('.zen-forward').click();await pause();check(e.getCurrent().parent===first,'Review Forward uses the native tree');markers();
    button('.zen-rewind').click();await pause();check(e.getCurrent()===first,'Review Back restores reply markers');markers();
    if(root.children.length>1){button('.zen-branch-down').click();await pause();check(e.getCurrent()!==first&&e.getCurrent().parent===root,'Sibling navigation changes the native branch');markers();button('.zen-branch-up').click();await pause();check(e.getCurrent()===first,'Previous sibling restores the branch');}
    // Exercise the site's own blue hover/local cue without interpreting it as
    // an opponent move, even when it is at a real reply's intersection.
    const reply=first.children[0].move;e.displayHoverCoordAt(reply.x,reply.y);await pause();
    check([...document.querySelectorAll('#nextMoveGroup circle[fill="blue"]')].some(n=>getComputedStyle(n).fill==='rgb(0, 0, 255)'&&!n.dataset.zenReply),'Native blue hover/local cue is preserved');
    e.displayHoverCoordAt(-1,-1);await pause();markers();
    const rotation=besogo.makeTransformation(); rotation.rotateClockwise=true;
    e.applyTransformation(rotation);await pause();markers();
    check(e.getCurrent()===first,'Rotation retains the selected branch and marker mapping');
    for(let i=0;i<3;i++)e.applyTransformation(rotation);await pause();markers();
  }
  if(e.isColorInverted()!==inverted)invert();e.setCurrent(original);await pause();
  check(e.isColorInverted()===inverted&&e.getCurrent()===original,'Color checks restore original displayed colors and Review position');
  return {checks};
}
