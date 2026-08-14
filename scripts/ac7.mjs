import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const results = join(root, '.m4-results')
mkdirSync(results, { recursive: true })
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const provenance = readFileSync(join(root, 'PROVENANCE.md'), 'utf8')
const tables = [pkg.dependencies ?? {}, pkg.devDependencies ?? {}, pkg.peerDependencies ?? {}]
const dsh = Object.entries(Object.assign({}, ...tables)).filter(([name]) => name.startsWith('@deepseek-ai/dsh-'))
const badVersions = dsh.filter(([, version]) => version !== '0.1.0-rc.6')
const missingIntegrity = dsh.filter(([name]) => !provenance.includes(`| \`${name}\` | \`0.1.0-rc.6\` | \`sha512-`))
const report = {
  directDshDependencies: dsh.map(([name, version]) => ({ name, version })),
  allExactRc6: badVersions.length === 0,
  allHaveSha512: missingIntegrity.length === 0,
  sourceAnchor: provenance.includes('47f943859bef60e4160492346772ded9b24f765a'),
  uxAnchor: provenance.includes('eb267feff13129e568df38fb6fdf0ceb65f735d6'),
  contractTable: provenance.includes('## 3. Contract cross-check'),
}
writeFileSync(join(results, 'ac7.json'), JSON.stringify(report, null, 2) + '\n')
if (!report.allExactRc6 || !report.allHaveSha512 || !report.sourceAnchor || !report.uxAnchor || !report.contractTable) {
  console.error(JSON.stringify(report, null, 2))
  process.exit(1)
}
console.log(JSON.stringify(report, null, 2))
