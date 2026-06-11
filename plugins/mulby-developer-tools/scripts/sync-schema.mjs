/**
 * 同步 manifest-schema.json（最佳努力）。
 *
 * 唯一真相源是宿主 CLI 资产 `mulby/packages/mulby-cli/assets/manifest-schema.json`。
 * 本脚本在「同级 mulby 仓库存在」时把它复制到插件内的 `src/shared/manifest-schema.json`，
 * 让后端 check_conformance 能离线 bundle 一份用于 AJV 校验，同时插件打包后仍然自包含。
 *
 * 设计要点：
 * - 找不到源（独立分发场景）时静默跳过，绝不让构建失败（committed 副本即兜底）。
 * - 仅在内容有变化时写入，避免每次构建都产生无谓 git diff。
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const target = resolve(root, 'src/shared/manifest-schema.json')

// 同级仓库布局：mulby-all/{mulby,mulby-plugins/plugins/<plugin>}
const candidates = [
  resolve(root, '../../../mulby/packages/mulby-cli/assets/manifest-schema.json'),
  resolve(root, '../../../../mulby/packages/mulby-cli/assets/manifest-schema.json')
]

const source = candidates.find((p) => existsSync(p))
if (!source) {
  console.log('[sync-schema] 未找到同级 mulby CLI schema 源，跳过（使用已提交的副本）')
  process.exit(0)
}

try {
  const next = readFileSync(source, 'utf-8')
  const prev = existsSync(target) ? readFileSync(target, 'utf-8') : ''
  if (next === prev) {
    console.log('[sync-schema] schema 已是最新，无需更新')
    process.exit(0)
  }
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, next, 'utf-8')
  console.log(`[sync-schema] 已更新 schema 副本 ← ${source}`)
} catch (e) {
  console.warn(`[sync-schema] 同步失败（使用已提交的副本）：${e instanceof Error ? e.message : e}`)
  process.exit(0)
}
