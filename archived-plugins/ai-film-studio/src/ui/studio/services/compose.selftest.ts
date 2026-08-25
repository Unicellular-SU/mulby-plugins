import { composeProject } from './compose'
import type { ProjectDoc, ProjectMeta, Storyboard } from '../../domain/types'

let failures = 0

function check(name: string, condition: boolean, detail: string) {
  if (condition) console.log(`  OK ${name}`)
  else {
    failures += 1
    console.error(`  FAIL ${name}: ${detail}`)
  }
}

interface MockRuntime {
  downloadOk?: boolean
  downloadPath?: string
  downloadError?: string
  missingPaths?: Set<string>
}

function installMockRuntime(opts: MockRuntime = {}) {
  const hostCalls: unknown[] = []
  const runArgs: string[][] = []
  const runtime = globalThis as unknown as { window: { mulby: unknown } }
  runtime.window = {
    mulby: {
      ffmpeg: {
        isAvailable: async () => true,
        download: async () => ({ success: true }),
        run: (args: string[]) => {
          runArgs.push(args)
          return { promise: Promise.resolve(), kill: () => {} }
        },
      },
      host: {
        call: async (...args: unknown[]) => {
          hostCalls.push(args)
          if (opts.downloadOk) return { data: { ok: true, path: opts.downloadPath ?? 'D:/tmp/downloaded.mp4' } }
          return { data: { ok: false, error: opts.downloadError ?? 'download failed' } }
        },
      },
      system: { getPath: async () => 'D:/tmp' },
      filesystem: {
        exists: async (path: string) => !opts.missingPaths?.has(path),
        mkdir: async () => {},
        writeFile: async () => {},
        readFile: async () => '',
      },
    },
  }
  return { hostCalls, runArgs }
}

function meta(): ProjectMeta {
  return { id: 'p1', name: 'compose', artStyle: 'cinematic', videoRatio: '16:9', createdAt: 0, updatedAt: 0 }
}

function storyboard(id: string, index: number, patch: Partial<Storyboard> = {}): Storyboard {
  return {
    id,
    index,
    track: 'main',
    videoDesc: `shot ${index + 1}`,
    duration: 4,
    associateAssetIds: [],
    shouldGenerateImage: true,
    state: 'done',
    ...patch,
  }
}

function docForCompose(patch: Partial<ProjectDoc>): ProjectDoc {
  return {
    meta: meta(),
    novel: [],
    scripts: [],
    assets: [],
    storyboards: [],
    clips: [],
    track: [],
    memory: [],
    ...patch,
  }
}

const failedRuntime = installMockRuntime({ downloadError: 'download failed' })
const failedDoc = docForCompose({
  storyboards: [storyboard('sb1', 0), storyboard('sb2', 1)],
  clips: [
    { id: 'clip1', storyboardId: 'sb1', durationSec: 4, state: 'done', videoFilePath: 'D:/tmp/clip1.mp4' },
    { id: 'clip2', storyboardId: 'sb2', durationSec: 4, state: 'done', videoUrl: 'https://example.test/missing.mp4' },
  ],
  track: [
    { id: 't1', storyboardIds: ['sb1'], clipIds: ['clip1'], selectClipId: 'clip1', order: 0 },
    { id: 't2', storyboardIds: ['sb2'], clipIds: ['clip2'], selectClipId: 'clip2', order: 1 },
  ],
})

let failedMessage = ''
try {
  await composeProject(failedDoc)
} catch (e) {
  failedMessage = e instanceof Error ? e.message : String(e)
}
check('fails composition instead of dropping a storyboard when remote clip download fails', failedMessage.includes('#2') && failedMessage.includes('download failed'), failedMessage)
check('does not start ffmpeg after clip preparation failure', failedRuntime.runArgs.length === 0, JSON.stringify(failedRuntime.runArgs))

const stalePath = 'D:/tmp/stale.mp4'
const refreshedPath = 'D:/tmp/downloaded.mp4'
const refreshedRuntime = installMockRuntime({ downloadOk: true, downloadPath: refreshedPath, missingPaths: new Set([stalePath]) })
const refreshedDoc = docForCompose({
  storyboards: [storyboard('sb1', 0)],
  clips: [{ id: 'clip1', storyboardId: 'sb1', durationSec: 4, state: 'done', videoFilePath: stalePath, videoUrl: 'https://example.test/clip.mp4' }],
  track: [{ id: 't1', storyboardIds: ['sb1'], clipIds: ['clip1'], selectClipId: 'clip1', order: 0 }],
})

const outPath = await composeProject(refreshedDoc)
const composeArgs = refreshedRuntime.runArgs.find((args) => args.includes('-filter_complex')) ?? []
check('redownloads a clip when the persisted local path is missing', refreshedRuntime.hostCalls.length === 1 && composeArgs.includes(refreshedPath), JSON.stringify({ hostCalls: refreshedRuntime.hostCalls.length, composeArgs }))
check('does not pass stale local paths into ffmpeg', !composeArgs.includes(stalePath), JSON.stringify(composeArgs))
check('returns an export path after composing refreshed clips', outPath.includes('exports'), outPath)

if (failures) {
  console.error(`\ncompose selftest: ${failures} FAILED`)
  process.exit(1)
}

console.log('\ncompose selftest: ALL PASSED')
