import AppKit
import Foundation
import Darwin

private let maximumCharacters = 100_000
// Contents/Helpers/OpenDeepLContextService.app/Contents/MacOS/<executable>
// Resolve the enclosing parent bundle rather than capturing a build-machine path.
private let mainApplication = Bundle.main.bundleURL
    .deletingLastPathComponent().deletingLastPathComponent()
    .deletingLastPathComponent().path

final class ContextService: NSObject {
    @objc func translateSelection(_ pasteboard: NSPasteboard, userData: String?, error: AutoreleasingUnsafeMutablePointer<NSString?>) {
        guard let value = pasteboard.string(forType: .string) ?? pasteboard.string(forType: NSPasteboard.PasteboardType(rawValue: "NSStringPboardType")),
              !value.isEmpty, value.unicodeScalars.count <= maximumCharacters else {
            error.pointee = "请选择不超过 100,000 字符的文本。" as NSString
            return
        }
        do {
            let file = try writePrivateSelection(value)
            let cleanup = {
                _ = Darwin.unlink(file.path)
                _ = Darwin.rmdir(file.deletingLastPathComponent().path)
            }
            var forwarded = false
            defer { if !forwarded { cleanup() } }
            Timer.scheduledTimer(withTimeInterval: 30, repeats: false) { _ in cleanup() }
            let task = Process()
            task.executableURL = URL(fileURLWithPath: "/usr/bin/open")
            task.arguments = ["-n", "-a", mainApplication, "--args", "--context-text-file=" + file.path]
            try task.run()
            task.waitUntilExit()
            forwarded = task.terminationStatus == 0
            if task.terminationStatus != 0 {
                cleanup()
                error.pointee = "OpenDeepL 启动失败。" as NSString
            }
        } catch let failure {
            error.pointee = "OpenDeepL 接收所选文本失败：\(failure.localizedDescription)" as NSString
        }
    }

    private func writePrivateSelection(_ value: String) throws -> URL {
        let root = FileManager.default.temporaryDirectory
        let directory = root.appendingPathComponent("OpenDeepL-context-\(UUID().uuidString.lowercased())", isDirectory: true)
        guard mkdir(directory.path, 0o700) == 0 else {
            throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
        }
        let file = directory.appendingPathComponent("selection.txt")
        let bytes = Array(value.utf8)
        guard bytes.count <= maximumCharacters * 4 else {
            try? FileManager.default.removeItem(at: directory)
            throw CocoaError(.fileWriteOutOfSpace)
        }
        let descriptor = Darwin.open(file.path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0o600)
        guard descriptor >= 0 else {
            try? FileManager.default.removeItem(at: directory)
            throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
        }
        do {
            try bytes.withUnsafeBytes { raw in
                var offset = 0
                while offset < raw.count {
                    let count = Darwin.write(descriptor, raw.baseAddress!.advanced(by: offset), raw.count - offset)
                    if count < 0 && errno == EINTR { continue }
                    guard count > 0 else { throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO) }
                    offset += count
                }
            }
            guard Darwin.close(descriptor) == 0 else { throw POSIXError(.EIO) }
            return file
        } catch {
            _ = Darwin.close(descriptor)
            try? FileManager.default.removeItem(at: file)
            try? FileManager.default.removeItem(at: directory)
            throw error
        }
    }
}

let application = NSApplication.shared
application.setActivationPolicy(.prohibited)
let provider = ContextService()
application.servicesProvider = provider
application.run()
