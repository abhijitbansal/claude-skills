# Sharpness measurement feeding BlurGate.verdict: variance of the Laplacian

```swift
import Accelerate

nonisolated extension BlurGate {
    /// Variance of the Laplacian over an 8-bit luma plane. Higher = sharper.
    static func laplacianVariance(luma src: inout vImage_Buffer) -> Double {
        var dst = vImage_Buffer()
        guard vImageBuffer_Init(&dst, src.height, src.width, 8,
                                vImage_Flags(kvImageNoFlags)) == kvImageNoError
        else { return 0 }
        defer { free(dst.data) }
        var kernel: [Int16] = [0, 1, 0,  1, -4, 1,  0, 1, 0]
        vImageConvolve_Planar8(&src, &dst, nil, 0, 0, &kernel, 3, 3, 1, 0,
                               vImage_Flags(kvImageEdgeExtend))
        let w = Int(dst.width), h = Int(dst.height)
        var floats = [Float](repeating: 0, count: w * h)
        let bytes = dst.data.assumingMemoryBound(to: UInt8.self)
        for row in 0..<h {
            let rowPtr = bytes + row * dst.rowBytes
            for col in 0..<w { floats[row * w + col] = Float(rowPtr[col]) }
        }
        var mean: Float = 0, stdDev: Float = 0
        vDSP_normalize(floats, 1, nil, 1, &mean, &stdDev, vDSP_Length(floats.count))
        return Double(stdDev) * Double(stdDev)
    }
}
```
