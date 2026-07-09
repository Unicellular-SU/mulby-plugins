#!/usr/bin/env node
/**
 * 可选集成测试：本机有 ffmpeg 时，对 fixtures 素材真实导出一条 noop 配方。
 * 用法：先按 fixtures/README.md 生成 landscape.mp4，再 npm run test:export
 */
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = process.cwd()
const fixtures = join(root, 'test/videoEdit/fixtures')
const landscape = join(fixtures, 'landscape.mp4')

function hasFfmpeg() {
  return spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' }).status === 0
}

async function main() {
  if (!hasFfmpeg()) {
    console.log('ffmpeg not found — skip integration export test')
    return
  }
  if (!existsSync(landscape)) {
    console.error(`missing ${landscape} — see test/videoEdit/fixtures/README.md`)
    process.exit(1)
  }

  const { compileStack } = await import(pathToFileURL(join(root, 'dist/compile.mjs')).href)
  const recipes = JSON.parse(readFileSync(join(root, 'test/videoEdit/recipes.json'), 'utf8'))
  const sample = recipes.find((r) => r.id === 'noop-empty')
  if (!sample) throw new Error('noop-empty recipe missing')

  const outPath = join(fixtures, 'out-integration.mp4')
  const compiled = await compileStack(sample.stack, {
    inPath: landscape,
    projectId: 'integration-test',
    hasAudio: true,
    resolveOutPath: (_p, _b, ext) => join(fixtures, `out-integration.${ext}`)
  })

  const ffArgs = compiled.passes[0].args
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', ...ffArgs], { encoding: 'utf8' })
  if (r.status !== 0) {
    console.error(r.stderr || r.stdout)
    process.exit(1)
  }
  console.log('integration export OK:', outPath)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
