import AppKit
import ApplicationServices
import Foundation

// Passive keyboard event tap. Only key metadata and pasteboard changeCount are seen.
private func emit(_ object: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: object) else { return }
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data([10]))
}

private final class Detector {
    private let interval = 0.6
    private let copyTimeout = 0.35
    private var stage = 0
    private var held = false
    private var pending = false
    private var copied = false
    private var baseline = 0
    private var deadline = 0.0
    private var lastDown: Double?
    private var suppressed = false
    private var context: pid_t?
    private var triggerSequence: Int?
    private var emitted = false

    func reset() {
        stage = 0
        held = false
        pending = false
        copied = false
        lastDown = nil
        suppressed = false
        context = nil
        triggerSequence = nil
        emitted = false
    }

    private func readyTrigger() -> Int? {
        guard stage == 2, copied, !held, !emitted else { return nil }
        emitted = true
        suppressed = true
        return triggerSequence
    }

    func keyUp(context current: pid_t?) -> Int? {
        held = false
        guard current == context else { reset(); return nil }
        return readyTrigger()
    }

    func keyDown(now: Double, sequence: Int, valid: Bool, repeatKey: Bool,
                 context current: pid_t?) {
        if !valid { reset(); return }
        if held || repeatKey { return }
        held = true
        if suppressed {
            if let last = lastDown, now - last <= interval {
                lastDown = now
                return
            }
            reset()
            held = true
        }
        if stage == 1 {
            if pending && now <= deadline && sequence != baseline {
                pending = false
                copied = true
            }
            if let last = lastDown, now - last > interval || current != context {
                reset()
                held = true
                stage = 1
            } else if !copied {
                suppressed = true
                lastDown = now
                pending = false
                return
            } else {
                stage = 2
            }
        } else {
            stage = 1
        }
        lastDown = now
        baseline = sequence
        deadline = now + copyTimeout
        pending = true
        copied = false
        context = current
    }

    func observe(now: Double, sequence: Int, context current: pid_t?) -> Int? {
        guard pending else { return nil }
        guard current == context else { reset(); return nil }
        if now > deadline {
            pending = false
            copied = false
            return nil
        }
        guard sequence != baseline else { return nil }
        pending = false
        copied = true
        if stage == 2 {
            triggerSequence = sequence
            return readyTrigger()
        }
        return nil
    }
}

private let detector = Detector()
private var activeTap: CFMachPort?
private var queuedTrigger: (Int, pid_t)?
private func foregroundPID() -> pid_t? {
    NSWorkspace.shared.frontmostApplication?.processIdentifier
}
private func validFlags(_ flags: CGEventFlags) -> Bool {
    let wanted = flags.contains(.maskCommand)
    let excluded: CGEventFlags = [.maskControl, .maskAlternate, .maskShift]
    return wanted && flags.intersection(excluded).isEmpty
}

private let tapCallback: CGEventTapCallBack = { proxy, type, event, _ in
    // listenOnly makes the returned event observational; it is never suppressed.
    if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
        detector.reset()
        queuedTrigger = nil
        if type == .tapDisabledByTimeout, let activeTap = activeTap {
            CGEvent.tapEnable(tap: activeTap, enable: true)
        }
        return Unmanaged.passUnretained(event)
    }
    let keyCode = event.getIntegerValueField(.keyboardEventKeycode)
    if type == .flagsChanged {
        let excluded: CGEventFlags = [.maskControl, .maskAlternate, .maskShift]
        if !event.flags.intersection(excluded).isEmpty {
            detector.reset()
            queuedTrigger = nil
        }
    } else if keyCode == 8 { // ANSI C
        if type == .keyDown {
            let pid = foregroundPID()
            detector.keyDown(now: ProcessInfo.processInfo.systemUptime,
                             sequence: NSPasteboard.general.changeCount,
                             valid: validFlags(event.flags) && pid != nil,
                             repeatKey: event.getIntegerValueField(.keyboardEventAutorepeat) != 0,
                             context: pid)
        } else if type == .keyUp {
            let pid = foregroundPID()
            if let sequence = detector.keyUp(context: pid), let pid = pid {
                queuedTrigger = (sequence, pid)
            }
        }
    } else if type == .keyDown {
        detector.reset()
        queuedTrigger = nil
    }
    return Unmanaged.passUnretained(event)
}

let arguments = Array(CommandLine.arguments.dropFirst())
if arguments == ["--permission-status"] {
    emit(["inputMonitoring": CGPreflightListenEventAccess(),
          "screen": CGPreflightScreenCaptureAccess()])
    exit(0)
}
if arguments.count == 2 && arguments[0] == "--request-permission" {
    let granted: Bool
    switch arguments[1] {
    case "inputMonitoring": granted = CGRequestListenEventAccess()
    case "screen": granted = CGRequestScreenCaptureAccess()
    default: exit(4)
    }
    emit(["requested": true, "granted": granted])
    exit(0)
}
if arguments == ["--snapshot"] {
    emit(["type": "snapshot", "sequence": NSPasteboard.general.changeCount,
          "foreground": foregroundPID() ?? 0])
    exit(0)
}
guard CommandLine.arguments.count == 1 else {
    emit(["type": "status", "ready": false, "error": "unsupported-arguments"])
    exit(4)
}
guard CGPreflightListenEventAccess() else {
    emit(["type": "status", "ready": false, "permission": "input-monitoring",
          "message": "Enable Input Monitoring for OpenDeepL in System Settings."])
    exit(2)
}

let mask = (1 << CGEventType.keyDown.rawValue) |
           (1 << CGEventType.keyUp.rawValue) |
           (1 << CGEventType.flagsChanged.rawValue)
guard let tap = CGEvent.tapCreate(tap: .cgSessionEventTap, place: .headInsertEventTap,
                                  options: .listenOnly, eventsOfInterest: CGEventMask(mask),
                                  callback: tapCallback, userInfo: nil) else {
    emit(["type": "status", "ready": false, "error": "event-tap-unavailable"])
    exit(2)
}
activeTap = tap
let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
CFRunLoopAddSource(CFRunLoopGetCurrent(), source, .commonModes)
CGEvent.tapEnable(tap: tap, enable: true)
let timer = Timer(timeInterval: 0.02, repeats: true) { _ in
    let sequence = NSPasteboard.general.changeCount
    let pid = foregroundPID()
    if let confirmed = detector.observe(now: ProcessInfo.processInfo.systemUptime,
                                        sequence: sequence, context: pid), let pid = pid {
        queuedTrigger = (confirmed, pid)
    }
    if let (confirmed, originalPID) = queuedTrigger {
        queuedTrigger = nil
        if foregroundPID() == originalPID {
            emit(["type": "trigger", "source": "double-copy", "sequence": confirmed,
                  "foreground": originalPID, "clipboardIsFresh": true])
        }
    }
}
RunLoop.current.add(timer, forMode: .common)
let loop = CFRunLoopGetCurrent()
DispatchQueue.global(qos: .utility).async {
    // Parent closes stdin on shutdown. This thread never sees clipboard payload.
    while FileHandle.standardInput.availableData.count > 0 {}
    CFRunLoopStop(loop)
}
emit(["type": "status", "ready": true, "platform": "macos", "shortcut": "Cmd+C,C"])
CFRunLoopRun()
timer.invalidate()
CFRunLoopRemoveSource(loop, source, .commonModes)
CGEvent.tapEnable(tap: tap, enable: false)
