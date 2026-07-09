import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildAtempoChain, compileStack, stackOutDuration } from '../../src/ui/services/videoEdit/compile.ts'
import type { EditStack } from '../../src/ui/services/videoEdit/types.ts'

const recipes = JSON.parse(readFileSync(join(process.cwd(), 'test/videoEdit/recipes.json'), 'utf8')) as RecipeCase[]

interface RecipeCase {
  id: string
  stack: EditStack
  ctx: {
    hasAudio: boolean
    inPath?: string
    projectId?: string
    overlayResolved?: Record<string, unknown>
  }
  fallbacks?: string[]
  expect: {
    outDuration?: number
    passCount?: number
    hasFilterComplex?: boolean
    filterContains?: string[]
    filterNotContains?: string[]
    argsContains?: string[]
  }
}

const IN_PATH = '/test/fixtures/landscape.mp4'
const PROJECT_ID = 'test-proj'

function stableOutPath(_pid: string, base: string, ext: string): string {
  return `/test/out/${base}.${ext}`
}

function normalizeCompiled(compiled: Awaited<ReturnType<typeof compileStack>>) {
  return {
    passCount: compiled.passes.length,
    outDuration: compiled.outDuration,
    passes: compiled.passes.map((p) => ({
      outPath: p.outPath.replace(/\\/g, '/'),
      args: p.args.map((a) => a.replace(/\\/g, '/'))
    })),
    cleanup: compiled.cleanup.map((p) => p.replace(/\\/g, '/'))
  }
}

function filterComplexOf(args: string[]): string {
  const i = args.indexOf('-filter_complex')
  return i >= 0 ? args[i + 1] : ''
}

function allArgs(compiled: Awaited<ReturnType<typeof compileStack>>): string {
  return compiled.passes.flatMap((p) => p.args).join(' ')
}

function testBuildAtempoChain() {
  assert.equal(buildAtempoChain(1), 'atempo=1.0000')
  assert.equal(buildAtempoChain(2), 'atempo=2.0000')
  assert.equal(buildAtempoChain(0.25), 'atempo=0.5000,atempo=0.5000')
  assert.equal(buildAtempoChain(4), 'atempo=2.0000,atempo=2.0000')
}

function testStackOutDurationTrimSpeed() {
  const stack: EditStack = {
    version: 1,
    baseDuration: 10,
    baseW: 1920,
    baseH: 1080,
    ops: [
      {
        id: 't',
        kind: 'trim',
        enabled: true,
        params: {
          segments: [
            { in: 0, out: 3, keep: true },
            { in: 3, out: 7, keep: false },
            { in: 7, out: 10, keep: true }
          ]
        }
      },
      { id: 's', kind: 'speed', enabled: true, params: { rate: 2, reverse: false, pitchCompensate: true } },
      { id: 'e', kind: 'export', enabled: true, params: { format: 'mp4', crf: 23 } }
    ]
  }
  assert.equal(stackOutDuration(stack), 3)
}

async function runRecipeCase(c: RecipeCase) {
  const compiled = await compileStack(
    c.stack,
    {
      inPath: c.ctx.inPath || IN_PATH,
      projectId: c.ctx.projectId || PROJECT_ID,
      hasAudio: c.ctx.hasAudio,
      overlayResolved: c.ctx.overlayResolved as never,
      resolveOutPath: stableOutPath
    },
    c.fallbacks ? { fallbacks: new Set(c.fallbacks) } : undefined
  )

  const norm = normalizeCompiled(compiled)
  const fc = filterComplexOf(compiled.passes[0]?.args || [])
  const argsStr = allArgs(compiled)
  const exp = c.expect

  if (exp.outDuration != null) {
    assert.ok(Math.abs(compiled.outDuration - exp.outDuration) < 0.01, `${c.id}: outDuration ${compiled.outDuration} != ${exp.outDuration}`)
  }
  if (exp.passCount != null) assert.equal(norm.passCount, exp.passCount, `${c.id}: passCount`)
  if (exp.hasFilterComplex === false) assert.equal(fc, '', `${c.id}: should have no filter_complex`)
  for (const needle of exp.filterContains || []) {
    assert.ok(fc.includes(needle), `${c.id}: filter_complex missing "${needle}"\n${fc}`)
  }
  for (const needle of exp.filterNotContains || []) {
    assert.ok(!fc.includes(needle), `${c.id}: filter_complex should not contain "${needle}"`)
  }
  for (const needle of exp.argsContains || []) {
    assert.ok(argsStr.includes(needle), `${c.id}: args missing "${needle}"`)
  }

  return norm
}

async function testAllRecipes() {
  const snapshots: Record<string, unknown> = {}
  for (const c of recipes) {
    snapshots[c.id] = await runRecipeCase(c)
  }
  // 快照：首次运行写入；后续对比（路径已归一化，输出 deterministic）
  const snapPath = join(process.cwd(), 'test/videoEdit/snapshots.json')
  try {
    const prev = JSON.parse(readFileSync(snapPath, 'utf8'))
    assert.deepEqual(snapshots, prev, 'compile snapshots mismatch — run with UPDATE_SNAPSHOTS=1 to refresh')
  } catch (e: any) {
    if (process.env.UPDATE_SNAPSHOTS === '1' || e?.code === 'ENOENT') {
      const { writeFileSync } = await import('node:fs')
      writeFileSync(snapPath, JSON.stringify(snapshots, null, 2) + '\n')
      if (e?.code !== 'ENOENT') console.log('snapshots updated')
    } else {
      throw e
    }
  }
  assert.ok(recipes.length >= 25, `expected >= 25 recipes, got ${recipes.length}`)
}

async function main() {
  testBuildAtempoChain()
  testStackOutDurationTrimSpeed()
  await testAllRecipes()
  console.log(`videoEdit compile: ${recipes.length} recipes OK`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
