import Foundation
import Vision
import AppKit
struct OCRPayload: Encodable { let text: String }
do {
 guard CommandLine.arguments.count == 2 else { throw NSError(domain:"OpenDeepL",code:1) }
 let url = URL(fileURLWithPath:CommandLine.arguments[1])
 let request = VNRecognizeTextRequest()
 request.recognitionLevel = .accurate
 request.recognitionLanguages = ["en-US", "zh-Hans"]
 request.usesLanguageCorrection = true
 if #available(macOS 13, *) { request.automaticallyDetectsLanguage = true }
 try VNImageRequestHandler(url:url, options:[:]).perform([request])
 let observations = (request.results ?? []).sorted { a,b in
  abs(a.boundingBox.midY-b.boundingBox.midY)>0.015 ? a.boundingBox.midY>b.boundingBox.midY : a.boundingBox.minX<b.boundingBox.minX
 }
 let text=observations.compactMap{$0.topCandidates(1).first?.string}.joined(separator:"\n")
 let data=try JSONEncoder().encode(OCRPayload(text:text))
 FileHandle.standardOutput.write(data)
} catch {
 FileHandle.standardError.write(Data("Local OCR failed.\n".utf8)); exit(1)
}
