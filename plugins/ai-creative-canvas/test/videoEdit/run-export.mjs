#!/usr/bin/env node
/**
 * 集成导出测试（B12）：本机有 ffmpeg/ffprobe 时，**现场合成 fixtures**（testsrc/sine/PNG/身份 LUT），
 * **遍历 recipes.json 全部配方**，真实编译 → 跑每个 ffmpeg pass 断言 exit=0，再 ffprobe 校验
 * 输出含视频流、时长≈expect.outDuration。补齐了原来「只跑 1 条 noop」的缺口。
 * 无 ffmpeg 时优雅跳过（保持无 ffmpeg 的 CI 可移植）；缺某滤镜的配方记为 skip（打印原因，非静默）。
 * 用法：npm run test:export（会先 esbuild 出 dist/compile.mjs）。
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = process.cwd()
const work = join(root, 'dist/export-fixtures') // dist 已 gitignore，合成产物不入库
const outDir = join(work, 'out')

// 每个 ffmpeg 加超时兜底：避免某配方的 filtergraph 卡死拖住整轮（超时按失败上报，非静默）
function ff(args, timeoutMs = 90000) {
  return spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8', timeout: timeoutMs, killSignal: 'SIGKILL' })
}
function hasTools() {
  return (
    spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' }).status === 0 &&
    spawnSync('ffprobe', ['-version'], { encoding: 'utf8' }).status === 0
  )
}

// 主素材按 baseDuration 合成并缓存（关键）：单一定长主素材会让无 trim 的短配方输出被拉到 10s、
// 时长断言假失败，且重滤镜(minterpolate/tmix/boxblur)在长素材上极慢。按需给每个 duration 出一条短素材。
const mainCache = new Map()
function mainFor(durationSec) {
  const d = Math.max(1, Math.round(Number(durationSec) || 5))
  if (mainCache.has(d)) return mainCache.get(d)
  const p = join(work, `main-${d}.mp4`)
  // 640x360 降分辨率提速；testsrc2 + sine（编译器按 ctx.hasAudio 决定是否用音轨）
  ff(['-f', 'lavfi', '-i', `testsrc2=size=640x360:rate=30:duration=${d}`, '-f', 'lavfi', '-i', `sine=frequency=440:duration=${d}`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', p])
  mainCache.set(d, p)
  return p
}

// 现场合成所有配方引用到的输入素材，basename 与 recipes.json 里的路径对齐
function synthFixtures() {
  mkdirSync(work, { recursive: true })
  const F = (n) => join(work, n)
  // pip 子画面视频（无音轨）
  ff(['-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=30:duration=6', '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', F('pip.mp4')])
  // 配乐音频
  ff(['-f', 'lavfi', '-i', 'sine=frequency=330:duration=8', F('bgm.mp3')])
  // 各种 overlay PNG（RGBA，尺寸够裁即可）
  const png = (name, w, h, color) => ff(['-f', 'lavfi', '-i', `color=c=${color}:size=${w}x${h},format=rgba`, '-frames:v', '1', F(name)])
  png('overlay.png', 300, 80, 'red@0.6')
  png('wm.png', 200, 60, 'white@0.5')
  png('progress.png', 1280, 12, 'yellow@0.9')
  png('sub1.png', 600, 80, 'black@0.5')
  png('sub2.png', 600, 80, 'black@0.5')
  png('frame.png', 1280, 720, 'white@0.0') // 透明整帧边框贴图
  png('sticker.png', 120, 120, 'green@0.7')
  png('tc.png', 960, 24, 'blue@0.8') // 时间码精灵图：宽≥cellW(48)*格数，够逐格裁
  // 身份 3D LUT（.cube），供 color-lut-path 的 lut3d 用
  writeFileSync(F('cinematic.cube'), 'LUT_3D_SIZE 2\n0 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1\n')
}

// 把配方里引用 fixture 的路径字符串（png/mp4/mp3/cube…）按 basename 重指到合成产物
function remapPath(p) {
  if (typeof p !== 'string') return p
  if (!/[\\/].+\.(png|jpe?g|webp|mp4|mov|webm|mp3|wav|aac|opus|cube)$/i.test(p)) return p
  const base = p.split(/[\\/]/).pop()
  const target = join(work, base)
  return existsSync(target) ? target : p
}
function remap(obj) {
  if (Array.isArray(obj)) return obj.map(remap)
  if (obj && typeof obj === 'object') {
    const o = {}
    for (const k in obj) o[k] = remap(obj[k])
    return o
  }
  return remapPath(obj)
}

async function main() {
  if (!hasTools()) {
    console.log('ffmpeg/ffprobe not found — skip integration export test')
    return
  }
  rmSync(work, { recursive: true, force: true })
  synthFixtures()
  mkdirSync(outDir, { recursive: true })
  if (!existsSync(mainFor(3))) {
    console.error('fixture synth failed (main clip missing) — check ffmpeg lavfi/libx264')
    process.exit(1)
  }

  const { compileStack } = await import(pathToFileURL(join(root, 'dist/compile.mjs')).href)
  const recipes = JSON.parse(readFileSync(join(root, 'test/videoEdit/recipes.json'), 'utf8'))

  let pass = 0
  let skip = 0
  const fails = []
  const skips = []

  for (const rc of recipes) {
    const stack = remap(rc.stack)
    const ctx = remap(rc.ctx || {})
    let compiled
    try {
      compiled = await compileStack(
        stack,
        {
          inPath: mainFor(rc.stack?.baseDuration ?? 5),
          projectId: 'itest',
          hasAudio: ctx.hasAudio !== false,
          overlayResolved: ctx.overlayResolved,
          resolveOutPath: (_pid, _base, ext) => join(outDir, `${rc.id}.${ext}`)
        },
        rc.fallbacks ? { fallbacks: new Set(rc.fallbacks) } : undefined // 与 run-compile 一致：让 fallback 配方走退化路径
      )
    } catch (e) {
      fails.push(`${rc.id}: compile threw — ${e?.message || e}`)
      continue
    }

    let broke = false
    for (const p of compiled.passes) {
      const r = ff(p.args)
      if (r.status !== 0) {
        const err = r.stderr || r.stdout || ''
        if (r.error && (r.error.code === 'ETIMEDOUT' || r.signal === 'SIGKILL')) {
          fails.push(`${rc.id}: ffmpeg TIMEOUT (>90s) — filtergraph 可能未按主流收束（无限输入未 -t/-shortest 兜底？）`)
        } else if (/No such filter|Unknown filter|Cannot load|not found/i.test(err)) {
          skips.push(`${rc.id}: ${err.split('\n').find((l) => l.trim()) || 'missing filter'}`)
          skip++
        } else {
          fails.push(`${rc.id}: ffmpeg exit ${r.status} — ${err.split('\n').filter(Boolean).slice(-2).join(' | ')}`)
        }
        broke = true
        break
      }
    }
    if (broke) continue

    // ffprobe 最终产物：至少 1 条视频流；有 expect.outDuration 且能读出 duration 则校验（±0.6s）
    const finalOut = compiled.passes[compiled.passes.length - 1].outPath
    const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type', '-of', 'json', finalOut], { encoding: 'utf8' })
    if (probe.status !== 0) {
      fails.push(`${rc.id}: ffprobe failed on ${finalOut}`)
      continue
    }
    const meta = JSON.parse(probe.stdout || '{}')
    const vstreams = (meta.streams || []).filter((s) => s.codec_type === 'video').length
    if (vstreams < 1) {
      fails.push(`${rc.id}: output has no video stream`)
      continue
    }
    const dur = Number(meta.format?.duration)
    const exp = rc.expect?.outDuration
    if (exp != null && isFinite(dur) && Math.abs(dur - exp) > 0.6) {
      fails.push(`${rc.id}: output duration ${dur.toFixed(2)}s != expect ${exp}s (±0.6)`)
      continue
    }
    pass++
  }

  console.log(`integration export: ${pass} passed · ${skip} skipped · ${fails.length} failed (of ${recipes.length} recipes)`)
  if (skips.length) console.log('skipped (filter absent):\n  ' + skips.join('\n  '))
  if (fails.length) {
    console.error('FAILURES:\n  ' + fails.join('\n  '))
    process.exit(1)
  }
  if (pass < 1) {
    console.error('no recipe actually ran — fixture synth or compile is broken')
    process.exit(1)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
