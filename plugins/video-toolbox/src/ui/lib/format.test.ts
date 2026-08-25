import assert from 'node:assert/strict'
import {
  base64ToArrayBuffer,
  clamp,
  computePercent,
  formatBytes,
  formatClock,
  formatFileStamp,
  formatFfmpegTime,
  parseFfmpegTime,
  pathToResourceUrl,
  splitPath
} from './format'

assert.equal(clamp(5, 0, 3), 3)
assert.equal(clamp(-1, 0, 3), 0)

assert.equal(formatClock(0), '0:00')
assert.equal(formatClock(59.9), '0:59')
assert.equal(formatClock(61), '1:01')
assert.equal(formatClock(3661), '1:01:01')

assert.equal(formatFfmpegTime(0), '00:00:00.000')
assert.equal(formatFfmpegTime(61.5), '00:01:01.500')
assert.equal(formatFfmpegTime(3723.456), '01:02:03.456')
assert.equal(formatFfmpegTime(-4), '00:00:00.000')

assert.equal(parseFfmpegTime('00:01:01.500'), 61.5)
assert.equal(parseFfmpegTime('02:30'), 150)
assert.ok(Number.isNaN(parseFfmpegTime(undefined)))
assert.ok(Number.isNaN(parseFfmpegTime('abc')))

assert.equal(formatFileStamp(3661), '01-01-01')
assert.equal(formatBytes(null), '—')
assert.equal(formatBytes(512), '512 B')
assert.equal(formatBytes(2048), '2.00 KB')
assert.equal(formatBytes(5 * 1024 * 1024), '5.00 MB')

assert.deepEqual(splitPath('/a/b/clip.mp4'), { dir: '/a/b', name: 'clip.mp4', stem: 'clip', ext: 'mp4' })
assert.deepEqual(splitPath('/a/b/noext'), { dir: '/a/b', name: 'noext', stem: 'noext', ext: '' })
assert.deepEqual(splitPath('/a/b/.hidden'), { dir: '/a/b', name: '.hidden', stem: '.hidden', ext: '' })

assert.equal(pathToResourceUrl('/tmp/my video/a#b.mp4'), 'file:///tmp/my%20video/a%23b.mp4')

const buffer = base64ToArrayBuffer('aGk=')
assert.equal(buffer.byteLength, 2)

assert.equal(computePercent(50, undefined, 100), 50)
assert.equal(computePercent(50, 80, 100), 80)
assert.equal(computePercent(null, undefined, 100), 0)
assert.equal(computePercent(999, undefined, 100), 99.5)
