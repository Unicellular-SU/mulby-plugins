import assert from 'node:assert/strict'
import {
  buildConvertArgs,
  buildSequenceFramesArgs,
  buildSingleFrameArgs,
  buildTrimFastArgs,
  buildTrimPreciseArgs,
  clipFileName,
  convertedFileName,
  frameFileName,
  resolveCodec
} from './ffmpegArgs'

assert.equal(resolveCodec('mp4', 'h265'), 'h265')
assert.equal(resolveCodec('webm', 'h264'), 'vp9')
assert.equal(resolveCodec('gif', 'h264'), 'h264')
assert.equal(resolveCodec('mkv', 'vp9'), 'h264')

assert.deepEqual(buildConvertArgs({ input: 'a.mp4', output: 'b.mp4', container: 'mp4', codec: 'h264', quality: 'balanced' }), [
  '-y',
  '-i',
  'a.mp4',
  '-map',
  '0:v:0',
  '-map',
  '0:a?',
  '-c:v',
  'libx264',
  '-preset',
  'veryfast',
  '-crf',
  '23',
  '-pix_fmt',
  'yuv420p',
  '-c:a',
  'aac',
  '-b:a',
  '128k',
  '-movflags',
  '+faststart',
  'b.mp4'
])

assert.deepEqual(buildConvertArgs({ input: 'a.mov', output: 'b.webm', container: 'webm', codec: 'h265', quality: 'compact' }), [
  '-y',
  '-i',
  'a.mov',
  '-map',
  '0:v:0',
  '-map',
  '0:a?',
  '-c:v',
  'libvpx-vp9',
  '-crf',
  '35',
  '-b:v',
  '0',
  '-row-mt',
  '1',
  '-deadline',
  'good',
  '-cpu-used',
  '4',
  '-c:a',
  'libopus',
  '-b:a',
  '96k',
  'b.webm'
])

const gifArgs = buildConvertArgs({ input: 'a.mp4', output: 'b.gif', container: 'gif', codec: 'h264', quality: 'high' })
assert.ok(gifArgs.includes('-an'))
assert.ok(gifArgs.some((arg) => arg.startsWith('fps=12')))
assert.ok(!gifArgs.includes('-c:v'))

assert.deepEqual(buildTrimFastArgs({ input: 'in.mp4', output: 'out.mp4', startSec: 61.5, durationSec: 30 }), [
  '-y',
  '-ss',
  '00:01:01.500',
  '-i',
  'in.mp4',
  '-t',
  '00:00:30.000',
  '-map',
  '0',
  '-c',
  'copy',
  '-avoid_negative_ts',
  'make_zero',
  'out.mp4'
])

assert.deepEqual(buildTrimPreciseArgs({ input: 'in.mkv', output: 'out.mp4', startSec: 0, durationSec: 5 }), [
  '-y',
  '-ss',
  '00:00:00.000',
  '-i',
  'in.mkv',
  '-t',
  '00:00:05.000',
  '-map',
  '0:v:0',
  '-map',
  '0:a?',
  '-c:v',
  'libx264',
  '-preset',
  'veryfast',
  '-crf',
  '23',
  '-pix_fmt',
  'yuv420p',
  '-c:a',
  'aac',
  '-b:a',
  '160k',
  'out.mp4'
])

assert.deepEqual(buildSingleFrameArgs({ input: 'v.mp4', output: 'shot.png', atSec: 125.25 }), [
  '-y',
  '-ss',
  '00:02:05.250',
  '-i',
  'v.mp4',
  '-frames:v',
  '1',
  '-q:v',
  '2',
  'shot.png'
])

assert.deepEqual(buildSequenceFramesArgs({ input: 'v.mp4', pattern: 'out/f_%04d.jpg', intervalSec: 5 }), [
  '-y',
  '-i',
  'v.mp4',
  '-vf',
  'fps=0.200000',
  '-q:v',
  '2',
  'out/f_%04d.jpg'
])

assert.deepEqual(buildSequenceFramesArgs({ input: 'v.mp4', pattern: 'o/%04d.png', intervalSec: 2, startSec: 10 }), [
  '-y',
  '-ss',
  '00:00:10.000',
  '-i',
  'v.mp4',
  '-vf',
  'fps=0.500000',
  '-q:v',
  '2',
  'o/%04d.png'
])

assert.equal(convertedFileName('demo video', 'mp4'), 'demo video_converted.mp4')
assert.equal(clipFileName('demo', 3661, 3721.4, 'mov'), 'demo_clip_01-01-01-01-02-01.mov')
assert.equal(frameFileName('demo', 83, 'png'), 'demo_00-01-23.png')
