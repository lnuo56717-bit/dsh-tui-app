import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Harness 0.1.6-alpha.1 migrates ~/.dsh/.credentials.yaml to a versioned
 * `refs:` document. The machine's daily 0.1.0-rc.5 launcher still reads the
 * pre-release flat layout and rejects a numeric `version` key. After an
 * alpha-host real-profile run, flatten the file back so the daily driver boots.
 */
const path = join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), '.credentials.yaml')
if (!existsSync(path)) {
  console.log(JSON.stringify({ path, restored: false, reason: 'missing' }))
  process.exit(0)
}

const raw = readFileSync(path, 'utf8')
const lines = raw.split(/\r?\n/)
const hasVersion = lines.some(line => /^version\s*:/.test(line))
const hasRefs = lines.some(line => /^refs\s*:/.test(line))
if (!hasVersion || !hasRefs) {
  console.log(JSON.stringify({ path, restored: false, reason: 'already-flat' }))
  process.exit(0)
}

const backup = `${path}.pre-alpha-v3`
if (!existsSync(backup)) copyFileSync(path, backup)

const restored = []
let inRefs = false
for (const line of lines) {
  if (/^version\s*:/.test(line)) continue
  if (/^refs\s*:/.test(line)) { inRefs = true; continue }
  if (inRefs) {
    if (line.startsWith('  ')) restored.push(line.slice(2))
    else if (line.trim() === '') restored.push(line)
    else inRefs = false
  } else {
    restored.push(line)
  }
}
let text = restored.join('\n')
if (raw.endsWith('\n') && !text.endsWith('\n')) text += '\n'
writeFileSync(path, text, 'utf8')
console.log(JSON.stringify({ path, restored: true, backup }))
