import AppKit
final class FixtureTextView: NSTextView {
 private var copies = 0
 override func copy(_ sender: Any?) {
  let before = NSPasteboard.general.changeCount
  let range = selectedRange()
  let expected = "Do not ship before Friday. The total is $19.99, not $9.99."
  let selected = (string as NSString).substring(with: range)
  super.copy(sender)
  copies += 1
  let record: [String:Any] = ["copies":copies,"selectedLength":range.length,
    "fixtureSelectionExact":selected == expected,"sequenceBefore":before,
    "sequenceAfter":NSPasteboard.general.changeCount,"sequenceChanged":before != NSPasteboard.general.changeCount,
    "sourceIsFocused":window?.firstResponder === self,"foregroundPID":NSWorkspace.shared.frontmostApplication?.processIdentifier ?? 0]
  // Fixture metadata only, never a read of pre-existing clipboard text.
  let output = FileManager.default.temporaryDirectory.appendingPathComponent("opendeepl-fixture-copy.json")
  if let data=try? JSONSerialization.data(withJSONObject:record,options:.sortedKeys) {try? data.write(to:output,options:.atomic)}
 }
}
final class Delegate: NSObject, NSApplicationDelegate {
 var window:NSWindow!
 func applicationDidFinishLaunching(_ notification:Notification){
  let bar=NSMenu();let appItem=NSMenuItem();let appMenu=NSMenu()
  let services=NSMenu();let servicesItem=NSMenuItem(title:"Services",action:nil,keyEquivalent:"");servicesItem.submenu=services;appMenu.addItem(servicesItem);NSApp.servicesMenu=services
  appMenu.addItem(NSMenuItem(title:"Quit OpenDeepLFixture",action:#selector(NSApplication.terminate(_:)),keyEquivalent:"q"));appItem.submenu=appMenu;bar.addItem(appItem)
  let editItem=NSMenuItem();let edit=NSMenu(title:"Edit")
  for (title,action,key) in [("Copy",#selector(NSText.copy(_:)),"c"),("Paste",#selector(NSText.paste(_:)),"v"),("Select All",#selector(NSText.selectAll(_:)),"a")] {edit.addItem(NSMenuItem(title:title,action:action,keyEquivalent:key))}
  editItem.submenu=edit;bar.addItem(editItem);NSApp.mainMenu=bar
  let frame=NSScreen.main?.visibleFrame ?? NSRect(x:40,y:40,width:1000,height:700)
  window=NSWindow(contentRect:frame,styleMask:[.titled,.closable,.resizable,.miniaturizable],backing:.buffered,defer:false)
  window.title="OpenDeepL Acceptance Fixture"
  let scroll=NSScrollView(frame:window.contentView!.bounds);scroll.autoresizingMask=[.width,.height];scroll.hasVerticalScroller=true
  let text=FixtureTextView(frame:scroll.bounds);text.isRichText=false;text.font=NSFont.systemFont(ofSize:30);text.textColor=NSColor.black;text.backgroundColor=NSColor.white;text.textContainerInset=NSSize(width:50,height:50);text.autoresizingMask=[.width,.height]
  text.string="Do not ship before Friday. The total is $19.99, not $9.99.\n\nPrice: $19.99\nCapacity: 750 mL\nDo not ship before Friday."
  scroll.documentView=text;window.contentView?.addSubview(scroll);window.makeKeyAndOrderFront(nil);NSApp.activate(ignoringOtherApps:true);window.makeFirstResponder(text)
 }
 func applicationShouldTerminateAfterLastWindowClosed(_ sender:NSApplication)->Bool {true}
}
let app=NSApplication.shared;let delegate=Delegate();app.setActivationPolicy(.regular);app.delegate=delegate;app.run()
