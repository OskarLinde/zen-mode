// Test-only document-start measurements against native coordinate presentation.
function observeCoordinateTransition() {
  let previous;try{previous=JSON.parse(sessionStorage.getItem('zen-mode-handoff-v1'))?.frame || JSON.parse(sessionStorage.getItem('zen-coordinate-test-expected'))}catch{}
  window.__zenCoordinateTrace={previous,frames:[],errors:[]};
  function nativeLabels() {
    const svg=document.querySelector('.besogo-board > svg'),grid=svg?.querySelector('rect.besogo-svg-lines');
    if(!grid||!window.besogo?.editor)return [];
    const size=besogo.editor.getRoot().getSize(),step=+grid.getAttribute('width')/(size.x-1);
    return [...svg.children].filter(n=>n.tagName.toLowerCase()==='text'&&!n.children.length).map(n=>{
      const style=getComputedStyle(n);return {x:(+n.getAttribute('x')-+grid.getAttribute('x'))/step,
        y:(+n.getAttribute('y')-+grid.getAttribute('y'))/step,text:n.textContent,
        size:parseFloat(style.fontSize)/step,dy:(n.dy.baseVal[0]?.value||0)/step,
        fill:style.fill,font:style.fontFamily,weight:style.fontWeight,anchor:style.textAnchor};
    }).filter(l=>(l.x<=-.5||l.x>=size.x-.5||l.y<=-.5||l.y>=size.y-.5));
  }
  window.__zenNativeLabels=nativeLabels;
  // Host instrumentation fallback if extension document-start consumed its record
  // before the test script ran. It contains only independently measured old labels.
  window.__zenSaveCoordinateExpectation=()=>{
    const svg=document.querySelector('.besogo-board > svg'),g=svg.querySelector('rect.besogo-svg-lines'),n=besogo.editor.getRoot().getSize();
    sessionStorage.setItem('zen-coordinate-test-expected',JSON.stringify({size:[n.x,n.y],
      grid:[0,0,+g.getAttribute('width')/(n.x-1)*svg.getScreenCTM().a],coordinates:nativeLabels()}));
  };
  // Natural tatami is a pure function of the interpolated grid on the handoff
  // layer and on the fixed region above the wood.
  function matError(layer,pseudo) {
    const style=getComputedStyle(layer,pseudo);if(!style.backgroundImage.includes('tatami.png'))return null;
    const value=key=>parseFloat(layer.style.getPropertyValue('--zen-'+key)),step=value('grid-step'),width=step*17*14/22,height=width*1138/1086;
    const span=value('grid-span')-step,size=style.backgroundSize.split(',').at(-1).trim().split(' ').map(parseFloat);
    const origin=style.backgroundPosition.split(',').at(-1).trim().split(' ').map(parseFloat);
    return Math.max(Math.abs(size[0]-width),Math.abs(size[1]-height),
      Math.abs(origin[0]-value('grid-x')-(span-width)/2),Math.abs(origin[1]-value('grid-y')-(span-height)/2));
  }
  function tick() {
    const phase=document.documentElement?.dataset.zenHandoff,layer=document.querySelector('.zen-mode-handoff');
    if(['moving','settling','building'].includes(phase)&&layer&&previous) {
      const trace=__zenCoordinateTrace,svg=layer.querySelector('svg'),grid=svg.querySelector('rect');
      const step=+grid.getAttribute('width')/(previous.size[0]-1);
      const groups=[...layer.querySelectorAll('.zen-handoff-coordinates')],next=nativeLabels();
      const old=previous.coordinates||[],same=JSON.stringify(old)===JSON.stringify(next);
      const expected=same?[old]:[old,next];let visible=0,error=0;
      if(groups.length!==expected.length)trace.errors.push('Coordinate layer count differs from native presentations');
      groups.forEach((group,index)=>{
        const labels=expected[index]||[];
        if(group.children.length!==labels.length)trace.errors.push('Coordinate count differs');
        [...group.children].forEach((text,i)=>{
          const label=labels[i];if(!label)return;
          const actual=[(+text.getAttribute('x')-+grid.getAttribute('x'))/step,(+text.getAttribute('y')-+grid.getAttribute('y'))/step,+text.getAttribute('dy')/step,+text.getAttribute('font-size')/step];
          const wanted=[label.x,label.y,label.dy,label.size];error=Math.max(error,...actual.map((v,j)=>Math.abs(v-wanted[j])));
          if(text.textContent!==label.text||getComputedStyle(text).fill!==label.fill||getComputedStyle(text).fontFamily!==label.font||getComputedStyle(text).textAnchor!==label.anchor)trace.errors.push('Native coordinate text/style differs');
          const r=text.getBoundingClientRect();if(r.right>0&&r.left<innerWidth&&r.bottom>0&&r.top<document.querySelector('.zen-toolbar').getBoundingClientRect().top)visible++;
        });
      });
      if(error>1e-6)trace.errors.push('Coordinate/grid registration differs');
      const mat=matError(layer),edge=matError(layer,'::before');
      if(mat>.01||edge>.01)trace.errors.push('Tatami scale/origin differs from the moving grid');
      trace.frames.push({phase,step,labels:groups.reduce((n,g)=>n+g.children.length,0),visible,error,mat,edge});
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}
