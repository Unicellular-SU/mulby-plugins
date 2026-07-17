import AppKit

let paragraph = """
Mulby 是一款跨平台启动器应用。按下全局快捷键即可唤出搜索框，输入关键词快速启动插件。
The OCR engine runs entirely on-device using ONNX Runtime WebAssembly. No Python, no network.
支持图片拖入识别：PNG / JPG / BMP / WebP，识别结果一键复制到剪贴板。2026-07-17 14:30:25
func recognize(image: RawImage): Promise<OcrLine[]> { return engine.run(image) }
菜单栏 → 设置 → 快捷键绑定，可以为“截图识字”配置 Cmd+Shift+O 之类的全局热键。
金额合计：¥1,234,567.89 元整（含税）；折扣率 8.5%；订单号 NO.20260717-ABCD-EFGH
"""

let width = 1200
let lineHeight = 30
let lines = paragraph.components(separatedBy: "\n")
let height = lineHeight * (lines.count + 1)
let image = NSImage(size: NSSize(width: width, height: height))
image.lockFocus()
NSColor.windowBackgroundColor.setFill()
NSRect(x: 0, y: 0, width: width, height: height).fill()
var y = CGFloat(height - lineHeight)
for line in lines {
    let attrs: [NSAttributedString.Key: Any] = [
        .font: NSFont.systemFont(ofSize: 12),
        .foregroundColor: NSColor.textColor,
    ]
    line.draw(at: NSPoint(x: 12, y: y - 20), withAttributes: attrs)
    y -= CGFloat(lineHeight)
}
image.unlockFocus()
guard let tiff = image.tiffRepresentation,
      let rep = NSBitmapImageRep(data: tiff),
      let png = rep.representation(using: .png, properties: [:]) else { exit(1) }
try png.write(to: URL(fileURLWithPath: "scripts/test-image2.png"))
print("ok")
