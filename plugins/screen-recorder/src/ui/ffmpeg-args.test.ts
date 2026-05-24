import assert from 'node:assert/strict'
import { buildMp4TranscodeArgs } from './ffmpeg-args'

function assertOption(args: string[], option: string, expectedValue: string) {
  const index = args.indexOf(option)
  assert.notEqual(index, -1, `${option} should be present`)
  assert.equal(args[index + 1], expectedValue)
  assert(index > 1, `${option} should be an output option after the input`)
  assert(index < args.length - 1, `${option} should appear before the output path`)
}

function testPadsOddVideoDimensionsBeforeEncoding() {
  const args = buildMp4TranscodeArgs('input.webm', 'output.mp4')

  assert.deepEqual(args.slice(0, 2), ['-i', 'input.webm'])
  assert.equal(args.at(-1), 'output.mp4')
  assertOption(args, '-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2')
  assertOption(args, '-pix_fmt', 'yuv420p')
}

testPadsOddVideoDimensionsBeforeEncoding()
