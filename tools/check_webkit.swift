import Cocoa
import WebKit
import CoreGraphics

class TestTab: NSObject, WKWebExtensionTab {
 var web: WKWebView!
 func webView(for context: WKWebExtensionContext) -> WKWebView? { web }
 func url(for context: WKWebExtensionContext) -> URL? { web.url }
 func isSelected(for context: WKWebExtensionContext) -> Bool { true }
}
@MainActor class CheckApp: NSObject, NSApplicationDelegate, WKNavigationDelegate {
 var window:NSWindow!, web:WKWebView!, controller:WKWebExtensionController!
 let tab=TestTab(), output=URL(fileURLWithPath:CommandLine.arguments[2])
 var finished=false, monitor:Task<Void,Never>?, expectedBackground=false
 var checks=[String](), samples=[[String:Any]]()
 var navigationError:String?
 let reloadOnly=CommandLine.arguments.contains("--reload-only")
 let reviewStateOnly=CommandLine.arguments.contains("--review-state-only")
 let turnOnly=CommandLine.arguments.contains("--turn-only")
 let commentsOnly=CommandLine.arguments.contains("--comments-only")
 let coordinatesOnly=CommandLine.arguments.contains("--coordinates-only")
 let defaultsOnly=CommandLine.arguments.contains("--defaults-only")
 let layoutOnly=CommandLine.arguments.contains("--layout-only")
 let noticesOnly=CommandLine.arguments.contains("--notices-only")
 let keyboardOnly=CommandLine.arguments.contains("--keys-only")
 let resetOnly=CommandLine.arguments.contains("--reset-only")
 let tapsOnly=CommandLine.arguments.contains("--taps-only")
 let nextOnly=CommandLine.arguments.contains("--next-only")
 func webView(_ webView:WKWebView,didFailProvisionalNavigation navigation:WKNavigation!,withError error:Error) {navigationError=String(describing:error)}
 func webView(_ webView:WKWebView,didStartProvisionalNavigation navigation:WKNavigation!) {navigationError=nil}
 func locked() -> Bool { (CGSessionCopyCurrentDictionary() as? [String:Any])?["CGSSessionScreenIsLocked"] as? Bool == true }
 func nativeState() -> [String:Any] {
  ["locked":locked(),"active":NSApp.isActive,"visible":window?.isVisible ?? false,
   "key":window?.isKeyWindow ?? false,"occluded":!(window?.occlusionState.contains(.visible) ?? false)]
 }
 func nativeReady() -> Bool {
  !locked() && NSApp.isActive && window.isVisible && window.isKeyWindow && window.occlusionState.contains(.visible)
 }
 func finish(_ status:String,_ reason:String) {
  guard !finished else{return};finished=true;monitor?.cancel()
  let result:[String:Any]=["status":status,"reason":reason,"checks":checks,"samples":samples,"native":nativeState()]
  if let data=try? JSONSerialization.data(withJSONObject:result,options:[.prettyPrinted,.sortedKeys]) {
   try? data.write(to:output.appendingPathComponent("result.json"))
  }
  print(status,reason);fflush(stdout);NSApp.terminate(nil)
 }
 func bringForward() {
  window.makeKeyAndOrderFront(nil);NSApp.activate(ignoringOtherApps:true);window.makeFirstResponder(web)
 }
 func evaluate(_ js:String) async throws -> Any? { try await web.evaluateJavaScript(js) }
 func evaluateAsync(_ js:String) async throws -> Any {
  try await withCheckedThrowingContinuation { continuation in
   web.callAsyncJavaScript(js,arguments:[:],in:nil,in:.page) { result in continuation.resume(with:result) }
  }
 }
 func ready(_ condition:String, label:String, seconds:Double=18) async throws {
  let deadline=Date().addingTimeInterval(seconds)
  while Date()<deadline {
   if let value=try? await evaluate("Boolean(\(condition))"), value as? Bool == true {return}
   try await Task.sleep(for:.milliseconds(100))
  }
  throw NSError(domain:"ZenCheck",code:1,userInfo:[NSLocalizedDescriptionKey:navigationError.map {"ENVIRONMENT: \(label): \($0)"} ?? label])
 }
 func visibleFrames(_ label:String) async throws {
  let deadline=Date().addingTimeInterval(5)
  while !nativeReady() && Date()<deadline {try await Task.sleep(for:.milliseconds(100))}
  guard nativeReady() else {throw NSError(domain:"Environment",code:2,userInfo:[NSLocalizedDescriptionKey:"ENVIRONMENT: foreground window unavailable at \(label)"])}
  let start=(try? await evaluate("window.__zenProbe?.frames || 0")) as? Int ?? 0
  try await ready("document.visibilityState==='visible' && document.hasFocus() && window.__zenProbe.frames>=\(start+3) && performance.now()-__zenProbe.lastFrame<500",label:"ENVIRONMENT: visible frames unavailable at \(label)",seconds:3)
  if let s=try? await evaluate("JSON.stringify({label:\"\(label)\",visibility:document.visibilityState,focus:document.hasFocus(),frames:__zenProbe.frames,lastFrameAge:performance.now()-__zenProbe.lastFrame,visibilityChanges:__zenProbe.visibilityChanges})"),let text=s as? String {
   samples.append(["native":nativeState(),"page":text])
  }
 }
 func arrow(_ step:[String:Any]) throws {
  guard nativeReady(),let key=step["key"] as? String else {throw NSError(domain:"Environment",code:2,userInfo:[NSLocalizedDescriptionKey:"ENVIRONMENT: foreground unavailable for native key"])}
  let code:[String:UInt16]=["ArrowLeft":123,"ArrowRight":124,"ArrowDown":125,"ArrowUp":126,"Enter":36," ":49,"Escape":53]
  let scalar:[String:UInt32]=["ArrowLeft":0xF702,"ArrowRight":0xF703,"ArrowDown":0xF701,"ArrowUp":0xF700,"Enter":13," ":32,"Escape":27]
  let modifiers:[String:NSEvent.ModifierFlags]=["alt":.option,"control":.control,"meta":.command,"shift":.shift]
  let characters=String(UnicodeScalar(scalar[key]!)!)
  for type in [NSEvent.EventType.keyDown,.keyUp] {
   guard let event=NSEvent.keyEvent(with:type,location:.zero,modifierFlags:modifiers[step["modifier"] as? String ?? ""] ?? [],timestamp:ProcessInfo.processInfo.systemUptime,windowNumber:window.windowNumber,context:nil,characters:characters,charactersIgnoringModifiers:characters,isARepeat:step["repeat"] as? Bool ?? false,keyCode:code[key]!) else {throw NSError(domain:"KeyEvent",code:1)}
   NSApp.sendEvent(event)
  }
 }
 func pointer(_ type:NSEvent.EventType,x:Double,y:Double) throws {
  guard nativeReady() else {throw NSError(domain:"Environment",code:2,userInfo:[NSLocalizedDescriptionKey:"ENVIRONMENT: foreground unavailable for pointer"])}
  let point=web.convert(NSPoint(x:x,y:web.isFlipped ? y:web.bounds.height-y),to:nil)
  guard let event=NSEvent.mouseEvent(with:type,location:point,modifierFlags:[],timestamp:ProcessInfo.processInfo.systemUptime,windowNumber:window.windowNumber,context:nil,eventNumber:0,clickCount:1,pressure:type == .leftMouseUp ? 0 : 1) else {throw NSError(domain:"PointerEvent",code:1)}
  NSApp.sendEvent(event)
 }
 func nativeArrowNavigation() async throws {
    _ = try await evaluate("document.querySelector('.zen-review').click()")
    try await ready("!besogo.editor.getReviewMode() && !document.querySelector('.zen-review').hasAttribute('aria-busy')",label:"Exit Review did not finish")
    checks.append("Exit Review clears busy state")
    _ = try await evaluate("document.activeElement?.blur()")
    try arrow(["key":"ArrowRight"])
    try await ready("location.pathname==='/5194' && !!window.besogo?.editor && !!document.querySelector('.zen-next') && !document.documentElement.dataset.zenPreparing",label:"Native Next did not become ready")
    try await visibleFrames("next-ready");checks.append("Outside Review: native Right reaches visible problem 5194")
    _ = try await evaluate("document.activeElement?.blur()")
    try arrow(["key":"ArrowLeft"])
    try await ready("location.pathname==='/5193' && !!window.besogo?.editor && !!document.querySelector('.zen-next')",label:"Native Back did not restore problem")
    try await visibleFrames("back-ready");checks.append("Outside Review: native Left reaches visible previous problem 5193")
    web.goBack()
    try await ready("location.pathname==='/5194' && !!window.besogo?.editor",label:"Browser Back after native arrows")
    try await visibleFrames("history-back-ready");checks.append("Browser Back retains normal history after arrow navigation")
    try await snapshot("webkit-restored")
 }
 func snapshot(_ name:String) async throws {
  let image=try await web.takeSnapshot(configuration:nil)
  if let data=image.tiffRepresentation,let rep=NSBitmapImageRep(data:data),let png=rep.representation(using:.png,properties:[:]) {try png.write(to:output.appendingPathComponent(name+".png"))}
 }
 func applicationDidFinishLaunching(_ note:Notification) {
  // A locked display cannot validate visible rendering. Do not navigate, run
  // product assertions, force visibility flags or change the user's lock state.
  if locked() {finish("environment-blocked","The graphical session is locked; visible WebKit rendering is unavailable.");return}
  Task { @MainActor in
   try? await Task.sleep(for:.seconds(90))
   if !finished {finish(locked() ? "environment-blocked" : "failed","Host verification exceeded its 90-second bound")}
  }
  Task { @MainActor in
   do {
    let ext=try await WKWebExtension(resourceBaseURL:URL(fileURLWithPath:CommandLine.arguments[1]))
    controller=WKWebExtensionController(configuration:.nonPersistent())
    let context=WKWebExtensionContext(for:ext);context.hasAccessToPrivateData=true
    context.setPermissionStatus(.grantedExplicitly,for:try WKWebExtension.MatchPattern(string:"https://tsumego.com/*"))
    context.setPermissionStatus(.grantedExplicitly,for:WKWebExtension.Permission(rawValue:"storage"));try controller.load(context)
    let config=WKWebViewConfiguration();config.websiteDataStore = .nonPersistent();config.webExtensionController=controller
    let probe="""
    window.__zenProbe={frames:0,lastFrame:0,errors:[],visibilityChanges:[]};
    function zenProbeFrame(t){__zenProbe.frames++;__zenProbe.lastFrame=t;requestAnimationFrame(zenProbeFrame)}requestAnimationFrame(zenProbeFrame);
    addEventListener('visibilitychange',()=>__zenProbe.visibilityChanges.push(document.visibilityState));
    addEventListener('error',e=>{if(e.message)__zenProbe.errors.push(e.message)});
    """
    config.userContentController.addUserScript(WKUserScript(source:probe,injectionTime:.atDocumentStart,forMainFrameOnly:true))
    if defaultsOnly {
     let script=try String(contentsOfFile:URL(fileURLWithPath:CommandLine.arguments[3]).deletingLastPathComponent().appendingPathComponent("preferences-check.js").path,encoding:.utf8)
     config.userContentController.addUserScript(WKUserScript(source:script+";observePreferencePaint()",injectionTime:.atDocumentStart,forMainFrameOnly:true))
    }
    if commentsOnly {
     let script=try String(contentsOfFile:URL(fileURLWithPath:CommandLine.arguments[3]).deletingLastPathComponent().appendingPathComponent("review-state-check.js").path,encoding:.utf8)
     config.userContentController.addUserScript(WKUserScript(source:script+";observeReviewState([\"/6490\",\"/12730\"])",injectionTime:.atDocumentStart,forMainFrameOnly:true))
    }
    if resetOnly || tapsOnly {
     let script=try String(contentsOfFile:URL(fileURLWithPath:CommandLine.arguments[3]).deletingLastPathComponent().appendingPathComponent("turn-check.js").path,encoding:.utf8)
     config.userContentController.addUserScript(WKUserScript(source:script+";observeTurn([])",injectionTime:.atDocumentStart,forMainFrameOnly:true))
    }
    if nextOnly {
     let script=try String(contentsOfFile:URL(fileURLWithPath:CommandLine.arguments[3]).deletingLastPathComponent().appendingPathComponent("next-check.js").path,encoding:.utf8)
     config.userContentController.addUserScript(WKUserScript(source:script+";observeNext()",injectionTime:.atDocumentStart,forMainFrameOnly:true))
    }
    if turnOnly {
     let script=try String(contentsOfFile:URL(fileURLWithPath:CommandLine.arguments[3]).deletingLastPathComponent().appendingPathComponent("turn-check.js").path,encoding:.utf8)
     config.userContentController.addUserScript(WKUserScript(source:script+";observeTurn([\"/5193\"])",injectionTime:.atDocumentStart,forMainFrameOnly:true))
    }
    if reviewStateOnly {
     let script=try String(contentsOfFile:URL(fileURLWithPath:CommandLine.arguments[3]).deletingLastPathComponent().appendingPathComponent("review-state-check.js").path,encoding:.utf8)
     config.userContentController.addUserScript(WKUserScript(source:script+";observeReviewState([\"/5194\"])",injectionTime:.atDocumentStart,forMainFrameOnly:true))
    }
    if reloadOnly {
     let script=try String(contentsOfFile:URL(fileURLWithPath:CommandLine.arguments[3]).deletingLastPathComponent().appendingPathComponent("reload-shadow-check.js").path,encoding:.utf8)
     config.userContentController.addUserScript(WKUserScript(source:script+";observeReloadShadows()",injectionTime:.atDocumentStart,forMainFrameOnly:true))
    }
    if coordinatesOnly {
     let script=try String(contentsOfFile:URL(fileURLWithPath:CommandLine.arguments[3]).deletingLastPathComponent().appendingPathComponent("coordinate-transition-check.js").path,encoding:.utf8)
     config.userContentController.addUserScript(WKUserScript(source:script+";observeCoordinateTransition()",injectionTime:.atDocumentStart,forMainFrameOnly:true))
    }
    guard let screen=NSScreen.main?.visibleFrame else {finish("environment-blocked","No graphical display");return}
    let width=min(layoutOnly ? 1440 : 1180,screen.width-40),height=min(layoutOnly ? 1000 : 820,screen.height-80)
    window=NSWindow(contentRect:NSRect(x:screen.midX-width/2,y:screen.midY-height/2,width:width,height:height),styleMask:[.titled,.closable,.resizable],backing:.buffered,defer:false)
    window.isReleasedWhenClosed=false
    window.title="Zen Mode — isolated WebKit verification"
    web=WKWebView(frame:NSRect(x:0,y:0,width:width,height:height),configuration:config);web.autoresizingMask=[.width,.height]
    web.navigationDelegate=self
    let container=NSView(frame:web.frame);container.addSubview(web);window.contentView=container;tab.web=web;controller.didOpenTab(tab);controller.didActivateTab(tab,previousActiveTab:nil);bringForward()
    web.loadHTMLString("<!doctype html><title>Zen Mode render preflight</title><p>Checking visible rendering…</p>",baseURL:nil)
    // Launch Services may activate before the asynchronous extension/window
    // setup finishes. Let the launcher activate this now-existing window once.
    try Data().write(to:output.appendingPathComponent("window-ready"))
    try await visibleFrames("preflight")
    monitor=Task { @MainActor in
     while !Task.isCancelled && !finished {
      try? await Task.sleep(for:.milliseconds(200))
      if !expectedBackground && !nativeReady() {finish("environment-blocked","Foreground window lost during product checks");return}
     }
    }
    let presentation=try String(contentsOfFile:URL(fileURLWithPath:CommandLine.arguments[3]).deletingLastPathComponent().appendingPathComponent("presentation-check.js").path,encoding:.utf8)
    if !keyboardOnly && !noticesOnly && !layoutOnly && !defaultsOnly && !coordinatesOnly && !reloadOnly && !reviewStateOnly && !turnOnly && !commentsOnly && !resetOnly && !tapsOnly && !nextOnly, CommandLine.arguments.count > 4, let fixture=URL(string:CommandLine.arguments[4]) {
     web.load(URLRequest(url:fixture))
     try await ready("!!window.besogo?.editor && !!document.querySelector('.zen-next') && !document.documentElement.dataset.zenPreparing",label:"Authored edge fixture not ready")
     _ = try await evaluate(presentation)
     _ = try await evaluateAsync("return await preparePresentationCheck();")
     for (w,h,reach) in [(900.0,600.0,false),(440.0,min(956.0,screen.height-80),true)] {
      window.setContentSize(NSSize(width:w,height:h))
      window.setFrameOrigin(NSPoint(x:screen.midX-window.frame.width/2,y:screen.midY-window.frame.height/2))
      try await visibleFrames("authored-edge-resize")
      for coordinates in [false,true] {for margin in ["off","on"] {
       if let outcome=try await evaluateAsync("return await checkPresentationCase('site',\(coordinates),\(reach),'\(margin)');") as? [String:Any] {checks += outcome["checks"] as? [String] ?? []}
       if w == 900 {
        guard try await evaluate("(()=>{const e=checkFiniteBoardEdges();return e.view[1]>0 && e.mat===0 && e.inset[0]===0})()") as? Bool == true else {throw NSError(domain:"ZenCheck",code:1,userInfo:[NSLocalizedDescriptionKey:"Authored interior crop painted a false top edge"])}
        checks.append("Authored interior crop paints no top mat or rim")
       }
       if coordinates && margin == "on" {try await snapshot("authored-edge-\(Int(w))")}
      }}
     }
    }
    web.load(URLRequest(url:URL(string:"https://tsumego.com/5193")!))
    try await ready("location.hostname==='tsumego.com' && location.pathname==='/5193' && !!window.besogo?.editor?.getRoot()?.children?.length && !!document.querySelector('.zen-resume') && !document.documentElement.dataset.zenPreparing",label:"Site or extension startup did not become ready")
    try await visibleFrames("before-review")
    if commentsOnly {
     let check=try String(contentsOfFile:URL(fileURLWithPath:CommandLine.arguments[3]).deletingLastPathComponent().appendingPathComponent("comment-check.js").path,encoding:.utf8)
     for (path,frameWidth) in [("/6490",width),("/12730",min(390,width))] {
      let tall=frameWidth<width ? min(780,height) : height
      web.frame=NSRect(x:0,y:height-tall,width:frameWidth,height:tall);try await Task.sleep(for:.milliseconds(300))
      let origin=try await evaluate("performance.timeOrigin") as? Double ?? 0
      web.load(URLRequest(url:URL(string:"https://tsumego.com\(path)")!))
      try await ready("performance.timeOrigin!==\(origin) && location.pathname==='\(path)' && !!window.besogo?.editor && document.documentElement.dataset.zenReady==='on' && !document.documentElement.dataset.zenPreparing && !document.documentElement.dataset.zenHandoff",label:"\(path) did not settle")
      try await Task.sleep(for:.milliseconds(500));try await visibleFrames("comment")
      _ = try await evaluate(check+";window.__zenNoRealKeys=true;1")
      if let flow=try await evaluateAsync("const run=checkReviewComment();for(;;){const step=await run.next();if(step.done)return step.value}") as? [String] { checks += flow.map {"\(path) at \(Int(frameWidth)): "+$0} }
      try await snapshot("comment-\(Int(frameWidth))")
     }
     finish("passed","Problem comments in Review on real pages in foreground WebKit, without real key events; not Safari.app/device.");return
    }
    if resetOnly || tapsOnly || nextOnly {
     let portrait=min(390,width), tall=min(780,height)
     web.frame=NSRect(x:0,y:height-tall,width:portrait,height:tall);try await Task.sleep(for:.milliseconds(300))
     let extra=try String(contentsOfFile:URL(fileURLWithPath:CommandLine.arguments[3]).deletingLastPathComponent().appendingPathComponent("webkit-extra-check.js").path,encoding:.utf8)
     let settled="!!window.besogo?.editor && document.documentElement.dataset.zenReady==='on' && !document.documentElement.dataset.zenPreparing && !document.documentElement.dataset.zenHandoff"
     @MainActor func open(_ path:String) async throws {
      let origin=try await evaluate("performance.timeOrigin") as? Double ?? 0
      web.load(URLRequest(url:URL(string:"https://tsumego.com\(path)")!))
      try await ready("performance.timeOrigin!==\(origin) && location.pathname==='\(path)' && \(settled)",label:"\(path) not ready")
      try await Task.sleep(for:.milliseconds(500));try await ready(settled,label:"\(path) motion finished")
      try await visibleFrames(path);_ = try await evaluate(extra+";1")
     }
     @MainActor func click(_ js:String) async throws {
      guard let p=try await evaluate(js) as? [Double], p.count==2 else {throw NSError(domain:"Extra",code:1,userInfo:[NSLocalizedDescriptionKey:"No point from \(js)"])}
      try pointer(.leftMouseDown,x:p[0],y:p[1]);try await Task.sleep(for:.milliseconds(60));try pointer(.leftMouseUp,x:p[0],y:p[1])
     }
     @MainActor func expect(_ js:String,_ message:String) async throws {
      guard try await evaluate(js) as? Bool == true else {throw NSError(domain:"Extra",code:2,userInfo:[NSLocalizedDescriptionKey:message])}
      checks.append(message)
     }
     let firstMove="(()=>{const m=besogo.editor.getRoot().children[0].move,p=__zenPointFor(m.x,m.y);return [p.x,p.y]})()"
     let onFirstMove="(()=>{const m=besogo.editor.getRoot().children[0].move;let n=besogo.editor.getCurrent();while(n&&n.parent&&n.parent.parent)n=n.parent;return !!n?.move&&n.move.x===m.x&&n.move.y===m.y})()"
     let resetButton="(()=>{const r=document.querySelector('.zen-reset').getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2]})()"
     if resetOnly {
      for path in ["/6077","/5193"] {
       try await open(path)
       if let r=try await evaluateAsync("return await checkShowDifferently(10);") as? [String:Any] {
        checks += (r["checks"] as? [String] ?? []).map {"\(path): "+$0};checks.append("\(path): \(r["seen"] ?? 0) presentations in 11 views")
       }
       try await snapshot("reset-\(path.dropFirst())")
       let shown=try await evaluate("JSON.stringify(besogo.editor.getTransformationFromSgf())") as? String ?? ""
       try await click(firstMove);try await Task.sleep(for:.milliseconds(700))
       try await expect(onFirstMove+"&&document.querySelector('.zen-reset').getAttribute('aria-label')==='Reset problem'","\(path): a real click lands on the first move, and Reset is the site's again")
       try await click(resetButton);try await Task.sleep(for:.milliseconds(900))
       try await expect("besogo.editor.getCurrent()===besogo.editor.getRoot()&&JSON.stringify(besogo.editor.getTransformationFromSgf())==='\(shown)'&&document.querySelector('.zen-reset').getAttribute('aria-label')==='Show differently'","\(path): a real Reset returns to the start in the same presentation, then shows differently again")
      }
      _ = try await evaluateAsync("return await checkShowDifferently(3);")
      _ = try await evaluate("window.__zenProbe={lastFrame:performance.now()};requestAnimationFrame(function tick(){__zenProbe.lastFrame=performance.now();requestAnimationFrame(tick)});1")
      _ = try await evaluate(String(contentsOfFile:CommandLine.arguments[3],encoding:.utf8))
      if let result=try await evaluateAsync("return await checkVisibleReview({playOnly:true});") as? [String:Any], let flow=result["checks"] as? [String] { checks += flow.map {"After Show differently: "+$0} }
      try await snapshot("reset-solved")
      finish("passed","Show differently, real clicks, native Reset and the play flow in foreground WebKit at a phone-sized frame; not Safari.app/device.");return
     }
     if tapsOnly {
      try await open("/5193")
      let option="(v=>{const s=document.querySelector('select[aria-label=\"Show taps (for recording)\"]');s.value=v;s.dispatchEvent(new Event('change'));return 1})"
      _ = try await evaluate(option+"('on')");try await Task.sleep(for:.milliseconds(300))
      let x=Double(portrait)/2, y=34.0
      try pointer(.leftMouseDown,x:x,y:y);try await Task.sleep(for:.milliseconds(90))
      try await expect("(()=>{const r=document.querySelector('.zen-taps .zen-tap:not(.zen-tap-end)');if(!r)return false;const b=r.getBoundingClientRect();return Math.hypot(b.x+b.width/2-\(x),b.y+b.height/2-\(y))<6})()","A real press draws a ring centred on the pointer")
      try pointer(.leftMouseUp,x:x,y:y);try await Task.sleep(for:.milliseconds(700))
      try await expect("!document.querySelector('.zen-taps .zen-tap:not(.zen-tap-end)')","The ring fades after the press")
      try await click(firstMove);try await Task.sleep(for:.milliseconds(700))
      try await expect(onFirstMove,"With Show taps on, a real click still plays on the intersection shown")
      try await snapshot("taps-on")
      _ = try await evaluate(option+"('off')");try await Task.sleep(for:.milliseconds(300))
      try pointer(.leftMouseDown,x:x,y:y);try await Task.sleep(for:.milliseconds(90))
      try await expect("!document.querySelector('.zen-taps .zen-tap')","With Show taps off, no ring")
      try pointer(.leftMouseUp,x:x,y:y)
      finish("passed","Show taps with real mouse presses in foreground WebKit; not touch, Safari.app or a device.");return
     }
     if nextOnly {
      try await open("/5193")
      var shown=0
      for press in 1...4 {
       let from=try await evaluate("location.pathname") as? String ?? ""
       try await click("(()=>{const r=document.querySelector('.zen-next').getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2]})()")
       try await ready("location.pathname!=='\(from)' && \(settled)",label:"Next \(press) did not arrive",seconds:20)
       try await Task.sleep(for:.milliseconds(400))
       guard let log=try await evaluate("(()=>{const log=JSON.parse(sessionStorage.getItem('zen-next-log')||'[]');sessionStorage.removeItem('zen-next-log');const early=log.filter(e=>e.at<180),late=log.filter(e=>e.at>=280);return JSON.stringify({n:log.length,last:log.at(-1)?.at||0,earlyBusy:early.some(e=>e.busy==='true'),lateBusy:late.length?late.every(e=>e.busy==='true'):null,boxes:new Set(log.map(e=>e.box)).size})})()") as? String,
             let data=log.data(using:.utf8), let entry=try JSONSerialization.jsonObject(with:data) as? [String:Any] else {throw NSError(domain:"Next",code:1,userInfo:[NSLocalizedDescriptionKey:"No log for Next \(press)"])}
       samples.append(["next":entry])
       guard (entry["n"] as? Int ?? 0) > 0, entry["earlyBusy"] as? Bool == false, entry["boxes"] as? Int == 1 else {throw NSError(domain:"Next",code:2,userInfo:[NSLocalizedDescriptionKey:"Next \(press): \(log)"])}
       if let late=entry["lateBusy"] as? Bool {guard late else {throw NSError(domain:"Next",code:3,userInfo:[NSLocalizedDescriptionKey:"Next \(press) waited without a spinner: \(log)"])};shown+=1}
       checks.append("Next \(press): nothing before 0.2 s, the button keeps its size\((entry["lateBusy"] as? Bool) == true ? ", and the spinner showed while the site was slow" : ", and the site answered before a spinner was due")")
      }
      checks.append("The spinner showed on \(shown) of 4 presses, at the live server's own speed")
      finish("passed","Next spinner with real mouse presses at the live server's speed in foreground WebKit; no latency control, not Safari.app/device.");return
     }
    }
    if turnOnly {
     let portrait=min(390,width), tall=min(780,height)
     web.frame=NSRect(x:0,y:height-tall,width:portrait,height:tall);try await Task.sleep(for:.milliseconds(300))
     let origin=try await evaluate("performance.timeOrigin") as? Double ?? 0
     web.load(URLRequest(url:URL(string:"https://tsumego.com/5193")!))
     try await ready("performance.timeOrigin!==\(origin) && location.pathname==='/5193' && !!window.besogo?.editor && document.documentElement.dataset.zenReady==='on' && !document.documentElement.dataset.zenPreparing && !document.documentElement.dataset.zenHandoff",label:"Reload at phone width did not settle")
     try await Task.sleep(for:.milliseconds(400));try await visibleFrames("turned")
     guard try await evaluate("__zenTurnState().native!==__zenNativeTurn && __zenTurnTrace.views.length===1") as? Bool == true else {throw NSError(domain:"Turn",code:1,userInfo:[NSLocalizedDescriptionKey:"Problem did not turn before first visible frame"])}
     checks.append("Wide problem turned before the first visible frame");try await snapshot("turned-390")
     // The site draws the placement. End on the left one, so the play flow runs there.
     var sides=Set<String>()
     for _ in 0..<16 {
      let previous=try await evaluate("performance.timeOrigin") as? Double ?? 0
      web.load(URLRequest(url:URL(string:"https://tsumego.com/5193")!))
      try await ready("performance.timeOrigin!==\(previous) && location.pathname==='/5193' && !!window.besogo?.editor && document.documentElement.dataset.zenReady==='on' && !document.documentElement.dataset.zenPreparing && !document.documentElement.dataset.zenHandoff",label:"Reload for placement")
      // The reload motion can start just after the first ready, and its cover takes taps.
      try await Task.sleep(for:.milliseconds(400));try await ready("document.documentElement.dataset.zenReady==='on' && !document.documentElement.dataset.zenPreparing && !document.documentElement.dataset.zenHandoff",label:"Reload motion finished")
      try await visibleFrames("placement")
      let side=try await evaluate("(()=>{const p=__zenPlacement(),left=p.corner==='bottom-left';return p.rotation===(left?0:3)&&p.side===(left?'left':'right')&&p.edges[0]==='1'&&p.edges[left?3:1]==='1'&&p.edges[left?1:3]==='0'&&!p.under.length&&p.menu.left<60&&p.menu.top<60&&!p.blocked.length&&!p.outside.length?p.side:'failed '+JSON.stringify(p)})()") as? String ?? "failed"
      guard !side.hasPrefix("failed") else {throw NSError(domain:"Turn",code:2,userInfo:[NSLocalizedDescriptionKey:side])}
      if sides.insert(side).inserted {checks.append("Turned \(side): site placement kept, true edges right, nothing playable under a control, ☰ top left and no play under it or the hearts");try await snapshot("turned-\(side)")}
      if sides.count==2 && side=="left" {break}
     }
     guard sides.count==2 else {throw NSError(domain:"Turn",code:3,userInfo:[NSLocalizedDescriptionKey:"Saw only \(sides) across reloads"])}
     // The optional random rotation: run the play flow on a turn the fixed direction never makes.
     _ = try await evaluate("(()=>{const s=document.querySelector('select[aria-label=\"Random ±90° rotation\"]');s.value='on';s.dispatchEvent(new Event('change'));return 1})()")
     try await Task.sleep(for:.milliseconds(300))
     var counterClockwise=false
     for _ in 0..<20 where !counterClockwise {
      let previous=try await evaluate("performance.timeOrigin") as? Double ?? 0
      web.load(URLRequest(url:URL(string:"https://tsumego.com/5193")!))
      try await ready("performance.timeOrigin!==\(previous) && location.pathname==='/5193' && !!window.besogo?.editor && document.documentElement.dataset.zenReady==='on' && !document.documentElement.dataset.zenPreparing && !document.documentElement.dataset.zenHandoff",label:"Reload with the option on")
      try await Task.sleep(for:.milliseconds(400));try await ready("document.documentElement.dataset.zenReady==='on' && !document.documentElement.dataset.zenPreparing && !document.documentElement.dataset.zenHandoff",label:"Reload motion finished")
      counterClockwise=try await evaluate("[1,2].includes(besogo.scaleParameters.rotation)") as? Bool ?? false
     }
     guard counterClockwise else {throw NSError(domain:"Turn",code:4,userInfo:[NSLocalizedDescriptionKey:"No counter-clockwise turn with the option on"])}
     guard try await evaluate("(()=>{const p=__zenPlacement();return !p.blocked.length&&!p.outside.length&&__zenStonesInSgf()===__zenNativeStones&&__zenTurnTrace.views.length===1})()") as? Bool == true else {throw NSError(domain:"Turn",code:5,userInfo:[NSLocalizedDescriptionKey:"Random turn placement differs"])}
     checks.append("Option on: counter-clockwise turn, stones and comment anchors map to the same SGF points, nothing playable under a control");try await snapshot("turned-random")
     _ = try await evaluate("window.__zenProbe={lastFrame:performance.now()};requestAnimationFrame(function tick(){__zenProbe.lastFrame=performance.now();requestAnimationFrame(tick)});1")
     _ = try await evaluate(String(contentsOfFile:CommandLine.arguments[3],encoding:.utf8))
     if let result=try await evaluateAsync("return await checkVisibleReview({playOnly:true});") as? [String:Any], let flow=result["checks"] as? [String] { checks += flow.map {"Turned: "+$0} }
     try await snapshot("turned-solved")
     finish("passed","Turned board through failure, multi-step solve, Review and Regular in foreground WebKit at a phone-sized frame; threshold raised by the test override, not Safari.app/device.");return
    }
    if reviewStateOnly {
     @MainActor func state(_ test:String,_ label:String) async throws {
      guard try await evaluate("(s=>\(test))(__zenReviewState())") as? Bool == true else {throw NSError(domain:"ReviewState",code:1,userInfo:[NSLocalizedDescriptionKey:label])}
      checks.append(label)
     }
     @MainActor func arrived(_ path:String) async throws {
      try await ready("location.pathname==='\(path)' && !!window.besogo?.editor && document.documentElement.dataset.zenReady==='on' && !document.documentElement.dataset.zenPreparing && !document.documentElement.dataset.zenHandoff",label:"Did not reach \(path)")
      try await Task.sleep(for:.milliseconds(300));try await visibleFrames("review-state")
     }
     let mirrored="!__zenReviewTrace.mismatches.length && __zenReviewTrace.frames>0"
     try await state("!s.active && !s.visible","Native disabled at load: Review hidden")
     _ = try await evaluate("window.__bar=__zenReviewState().contextRight;$('#besogo-review-button-inactive').attr('id','besogo-review-button');besogo.editor.setReviewEnabled(true);1")
     try await Task.sleep(for:.milliseconds(200))
     try await state("s.active && s.visible && s.contextRight===window.__bar","Native mid-session enable followed; bottom bar unmoved")
     guard try await evaluate(mirrored) as? Bool == true else {throw NSError(domain:"ReviewState",code:1,userInfo:[NSLocalizedDescriptionKey:"Mismatch before Next"])}
     _ = try await evaluate("document.querySelector('.zen-next').click();1");try await arrived("/5194")
     try await state("s.active && s.visible","Native enabled at load: Review visible before any move")
     guard try await evaluate(mirrored) as? Bool == true else {throw NSError(domain:"ReviewState",code:1,userInfo:[NSLocalizedDescriptionKey:"Mismatch on enabled load"])}
     try await snapshot("review-enabled-load")
     _ = try await evaluate("document.querySelector('.zen-review').click();1");try await ready("besogo.editor.getReviewMode()===true && !document.querySelector('.zen-review').hasAttribute('aria-busy')",label:"Native Review did not open")
     checks.append("Review opens through the native handler")
     _ = try await evaluate("document.querySelector('.zen-review').click();1");try await ready("besogo.editor.getReviewMode()===false",label:"Native Review did not close")
     _ = try await evaluate("document.querySelector('.zen-next').click();1");try await arrived("/5195")
     try await state("!s.active && !s.visible","Next to a native disabled problem: no stale Review")
     web.goBack();try await arrived("/5194")
     try await state("s.active && s.visible","Back to a native enabled problem: Review visible")
     guard try await evaluate(mirrored) as? Bool == true else {throw NSError(domain:"ReviewState",code:1,userInfo:[NSLocalizedDescriptionKey:"Mismatch after Back"])}
     finish("passed","Review mirrors the native button through load, mid-session enable, Next and Back in foreground WebKit; real engine built enabled by test hook, not a signed-in solved page or Safari.app/device.");return
    }
    if reloadOnly {
     var witnessedShadows=false
     for enabled in [true,false] {
      _ = try await evaluate("((enabled)=>{const b=[...document.querySelectorAll('.zen-toolbar button')].find(b=>b.textContent==='Coordinates');if((b.getAttribute('aria-pressed')==='true')!==enabled)b.click();const s=[...document.querySelectorAll('select')].find(s=>s.getAttribute('aria-label')==='Board transition');s.value=enabled?'on':'off';s.dispatchEvent(new Event('change'))})(\(enabled))")
      try await Task.sleep(for:.milliseconds(300));try await visibleFrames("before-reload")
      let hasShadows=try await evaluate("__zenSaveReloadExpected().shadows.length>0") as? Bool == true
      witnessedShadows = witnessedShadows || hasShadows
      let origin=try await evaluate("performance.timeOrigin") as! Double
      try await snapshot("reload-before-\(enabled)");web.reload()
      try await ready("performance.timeOrigin!==\(origin) && !!document.querySelector('.zen-mode-handoff')",label:"No ordinary-reload cover")
      try await visibleFrames("reload-cover");try await snapshot("reload-cover-\(enabled)")
      try await ready("document.documentElement.dataset.zenReady==='on' && !document.documentElement.dataset.zenPreparing && !document.documentElement.dataset.zenHandoff",label:"Reload did not settle")
      try await visibleFrames("reload-settled")
      if let trace=try? await evaluate("JSON.stringify({errors:[...new Set(__zenReloadTrace.errors)],phases:[...new Set(__zenReloadTrace.frames.map(f=>f.phase))],events:__zenReloadTrace.events})") as? String {try? trace.write(to:output.appendingPathComponent("reload-trace-\(enabled).json"),atomically:true,encoding:.utf8)}
      guard try await evaluate("!__zenReloadTrace.errors.length && __zenReloadTrace.frames.some(f=>f.phase==='waiting') && __zenReloadTrace.frames.some(f=>f.phase==='moving')===\(enabled)") as? Bool == true else {throw NSError(domain:"ReloadShadows",code:1,userInfo:[NSLocalizedDescriptionKey:"Native reload shadow presentation or motion differs"])}
      checks.append("Native reload shadows, coordinate state and motion preserved: \(enabled)")
     }
     guard witnessedShadows else {throw NSError(domain:"ReloadCoverage",code:1,userInfo:[NSLocalizedDescriptionKey:"No native shadows exercised"])}
     checks.append("Actual native shadow theme exercised")
     finish("passed","Ordinary native reload shadows/coordinates in foreground WebKit, with Pan and Steady; not Safari.app/device.");return
    }
    if coordinatesOnly {
     for (index,kind) in ["on","rotated-scale","off"].enumerated() {
      _ = try await evaluate("((enabled)=>{const b=[...document.querySelectorAll('.zen-toolbar button')].find(b=>b.textContent==='Coordinates');if((b.getAttribute('aria-pressed')==='true')!==enabled)b.click()})(\(kind != "off"))")
      if kind == "rotated-scale" {_ = try await evaluate("(()=>{const t=besogo.makeTransformation();t.rotateClockwise=true;t.invertColors=true;besogo.editor.applyTransformation(t);[...document.querySelectorAll('.zen-toolbar button')].find(b=>b.textContent==='+').click()})()")}
      try await Task.sleep(for:.milliseconds(150));_ = try await evaluate("__zenSaveCoordinateExpectation();document.querySelector('.zen-next').click()")
      try await ready("location.pathname==='/\(5194+index)' && document.documentElement.dataset.zenHandoff==='moving'",label:"No coordinate moving frame")
      try await visibleFrames("coordinate-moving");try await snapshot("coordinates-moving-\(kind)")
      try await ready("document.documentElement.dataset.zenReady==='on' && !document.documentElement.dataset.zenPreparing && !document.documentElement.dataset.zenHandoff",label:"Coordinate transition did not settle")
      try await visibleFrames("coordinate-settled")
      guard try await evaluate("!__zenCoordinateTrace.errors.length && __zenCoordinateTrace.frames.some(f=>f.phase==='moving') && __zenCoordinateTrace.frames.some(f=>f.phase==='building') && __zenCoordinateTrace.frames.every(f=>\(kind == "off" ? "f.labels===0" : "f.labels>=76"))") as? Bool == true else {throw NSError(domain:"CoordinateCheck",code:1,userInfo:[NSLocalizedDescriptionKey:"Coordinate text/style/grid registration or enabled state differs"])}
      checks.append("Native moving/building coordinates match native labels and grid: \(kind)")
      if kind == "rotated-scale" {
       guard try await evaluate("Math.abs(__zenCoordinateTrace.frames.at(-1).step-__zenCoordinateTrace.previous.grid[2])>1") as? Bool == true else {throw NSError(domain:"CoordinateScale",code:1)}
       checks.append("Rotated/color-swapped departure includes real scale change")
      }
     }
     web.goBack();try await ready("location.pathname==='/5195' && !!window.besogo?.editor && document.documentElement.dataset.zenReady==='on' && !document.documentElement.dataset.zenPreparing && !document.documentElement.dataset.zenHandoff",label:"Coordinate Back did not restore")
     try await visibleFrames("coordinate-back");checks.append("Native Back restores visible board without stale cover")
     finish("passed","Native coordinates remain grid-registered through camera motion/scale, Off and Back in foreground WebKit; not Safari.app/device.");return
    }
    if defaultsOnly {
     _ = try await evaluate("checkPreferencePaint()")
     checks.append("Fresh installed defaults match first visible paint and controls");try await snapshot("defaults-fresh")
     _ = try await evaluate("window.__feedback=checkFeedbackPresentation();true")
     var complete=false;web.autoresizingMask=[]
     for _ in 0..<80 {
      guard let step=try await evaluateAsync("return await __feedback.next();") as? [String:Any],let value=step["value"] as? [String:Any] else {throw NSError(domain:"FeedbackCheck",code:1)}
      if step["done"] as? Bool == true {checks += value["checks"] as? [String] ?? [];complete=true;break}
      try await visibleFrames("feedback-step")
      if let size=value["resize"] as? [Double] {let h=min(size[1],height);web.frame=NSRect(x:0,y:height-h,width:min(size[0],width),height:h);try await visibleFrames("feedback-resize")}
      else if let name=value["screenshot"] as? String {try await snapshot(name)}
      else if let point=value["click"] as? [Double] {try pointer(.leftMouseDown,x:point[0],y:point[1]);try pointer(.leftMouseUp,x:point[0],y:point[1])}
     }
     guard complete else {throw NSError(domain:"FeedbackCheckIncomplete",code:1)}
     _ = try await evaluate("document.querySelector('.zen-next').click()")
     try await ready("location.pathname==='/5194' && document.documentElement.dataset.zenReady==='on' && !document.documentElement.dataset.zenPreparing && !document.documentElement.dataset.zenHandoff && __zenPreferenceTrace.paint.length",label:"Default Next did not settle")
     try await visibleFrames("default-next")
     _ = try await evaluate("checkPreferencePaint()")
     guard try await evaluate("__zenPreferenceTrace.phases.includes('moving') && __zenPreferenceTrace.phases.includes('building')") as? Bool == true else {throw NSError(domain:"DefaultHandoff",code:1,userInfo:[NSLocalizedDescriptionKey:"Default Next did not pan and build"])}
     checks.append("Default Next actually pans/builds and preserves first visible preferences");try await snapshot("defaults-next")
     _ = try await evaluate("(()=>{for(const [label,value] of [['Board appearance','plain'],['Board edge margin','off'],['Board transition','off']]){const s=document.querySelector('select[aria-label=\"'+label+'\"]');s.value=value;s.dispatchEvent(new Event('change'))}})()")
     try await Task.sleep(for:.milliseconds(150));web.reload()
     try await ready("document.documentElement.dataset.zenReady==='on' && !document.documentElement.dataset.zenPreparing && __zenPreferenceTrace.paint.length",label:"Saved preferences reload did not settle")
     try await visibleFrames("saved-preferences")
     _ = try await evaluate("checkPreferencePaint(['plain','off','off','auto'])")
     checks.append("Saved Plain/None/Steady survive reload and first visible paint")
     finish("passed","Defaults, native animated Next, native pointer failure/success and Zen mode feedback in foreground WebKit; not Safari.app/device.");return
    }
    if layoutOnly {
     _ = try await evaluate(presentation)
     let script=try String(contentsOfFile:URL(fileURLWithPath:CommandLine.arguments[3]).deletingLastPathComponent().appendingPathComponent("zen-render-check.js").path,encoding:.utf8)
     _ = try await evaluate(script+"\nwindow.__render=checkZenRendering();true")
     var complete=false
     web.autoresizingMask=[]
     for _ in 0..<100 {
      guard let step=try await evaluateAsync("return await __render.next();") as? [String:Any],let value=step["value"] as? [String:Any] else {throw NSError(domain:"RenderCheck",code:1)}
      if step["done"] as? Bool == true {checks += value["checks"] as? [String] ?? [];complete=true;break}
      try await visibleFrames("render-step")
      if let size=value["resize"] as? [Double] {let h=min(size[1],height);web.frame=NSRect(x:0,y:height-h,width:min(size[0],width),height:h);try await visibleFrames("render-resize")}
      else if let name=value["screenshot"] as? String {try await snapshot(name)}
      else if let x=value["x"] as? Double,let y=value["y"] as? Double {try pointer(.leftMouseDown,x:x,y:y);try pointer(.leftMouseUp,x:x,y:y)}
     }
     guard complete else {throw NSError(domain:"RenderCheckIncomplete",code:1)}
     let review=try String(contentsOfFile:CommandLine.arguments[3],encoding:.utf8)
     if let r=try await evaluateAsync(review+"\nreturn await checkVisibleReview();") as? [String:Any] {checks += r["checks"] as? [String] ?? []}
     web.frame=NSRect(x:0,y:height-550,width:min(1440,width),height:550);try await visibleFrames("render-review")
     _ = try await evaluateAsync("return await preparePresentationCheck();")
     if let r=try await evaluateAsync("return await checkPresentationCase('site',true,false,'on');") as? [String:Any] {checks += r["checks"] as? [String] ?? []}
     try await snapshot("wide-review")
     try await nativeArrowNavigation()
     finish("passed","Native Zen mode rendering, prompt contrast, mapped pointer/Review and navigation in foreground WebKit; not Safari.app or physical device.");return
    }
    if !keyboardOnly && !noticesOnly && !layoutOnly && !defaultsOnly && !coordinatesOnly && !reloadOnly && !reviewStateOnly && !turnOnly && !commentsOnly && !resetOnly && !tapsOnly && !nextOnly {
    _ = try await evaluate(presentation)
    _ = try await evaluateAsync("return await preparePresentationCheck();")
    try await snapshot("theme-native")
    for (w,h) in [(440.0,min(1000.0,screen.height-80)),(820.0,min(1000.0,screen.height-80)),(width,height)] {
     window.setContentSize(NSSize(width:w,height:h))
     window.setFrameOrigin(NSPoint(x:screen.midX-window.frame.width/2,y:screen.midY-window.frame.height/2))
     try await visibleFrames("theme-resize")
     for coordinates in [false,true] {
      if let outcome=try await evaluateAsync("return await checkEdgeMarginCase(\(coordinates),\(w < 600));") as? [String:Any] {checks += outcome["checks"] as? [String] ?? []}
      _ = try await evaluate("[...document.querySelectorAll('.zen-toolbar button')].find(b=>b.textContent==='Full board').click()")
      try await visibleFrames("margin-ready");try await snapshot("margin-\(Int(w))-\(coordinates)")
      _ = try await evaluate("[...document.querySelectorAll('.zen-toolbar button')].find(b=>b.textContent==='Auto-fit').click()")
     }
     for theme in ["site","plain"] {for coordinates in [true,false] {
      let outcome=try await evaluateAsync("return await checkPresentationCase('\(theme)',\(coordinates));") as? [String:Any]
      checks += outcome?["checks"] as? [String] ?? []
      try await snapshot("theme-\(theme)-\(coordinates)-\(Int(w))")
     }}
    }
    if let restored=try await evaluateAsync("return await checkPresentationRestore();") as? String {checks.append(restored)}
    _ = try await evaluate("document.querySelector('.zen-resume').click()")
    }
    let script=try String(contentsOfFile:CommandLine.arguments[3],encoding:.utf8)
    let result=try await evaluateAsync(script+"\nreturn await checkVisibleReview();") as? [String:Any]
    guard let completed=result?["checks"] as? [String], !completed.isEmpty else {
     throw NSError(domain:"ZenCheck",code:1,userInfo:[NSLocalizedDescriptionKey:"Review check returned no evidence"])
    }
    checks += completed
    if noticesOnly {
     let script=try String(contentsOfFile:URL(fileURLWithPath:CommandLine.arguments[3]).deletingLastPathComponent().appendingPathComponent("achievement-check.js").path,encoding:.utf8)
     _ = try await evaluate(script+"\nwindow.__notices=checkAchievementNotices({touch:false});true")
     var completed=false
     web.autoresizingMask=[]
     for _ in 0..<100 {
      guard let step=try await evaluateAsync("return await __notices.next();") as? [String:Any],let value=step["value"] as? [String:Any] else {throw NSError(domain:"NoticeCheck",code:1)}
      if step["done"] as? Bool == true {checks += value["checks"] as? [String] ?? [];completed=true;break}
      try await visibleFrames("notice-input")
      if let size=value["resize"] as? [Double] {
       let h=min(size[1],height)
       web.frame=NSRect(x:0,y:height-h,width:min(size[0],width),height:h)
       try await visibleFrames("notice-resize")
      } else if let name=value["screenshot"] as? String {try await snapshot(name)}
      else if value["key"] != nil {try arrow(value)}
      else if value["input"] as? String == "drag", let from=value["from"] as? [String:Double],let to=value["to"] as? [String:Double] {
       try pointer(.leftMouseDown,x:from["x"]!,y:from["y"]!)
       for i in 1...8 {let f=Double(i)/8;try pointer(.leftMouseDragged,x:from["x"]!+(to["x"]!-from["x"]!)*f,y:from["y"]!+(to["y"]!-from["y"]!)*f);try await Task.sleep(for:.milliseconds(30))}
       try pointer(.leftMouseUp,x:to["x"]!,y:to["y"]!)
      } else if let x=value["x"] as? Double,let y=value["y"] as? Double {try pointer(.leftMouseDown,x:x,y:y);try pointer(.leftMouseUp,x:x,y:y)}
     }
     guard completed else {throw NSError(domain:"NoticeCheckIncomplete",code:1)}
     try await visibleFrames("notices-complete")
     finish("passed","Native fake-achievement presentation with foreground WebKit mouse/key events; no real award or physical device test.");return
    }
    let reviewKeys=try String(contentsOfFile:URL(fileURLWithPath:CommandLine.arguments[3]).deletingLastPathComponent().appendingPathComponent("review-keys-check.js").path,encoding:.utf8)
    _ = try await evaluate(reviewKeys+"\nwindow.__zenKeys=checkReviewKeys();true")
    var keysCompleted=false
    for _ in 0..<80 {
     guard let step=try await evaluateAsync("return await __zenKeys.next();") as? [String:Any],let value=step["value"] as? [String:Any] else {throw NSError(domain:"KeyCheck",code:1)}
     if step["done"] as? Bool == true {checks += value["checks"] as? [String] ?? [];keysCompleted=true;break}
     try arrow(value)
    }
    guard keysCompleted else {throw NSError(domain:"KeyCheckIncomplete",code:1)}
    if keyboardOnly {
     try await visibleFrames("keyboard-complete");try await snapshot("webkit-keyboard-review")
     try await nativeArrowNavigation()
     finish("passed","Focused Review/native-navigation keyboard flow in foreground WebKit host; not physical keyboard or Safari.app.");return
    }
    let reviewColors=try String(contentsOfFile:URL(fileURLWithPath:CommandLine.arguments[3]).deletingLastPathComponent().appendingPathComponent("review-colors-check.js").path,encoding:.utf8)
    if let outcome=try await evaluateAsync(reviewColors+"\nreturn await checkReviewColors();") as? [String:Any] {checks += outcome["checks"] as? [String] ?? []}
    _ = try await evaluate("window.__zenColorOriginal={node:besogo.editor.getCurrent(),inverted:besogo.editor.isColorInverted()}")
    for solver in [-1,1] {
     _ = try await evaluate("(()=>{const e=besogo.editor;if(e.getRoot().firstMove!==\(solver)){const t=besogo.makeTransformation();t.invertColors=true;e.applyTransformation(t)}e.setCurrent(e.getRoot().children.find(n=>n.children.length))})()")
     try await visibleFrames("reply-color-ready");try await snapshot(solver == -1 ? "review-reply-white" : "review-reply-black")
    }
    _ = try await evaluate("(()=>{const e=besogo.editor;if(e.isColorInverted()!==__zenColorOriginal.inverted){const t=besogo.makeTransformation();t.invertColors=true;e.applyTransformation(t)}e.setCurrent(__zenColorOriginal.node)})()")
    _ = try await evaluateAsync("return await preparePresentationCheck();")
    window.setContentSize(NSSize(width:320,height:min(1000,screen.height-80)))
    window.setFrameOrigin(NSPoint(x:screen.midX-window.frame.width/2,y:screen.midY-window.frame.height/2))
    try await visibleFrames("theme-review-resize")
    if let outcome=try await evaluateAsync("return await checkEdgeMarginCase(true,false);") as? [String:Any] {checks += outcome["checks"] as? [String] ?? []}
    if let outcome=try await evaluateAsync("return await checkPresentationCase('site',true);") as? [String:Any] {checks += outcome["checks"] as? [String] ?? []}
    try await snapshot("theme-review")
    window.setContentSize(NSSize(width:width,height:height));try await visibleFrames("theme-review-restored")
    try await visibleFrames("review-ready");try await snapshot("webkit-review")
    expectedBackground=true;window.orderOut(nil)
    try await ready("document.visibilityState==='hidden'",label:"ENVIRONMENT: requested background state unavailable",seconds:3)
    try await Task.sleep(for:.milliseconds(1200))
    bringForward();try await visibleFrames("foreground-recovery");expectedBackground=false
    guard try await evaluate("besogo.editor.getReviewMode() && besogo.editor.getCurrent()===__zenReviewPosition && document.querySelector('.zen-review-tree').contains(document.querySelector('.besogo-tree'))") as? Bool == true else {throw NSError(domain:"ZenCheck",code:1,userInfo:[NSLocalizedDescriptionKey:"Review position lost across background/foreground"])}
    checks.append("Background/foreground retains visible Review position and tree")
    try await nativeArrowNavigation()
    finish("passed","Visible native flow completed in a nonpersistent macOS WebKit extension host, not Safari.app.")
   } catch {
    let reason=String(describing:error)
    if nativeReady() {
     try? await snapshot("failed-state")
     if let detail=try? await evaluate("JSON.stringify({zen:document.documentElement.dataset,status:document.querySelector('#status')?.textContent,move:window.besogo?.editor?.getCurrent()?.move,lastHit:window.__zenLastHit,review:window.besogo?.editor?.getReviewMode(),hitCells:document.querySelectorAll('.besogo-board svg rect[fill=transparent]').length,url:location.href})"),let text=detail as? String {try? text.write(to:output.appendingPathComponent("failed-state.json"),atomically:true,encoding:.utf8)}
    }
    finish(reason.contains("ENVIRONMENT:") || locked() ? "environment-blocked" : "failed",reason)
   }
  }
 }
}
@main struct Main {
 static func main(){let app=NSApplication.shared;app.setActivationPolicy(.regular);let delegate=CheckApp();app.delegate=delegate;app.run();withExtendedLifetime(delegate){}}
}
