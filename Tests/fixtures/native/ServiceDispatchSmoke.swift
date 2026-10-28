import AppKit
let app=NSApplication.shared
app.setActivationPolicy(.prohibited)
app.finishLaunching()
let p = NSPasteboard.withUniqueName()
let legacy=NSPasteboard.PasteboardType(rawValue:"NSStringPboardType")
p.declareTypes([.string,legacy], owner:nil)
p.setString("Capacity: 750 mL", forType:.string)
p.setString("Capacity: 750 mL", forType:legacy)
let ok = NSPerformService("用 OpenDeepL 翻译", p)
print(ok ? "service-dispatched" : "service-dispatch-failed")
RunLoop.current.run(until: Date().addingTimeInterval(3))
p.releaseGlobally()
exit(ok ? 0 : 1)
