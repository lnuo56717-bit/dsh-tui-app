import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'

export type ImageMediaType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'

export interface LoadedImage {
  readonly data: Uint8Array
  readonly mediaType: ImageMediaType
  readonly name: string
}

const PNG = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
const JPEG = Buffer.from([0xFF, 0xD8, 0xFF])
const GIF = Buffer.from([0x47, 0x49, 0x46])
const RIFF = Buffer.from([0x52, 0x49, 0x46, 0x46])
const WEBP = Buffer.from([0x57, 0x45, 0x42, 0x50])

/** Detect a supported raster from magic bytes; file names are not consulted. */
export function sniffImageMediaType(data: Uint8Array): ImageMediaType | undefined {
  if (data.length >= PNG.length && bytesEqual(data, PNG, PNG.length)) return 'image/png'
  if (data.length >= JPEG.length && bytesEqual(data, JPEG, JPEG.length)) return 'image/jpeg'
  if (data.length >= 6 && bytesEqual(data, GIF, GIF.length)) return 'image/gif'
  if (data.length >= 12 && bytesEqual(data, RIFF, 4) && bytesEqual(data.subarray(8), WEBP, 4)) return 'image/webp'
  return undefined
}

function bytesEqual(data: Uint8Array, prefix: Uint8Array, length: number): boolean {
  for (let i = 0; i < length; i += 1) {
    if (data[i] !== prefix[i]) return false
  }
  return true
}

/** Strip wrapping quotes from a user-typed filesystem path. */
export function unquotePath(input: string): string {
  const trimmed = input.trim()
  if (trimmed.length >= 2) {
    const start = trimmed[0]
    const end = trimmed[trimmed.length - 1]
    if ((start === '"' && end === '"') || (start === "'" && end === "'")) return trimmed.slice(1, -1)
  }
  return trimmed
}

export async function loadImageFile(path: string): Promise<LoadedImage> {
  const data = new Uint8Array(await readFile(path))
  const mediaType = sniffImageMediaType(data)
  if (mediaType === undefined) throw new Error('Not a PNG, JPEG, GIF, or WebP image')
  return { data, mediaType, name: basename(path) }
}

export async function loadClipboardImage(
  platform: NodeJS.Platform = process.platform,
): Promise<LoadedImage | undefined> {
  const data = platform === 'win32'
    ? await windowsClipboardPng()
    : platform === 'darwin'
      ? await captureStdout('pngpaste', ['-'])
      : await linuxClipboardPng()
  if (data === undefined || data.length === 0) return undefined
  const mediaType = sniffImageMediaType(data) ?? 'image/png'
  return { data, mediaType, name: 'clipboard.png' }
}

async function windowsClipboardPng(): Promise<Uint8Array | undefined> {
  const script = [
    'Add-Type -AssemblyName System.Windows.Forms',
    'Add-Type -AssemblyName System.Drawing',
    '$img = [System.Windows.Forms.Clipboard]::GetImage()',
    'if ($null -eq $img) { exit 2 }',
    '$ms = New-Object System.IO.MemoryStream',
    '$img.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)',
    '$bytes = $ms.ToArray()',
    '[Console]::OpenStandardOutput().Write($bytes, 0, $bytes.Length)',
  ].join('; ')
  return captureStdout('powershell.exe', ['-NoProfile', '-STA', '-Command', script])
}

async function linuxClipboardPng(): Promise<Uint8Array | undefined> {
  const wayland = await captureStdout('wl-paste', ['--type', 'image/png'])
  if (wayland !== undefined && wayland.length > 0) return wayland
  return captureStdout('xclip', ['-selection', 'clipboard', '-t', 'image/png', '-o'])
}

function captureStdout(command: string, args: readonly string[]): Promise<Uint8Array | undefined> {
  return new Promise(resolve => {
    let settled = false
    const finish = (value: Uint8Array | undefined): void => {
      if (settled) return
      settled = true
      resolve(value)
    }
    try {
      const child = spawn(command, [...args], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true })
      const chunks: Buffer[] = []
      child.stdout.on('data', (chunk: Buffer) => { chunks.push(chunk) })
      child.once('error', () => finish(undefined))
      child.once('close', code => {
        if (code !== 0) {
          finish(undefined)
          return
        }
        finish(Buffer.concat(chunks))
      })
    } catch {
      finish(undefined)
    }
  })
}
