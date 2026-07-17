import AppKit

// Render a realistic "screenshot" with mixed Chinese/English text for OCR testing.
let lines: [(String, CGFloat)] = [
    ("OCR 文字识别测试 RapidOCR Engine", 20),
    ("内置离线引擎，无需安装 Python 环境", 15),
    ("The quick brown fox jumps over the lazy dog 1234567890", 14),
    ("支持中文、English 混排识别，跨平台 macOS / Windows / Linux", 13),
    ("版本 v1.0.0 (build 2026.07.17)  免费开源 Apache-2.0", 12),
]

let width = 900
let height = 200
let image = NSImage(size: NSSize(width: width, height: height))
image.lockFocus()
NSColor.white.setFill()
NSRect(x: 0, y: 0, width: width, height: height).fill()

var y = CGFloat(height - 34)
for (text, size) in lines {
    let attrs: [NSAttributedString.Key: Any] = [
        .font: NSFont.systemFont(ofSize: size),
        .foregroundColor: NSColor.black,
    ]
    text.draw(at: NSPoint(x: 24, y: y - size), withAttributes: attrs)
    y -= size + 18
}
image.unlockFocus()

guard let tiff = image.tiffRepresentation,
      let rep = NSBitmapImageRep(data: tiff),
      let png = rep.representation(using: .png, properties: [:]) else {
    fputs("failed to render png\n", stderr)
    exit(1)
}
let outPath = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "test-image.png"
try png.write(to: URL(fileURLWithPath: outPath))
print("written: \(outPath)")
