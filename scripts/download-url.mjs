import { open, rename, unlink } from 'node:fs/promises'
import process from 'node:process'

const [url, output, attemptsText] = process.argv.slice(2)
if (url === undefined || output === undefined) {
  process.stderr.write('usage: node download-url.mjs <https-url> <output>\n')
  process.exit(2)
}
if (!url.startsWith('https://')) {
  process.stderr.write('download-url: only https URLs are allowed\n')
  process.exit(2)
}

const partial = `${output}.partial-${process.pid}`
const attempts = attemptsText === undefined ? 3 : Number.parseInt(attemptsText, 10)
if (!Number.isSafeInteger(attempts) || attempts < 1 || attempts > 5) {
  process.stderr.write('download-url: attempts must be an integer from 1 to 5\n')
  process.exit(2)
}
let failure
let succeeded = false
for (let attempt = 1; attempt <= attempts; attempt += 1) {
  try {
    const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(30_000) })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    if (response.body === null) throw new Error('empty response body')
    const file = await open(partial, 'wx')
    try {
      const reader = response.body.getReader()
      for (;;) {
        let timer
        const timeout = new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('no download data received for 30 seconds')), 30_000)
        })
        const chunk = await Promise.race([reader.read(), timeout]).finally(() => clearTimeout(timer))
        if (chunk.done) break
        await file.write(chunk.value)
      }
      await file.sync()
    } finally {
      await file.close()
    }
    await rename(partial, output)
    succeeded = true
    break
  } catch (error) {
    failure = error
    await unlink(partial).catch(() => undefined)
    if (attempt < attempts) await new Promise(resolve => setTimeout(resolve, attempt * 1_000))
  }
}
if (!succeeded) {
  process.stderr.write(`download-url: ${failure instanceof Error ? failure.message : String(failure)}\n`)
  process.exitCode = 1
}
