/**
 * composeGate 自测（esbuild 打包到 node 跑）：
 *   npx esbuild src/ui/services/quality/composeGate.selftest.ts --bundle --platform=node --format=esm --outfile=dist/_selftest.mjs && node dist/_selftest.mjs
 */
import { evaluateComposeGate, auditComposed, projectToCuts } from './composeGate'
import type { ProjectDoc, Storyboard, Clip, VideoTrack, ProjectMeta } from '../../domain/types'

let failures = 0
function check(name: string, cond: boolean, detail: string) {
  if (cond) console.log(`  ✓ ${name}`)
  else { failures += 1; console.error(`  ✗ ${name} — ${detail}`) }
}

function sb(p: Partial<Storyboard> & { id: string; index: number }): Storyboard {
  return { track: 't', videoDesc: '', duration: 4, associateAssetIds: [], shouldGenerateImage: true, state: 'done', ...p }
}
function makeDoc(p: { meta?: Partial<ProjectMeta>; storyboards: Storyboard[]; clips?: Clip[]; track?: VideoTrack[] }): ProjectDoc {
  return {
    meta: { id: 'p', name: 'film', artStyle: 'cinematic-real', videoRatio: '16:9', videoModel: 'fal:x', createdAt: 0, updatedAt: 0, ...p.meta },
    novel: [], scripts: [], assets: [], storyboards: p.storyboards, clips: p.clips ?? [], track: p.track ?? [], memory: [],
  }
}

// 1) 健康 + 全部有视频 → 不阻断
const goodShots: Storyboard[] = [
  sb({ id: 's1', index: 1, shotSize: 'wide', cameraMove: 'static', videoDesc: '清晨山谷薄雾，远处炊烟', sceneId: 'a' }),
  sb({ id: 's2', index: 2, shotSize: 'medium', cameraMove: '推', videoDesc: '少年推门走进院子', sceneId: 'a' }),
  sb({ id: 's3', index: 3, shotSize: 'close', cameraMove: '摇', videoDesc: '手指拂过旧照片', sceneId: 'b' }),
  sb({ id: 's4', index: 4, shotSize: 'full', cameraMove: '移/跟', videoDesc: '跟随穿过长廊', sceneId: 'b' }),
  sb({ id: 's5', index: 5, shotSize: 'extreme-close', cameraMove: '升降', videoDesc: '水滴砸进水缸', sceneId: 'c', duration: 6 }),
]
const goodClips: Clip[] = goodShots.map((s) => ({ id: `c_${s.id}`, storyboardId: s.id, durationSec: 4, state: 'done' as const, videoFilePath: `C:/v/${s.id}.mp4` }))
const goodTrack: VideoTrack[] = goodShots.map((s, i) => ({ id: `t_${s.id}`, storyboardIds: [s.id], clipIds: [`c_${s.id}`], selectClipId: `c_${s.id}`, order: i }))
const gGood = evaluateComposeGate(makeDoc({ storyboards: goodShots, clips: goodClips, track: goodTrack }))
console.log(`good → ${gGood.summary}`)
check('健康全视频 不阻断', !gGood.blocked, `blocked=${gGood.blocked}; blocks=${gGood.blocks.join('|')}`)
check('健康 promiseKind=motion_led', gGood.promiseKind === 'motion_led', gGood.promiseKind)
check('健康 delivery ok', gGood.delivery.ok, 'delivery not ok')

// 2) 同质 + 无任何视频（motion_led）→ 阻断（交付 high + 幻灯片 fail）
const badShots: Storyboard[] = Array.from({ length: 6 }, (_, i) =>
  sb({ id: `b${i}`, index: i + 1, shotSize: 'medium', cameraMove: 'static', videoDesc: '一个人站在一个场景里，很美', sceneId: 'a', keyframeImageId: `k${i}` })
)
const gBad = evaluateComposeGate(makeDoc({ storyboards: badShots })) // 无 clips/track
console.log(`bad → ${gBad.summary}; blocks=${gBad.blocks.length}`)
check('同质无视频 阻断', gBad.blocked, `blocked=${gBad.blocked}`)
check('阻断含交付承诺项', gBad.blocks.some((b) => b.includes('交付承诺')), gBad.blocks.join('|'))
check('阻断含幻灯片项', gBad.blocks.some((b) => b.includes('幻灯片')), gBad.blocks.join('|'))

// 3) projectToCuts：有 done 视频=motion；仅关键帧=still
const cuts = projectToCuts(makeDoc({ storyboards: badShots }))
check('无视频仅关键帧 → still', cuts.every((c) => c.kind === 'image' && !c.hasVideo), JSON.stringify(cuts[0]))
const cutsGood = projectToCuts(makeDoc({ storyboards: goodShots, clips: goodClips, track: goodTrack }))
check('有 done 视频 → hasVideo', cutsGood.every((c) => c.hasVideo), JSON.stringify(cutsGood[0]))

// 4) auditComposed：计划 10 实际 4（motion_led）→ 静默降级
const auditDoc = makeDoc({ storyboards: Array.from({ length: 10 }, (_, i) => sb({ id: `a${i}`, index: i + 1 })) })
const audit = auditComposed(auditDoc, 4, 'motion_led')
console.log(`audit → ${audit.message}`)
check('审计 dropped=6', audit.droppedShots === 6, `${audit.droppedShots}`)
check('审计 静默降级', audit.silentDowngrade, `silent=${audit.silentDowngrade}`)
const auditOk = auditComposed(auditDoc, 10, 'motion_led')
check('全合成 不降级', !auditOk.silentDowngrade && auditOk.droppedShots === 0, `${auditOk.message}`)

if (failures) { console.error(`\ncomposeGate selftest: ${failures} FAILED`); process.exit(1) }
else console.log('\ncomposeGate selftest: ALL PASSED')
