import { existsSync, unlinkSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const obsolete = [
  join(root, 'lib', 'browser-control.js'),
  join(root, 'lib', 'types', 'browser-control.d.ts'),
  join(root, 'lib', 'ui', 'browser-center.js'),
  join(root, 'lib', 'types', 'ui', 'browser-center.d.ts'),
]

for (const path of obsolete) {
  if (existsSync(path)) unlinkSync(path)
}
