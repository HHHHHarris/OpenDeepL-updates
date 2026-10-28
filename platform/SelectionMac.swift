import AppKit
import ApplicationServices
import Foundation

private struct Result: Encodable {
    let text: String?
    let app: String?
    let error: String?
    let message: String?
}

private func emit(_ result: Result, status: Int32) -> Never {
    if let data = try? JSONEncoder().encode(result) {
        FileHandle.standardOutput.write(data)
        FileHandle.standardOutput.write(Data("\n".utf8))
    }
    exit(status)
}

guard CommandLine.arguments.count == 1 else {
    emit(Result(text: nil, app: nil, error: "unsupported", message: "Run without arguments."), status: 4)
}
guard AXIsProcessTrusted() else {
    emit(Result(text: nil, app: nil, error: "permission_denied", message: "Enable Accessibility for OpenDeepL in System Settings, then retry."), status: 2)
}

let system = AXUIElementCreateSystemWide()
var focused: CFTypeRef?
let focusStatus = AXUIElementCopyAttributeValue(system, kAXFocusedUIElementAttribute as CFString, &focused)
guard focusStatus == .success, let focusedElement = focused else {
    emit(Result(text: nil, app: nil, error: "no_selection", message: "Focus an editable text field and select text before using the shortcut."), status: 3)
}
let element = focusedElement as! AXUIElement
var selected: CFTypeRef?
let selectionStatus = AXUIElementCopyAttributeValue(element, kAXSelectedTextAttribute as CFString, &selected)
if selectionStatus == .apiDisabled || selectionStatus == .notImplemented {
    emit(Result(text: nil, app: nil, error: "permission_denied", message: "Accessibility access is unavailable; check the macOS permission for OpenDeepL."), status: 2)
}
guard selectionStatus == .success, let text = selected as? String, !text.isEmpty else {
    emit(Result(text: nil, app: nil, error: "no_selection", message: "The focused element has no selected text (or does not expose AXSelectedText)."), status: 3)
}
guard text.count <= 100_000 else {
    emit(Result(text: nil, app: nil, error: "too_long", message: "Selection exceeds 100,000 characters."), status: 6)
}
var pid: pid_t = 0
let app: String?
if AXUIElementGetPid(element, &pid) == .success, pid > 0 {
    app = NSRunningApplication(processIdentifier: pid)?.localizedName
} else {
    app = nil
}
emit(Result(text: text, app: app, error: nil, message: nil), status: 0)
