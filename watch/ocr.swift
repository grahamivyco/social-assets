// On-screen text for every .jpg in a folder, using Apple Vision (built into macOS, free).
// swift ocr.swift <folder>  ->  {"01_000.40s.jpg": "line one\nline two", ...}
import Foundation
import Vision
import AppKit

let dir = URL(fileURLWithPath: CommandLine.arguments[1])
let files = (try? FileManager.default.contentsOfDirectory(atPath: dir.path)) ?? []
var out: [String: String] = [:]
for name in files.sorted() where name.lowercased().hasSuffix(".jpg") {
    guard let img = NSImage(contentsOf: dir.appendingPathComponent(name)),
          let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else { continue }
    let req = VNRecognizeTextRequest()
    req.recognitionLevel = .accurate
    req.usesLanguageCorrection = true
    try? VNImageRequestHandler(cgImage: cg, options: [:]).perform([req])
    // Top to bottom, so titles come before captions.
    let obs = (req.results ?? []).sorted { $0.boundingBox.midY > $1.boundingBox.midY }
    let lines = obs.compactMap { o -> String? in
        guard let c = o.topCandidates(1).first, c.confidence > 0.4 else { return nil }
        return c.string
    }
    out[name] = lines.joined(separator: "\n")
}
let data = try JSONSerialization.data(withJSONObject: out, options: [.sortedKeys])
print(String(data: data, encoding: .utf8)!)
