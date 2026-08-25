import { cleanAssetAliases, findAssetByNameOrAlias, mergeAssetAliases } from './assetAliases'
import type { Asset } from './types'

let failures = 0

function check(name: string, condition: boolean, detail: string) {
  if (condition) console.log(`  OK ${name}`)
  else {
    failures += 1
    console.error(`  FAIL ${name}: ${detail}`)
  }
}

const cleaned = cleanAssetAliases('队长、 Captain,队长\n主角')
check('cleans split and deduped aliases', cleaned.join('|') === '队长|Captain|主角', JSON.stringify(cleaned))

const merged = mergeAssetAliases(['队长', '主角'], ['Captain', '队长', '  '])
check('merges incoming aliases without dropping existing aliases', merged.join('|') === '队长|主角|Captain', JSON.stringify(merged))

const assets: Asset[] = [{ id: 'hero', type: 'role', name: 'Hero', aliases: merged, state: 'done' }]
check('merged aliases remain searchable', findAssetByNameOrAlias(assets, 'captain')?.id === 'hero' && findAssetByNameOrAlias(assets, '主角')?.id === 'hero', JSON.stringify(assets))

if (failures) {
  console.error(`\nassetAliases selftest: ${failures} FAILED`)
  process.exit(1)
}

console.log('\nassetAliases selftest: ALL PASSED')
