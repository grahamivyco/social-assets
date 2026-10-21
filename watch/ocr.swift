// On-screen text for every .jpg in a folder, using Apple Vision (built into macOS, free).
// swift ocr.swift <folder>          ->  {"01_000.40s.jpg": "line one\nline two", ...}
// swift ocr.swift <folder> --boxes  ->  {"f0001.jpg": {"text": [{"s": "line", "x":, "y":, "w":, "h":}], "faces": [{"x":, "y":, "w":, "h":}]}}
// Boxes are 0-1 of the frame, measured from the top left.
import Foundation
import Vision
import AppKit

let dir = URL(fileURLWithPath: CommandLine.arguments[1])
let boxes = CommandLine.arguments.contains("--boxes")
let files = (try? FileManager.default.contentsOfDirectory(atPath: dir.path)) ?? []

func box(_ r: CGRect) -> [String: Double] {
    let f = { (v: CGFloat) in (Double(v) * 1000).rounded() / 1000 }
    return ["x": f(r.minX), "y": f(1 - r.maxY), "w": f(r.width), "h": f(r.height)]
}

var out: [String: Any] = [:]
for name in files.sorted() where name.lowercased().hasSuffix(".jpg") {
    guard let img = NSImage(contentsOf: dir.appendingPathComponent(name)),
          let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else { continue }
    let req = VNRecognizeTextRequest()
    req.recognitionLevel = .accurate
    req.usesLanguageCorrection = true
    let faceReq = VNDetectFaceRectanglesRequest()
    try? VNImageRequestHandler(cgImage: cg, options: [:]).perform(boxes ? [req, faceReq] : [req])
    // Top to bottom, so titles come before captions.
    let obs = (req.results ?? []).sorted { $0.boundingBox.midY > $1.boundingBox.midY }
    var lines: [[String: Any]] = []
    for o in obs {
        guard let c = o.topCandidates(1).first, c.confidence > 0.4 else { continue }
        var l: [String: Any] = box(o.boundingBox)
        l["s"] = c.string
        lines.append(l)
    }
    if boxes {
        let faces = (faceReq.results ?? []).map { box($0.boundingBox) }
        out[name] = ["text": lines, "faces": faces]
    } else {
        out[name] = lines.map { $0["s"] as! String }.joined(separator: "\n")
    }
}
let data = try JSONSerialization.data(withJSONObject: out, options: [.sortedKeys])
print(String(data: data, encoding: .utf8)!)
