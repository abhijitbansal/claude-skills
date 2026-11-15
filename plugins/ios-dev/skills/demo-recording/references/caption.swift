// Renders a caption bar to a PNG, for ffmpeg builds without drawtext/libfreetype.
//
//   swiftc -O references/caption.swift -o /tmp/caption       # once
//   /tmp/caption "Scan a receipt" 380 caption.png            # text, width px, output
//
// Then composite with the always-available `overlay` filter (see SKILL.md, step 5).
// Pass the width the GIF is scaled to, so the bar spans the frame exactly.
import CoreGraphics
import CoreText
import Foundation
import ImageIO
import UniformTypeIdentifiers

let barHeight = 44
let fontSize: CGFloat = 17

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(2)
}

let args = CommandLine.arguments
guard args.count == 4, let width = Int(args[2]), width > 0 else {
    fail("usage: caption <text> <width-px> <out.png>")
}
let text = args[1]
let outURL = URL(fileURLWithPath: args[3])

guard let context = CGContext(
    data: nil, width: width, height: barHeight, bitsPerComponent: 8, bytesPerRow: 0,
    space: CGColorSpaceCreateDeviceRGB(),
    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
) else { fail("could not create bitmap context") }

// Translucent dark bar.
context.setFillColor(CGColor(red: 0, green: 0, blue: 0, alpha: 0.72))
context.fill(CGRect(x: 0, y: 0, width: width, height: barHeight))

// White, centred text. CoreGraphics origin is bottom-left.
let font = CTFontCreateWithName("Helvetica-Bold" as CFString, fontSize, nil)
let attributes: [CFString: Any] = [
    kCTFontAttributeName: font,
    kCTForegroundColorAttributeName: CGColor(red: 1, green: 1, blue: 1, alpha: 1),
]
let line = CTLineCreateWithAttributedString(
    NSAttributedString(string: text, attributes: attributes as [NSAttributedString.Key: Any]))
var ascent: CGFloat = 0, descent: CGFloat = 0, leading: CGFloat = 0
let textWidth = CTLineGetTypographicBounds(line, &ascent, &descent, &leading)
context.textPosition = CGPoint(
    x: (CGFloat(width) - CGFloat(textWidth)) / 2,
    y: (CGFloat(barHeight) - (ascent + descent)) / 2 + descent)
CTLineDraw(line, context)

guard let image = context.makeImage(),
      let destination = CGImageDestinationCreateWithURL(
        outURL as CFURL, UTType.png.identifier as CFString, 1, nil)
else { fail("could not create \(outURL.path)") }
CGImageDestinationAddImage(destination, image, nil)
guard CGImageDestinationFinalize(destination) else { fail("could not write \(outURL.path)") }
