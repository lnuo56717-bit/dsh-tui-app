import { describe, expect, it } from 'vitest'
import { sniffImageMediaType, unquotePath } from '../../src/image-input.js'

const PNG = Uint8Array.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 1, 2])
const JPEG = Uint8Array.from([0xFF, 0xD8, 0xFF, 0xE0, 0, 1])
const GIF = Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])
const WEBP = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])

describe('image input helpers', () => {
  it('sniffs supported rasters from magic bytes', () => {
    expect(sniffImageMediaType(PNG)).toBe('image/png')
    expect(sniffImageMediaType(JPEG)).toBe('image/jpeg')
    expect(sniffImageMediaType(GIF)).toBe('image/gif')
    expect(sniffImageMediaType(WEBP)).toBe('image/webp')
    expect(sniffImageMediaType(Uint8Array.from([0, 1, 2, 3]))).toBeUndefined()
  })

  it('strips wrapping quotes from typed paths', () => {
    expect(unquotePath('  "C:\\\\shot.png"  ')).toBe('C:\\\\shot.png')
    expect(unquotePath("'photo.jpg'")).toBe('photo.jpg')
    expect(unquotePath('plain.png')).toBe('plain.png')
  })
})
