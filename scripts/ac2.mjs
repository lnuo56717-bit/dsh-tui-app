import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sharedRepo = 'D:\\deepseek-harness'
const reportPath = join(root, '.m1-results', 'ac1.json')
const ac1 = JSON.parse(readFileSync(reportPath, 'utf8'))
const sharedStatus = execFileSync('git', ['-C', sharedRepo, 'status', '--short', '--untracked-files=all'], { encoding: 'utf8' })
const scopedDiffStat = execFileSync('git', ['-C', sharedRepo, 'diff', '--stat', '--', 'packages', 'apps/web', 'vendor'], { encoding: 'utf8' })
const dshManifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const report = {
  projectRoot: root,
  sharedRepo,
  structurallyOutOfTree: !root.toLowerCase().startsWith(sharedRepo.toLowerCase() + '\\'),
  bundlePatch: dshManifest.dsh?.bundle?.patch,
  sharedRepoUnchangedDuringAcceptance: ac1.sharedRepo?.unchanged === true,
  sharedRepoPreExistingStatus: sharedStatus.trim().split(/\r?\n/).filter(Boolean),
  sharedRepoPreExistingScopedDiffStat: scopedDiffStat.trim().split(/\r?\n/).filter(Boolean),
}
writeFileSync(join(root, '.m1-results', 'ac2.json'), JSON.stringify(report, null, 2) + '\n')
if (!report.structurallyOutOfTree || report.bundlePatch !== './cordis.patch.yml' || !report.sharedRepoUnchangedDuringAcceptance) {
  console.error(JSON.stringify(report, null, 2))
  throw new Error('AC-2 failed')
}
console.log(JSON.stringify(report, null, 2))
