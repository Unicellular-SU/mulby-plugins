import sharp from 'sharp'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const svg = join(root, 'assets', 'icon.svg')
const out = join(root, 'icon.png')

await sharp(svg).resize(512, 512).png({ compressionLevel: 9 }).toFile(out)
console.log('Wrote', out, '(512×512)')
