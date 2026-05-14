import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const pluginRoot = resolve(__dirname, '..')
const styles = readFileSync(resolve(pluginRoot, 'src/ui/styles.css'), 'utf8')
const ffmpegModule = readFileSync(resolve(pluginRoot, 'src/ui/modules/FFmpeg/index.tsx'), 'utf8')

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

function getRule(selector) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = styles.match(new RegExp(`(?:^|\\n)${escapedSelector}\\s*\\{([\\s\\S]*?)\\}`))
  return match?.[1] ?? ''
}

const mainContentRule = getRule('.main-content')
assert(/min-width:\s*0/.test(mainContentRule), '.main-content must be allowed to shrink inside the app flex layout')

const pageContentRule = getRule('.page-content')
assert(/min-width:\s*0/.test(pageContentRule), '.page-content must not let result content widen the page')
assert(/overflow-x:\s*hidden/.test(pageContentRule), '.page-content must clip horizontal overflow from non-primary panels')

const cardRule = getRule('.card')
assert(/min-width:\s*0/.test(cardRule), '.card must be allowed to shrink inside grid stacks')
assert(/max-width:\s*100%/.test(cardRule), '.card must not grow wider than its parent')

const cardContentRule = getRule('.card-content')
assert(/min-width:\s*0/.test(cardContentRule), '.card-content must be allowed to shrink around result rows')

const listRowRule = getRule('.list-row')
assert(/min-width:\s*0/.test(listRowRule), '.list-row must not use long result content as its minimum width')

const listRowMetaRule = getRule('.list-row-meta')
assert(/min-width:\s*0/.test(listRowMetaRule), '.list-row-meta must shrink when result messages are long')
assert(/overflow:\s*hidden/.test(listRowMetaRule), '.list-row-meta must hide overflow instead of widening the page')
assert(/text-overflow:\s*ellipsis/.test(listRowMetaRule), '.list-row-meta must keep long result messages readable without overflow')

const statValueRule = getRule('.stat-value')
assert(/min-width:\s*0/.test(statValueRule), '.stat-value must shrink around long FFmpeg version or bitrate text')
assert(/overflow:\s*hidden/.test(statValueRule), '.stat-value must not widen cards when content is long')

const codeBlockRule = getRule('.code-block')
assert(/max-width:\s*100%/.test(codeBlockRule), '.code-block must stay within its panel')

const ffmpegStackRule = getRule('.ffmpeg-page-stack')
assert(/min-width:\s*0/.test(ffmpegStackRule), '.ffmpeg-page-stack must allow result cards to fit the plugin width')

assert(
  ffmpegModule.includes('className="ffmpeg-page-stack"'),
  'FFmpeg module must use the constrained page stack wrapper'
)
