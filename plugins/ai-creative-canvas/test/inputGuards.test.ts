import assert from 'node:assert/strict'
import {
  MAX_REMOTE_MEDIA_BYTES,
  MAX_AI_IMAGE_ARTIFACTS,
  MAX_LOCAL_IMPORT_FILES,
  MAX_TEXT_IMPORT_BYTES,
  MAX_UPLOAD_IMAGE_BYTES,
  aiImageArtifactExtension,
  decodedBase64ByteLength,
  isLegacyImageResultTooLarge,
  isTextImportName,
  localImportExtension,
  localImportMime,
  normalizeAiAttachmentId,
  normalizeRemoteHttpUrl
} from '../src/backendGuards.ts'
import { extensionOf, guessMimeByExt, isSupportedImportMime, kindForMime, normalizeOpenDialogPaths, parseDroppedPathText, parseDroppedPlainPathText, resolveImportMime } from '../src/ui/services/importMediaTypes.ts'

function testImportMimeFallbacks() {
  assert.equal(resolveImportMime('clip.MOV', ''), 'video/quicktime')
  assert.equal(resolveImportMime('voice.opus', 'application/octet-stream'), 'audio/opus')
  assert.equal(resolveImportMime('movie.mp4', 'video/custom'), 'video/custom', '明确 MIME 优先于扩展名')
  assert.equal(guessMimeByExt('.jpg'), 'image/jpeg')
  assert.equal(extensionOf('/tmp/archive.name.WEBM'), 'webm')
  assert.equal(kindForMime(resolveImportMime('clip.mov')), 'video')
  assert.equal(kindForMime(resolveImportMime('voice.aac')), 'audio')
  assert.equal(kindForMime(resolveImportMime('notes.json')), 'text')
  assert.equal(resolveImportMime('music.m4a'), 'audio/mp4')
  assert.equal(localImportExtension('C:\\素材\\镜头.Final.MP4'), 'mp4')
  assert.equal(localImportMime('/tmp/notes.md'), 'text/markdown')
  assert.equal(isTextImportName('/tmp/subtitle.srt'), true)
  assert.equal(localImportMime('/tmp/subtitle.vtt'), 'text/vtt')
  assert.equal(kindForMime(resolveImportMime('subtitle.vtt')), 'text')
  assert.equal(isSupportedImportMime('text/vtt'), true)
  assert.equal(localImportMime('/tmp/archive.zip'), '')
  assert.equal(isSupportedImportMime('application/pdf'), false)
  assert.equal(isSupportedImportMime('image/avif'), true)
}

function testDroppedPathParsing() {
  assert.deepEqual(
    parseDroppedPathText('# comment\nfile:///Users/demo/My%20Shot.mp4\nfile:///C:/Media/a.png'),
    ['/Users/demo/My Shot.mp4', 'C:/Media/a.png']
  )
  assert.deepEqual(parseDroppedPathText('/tmp/a.png\n\n/tmp/b.mp3'), ['/tmp/a.png', '/tmp/b.mp3'])
  assert.deepEqual(parseDroppedPlainPathText('网页里的一段普通文字\n/tmp/a.png\nC:\\Media\\b.mp4'), ['/tmp/a.png', 'C:\\Media\\b.mp4'])
  assert.deepEqual(
    normalizeOpenDialogPaths([
      '/tmp/a.png',
      { path: '/tmp/b.mp4' },
      { filePath: 'C:\\Media\\voice.mp3' },
      { filePaths: [{ path: '/tmp/c.txt' }] },
      { data: { files: [{ fullPath: '/tmp/nested.mov' }] } },
      { url: 'file:///Users/demo/My%20Shot.webp' }
    ]),
    ['/tmp/a.png', '/tmp/b.mp4', 'C:\\Media\\voice.mp3', '/tmp/c.txt', '/tmp/nested.mov', '/Users/demo/My Shot.webp']
  )
  assert.deepEqual(normalizeOpenDialogPaths({ canceled: true, filePaths: ['/tmp/ignored.png'] }), [])
}

function testRemoteUrlBoundary() {
  assert.equal(normalizeRemoteHttpUrl('https://cdn.test/a.png'), 'https://cdn.test/a.png')
  assert.equal(normalizeRemoteHttpUrl('http://127.0.0.1:9000/upload'), 'http://127.0.0.1:9000/upload')
  assert.throws(() => normalizeRemoteHttpUrl('data:image/png;base64,AA=='), /仅支持 http\/https/)
  assert.throws(() => normalizeRemoteHttpUrl('file:///tmp/a.png'), /仅支持 http\/https/)
  assert.throws(() => normalizeRemoteHttpUrl('https://user:pass@example.com/a'), /账号或密码/)
  assert.throws(() => normalizeRemoteHttpUrl('not a url'), /不是有效 URL/)
}

function testSizeGuards() {
  assert.equal(decodedBase64ByteLength('TQ=='), 1)
  assert.equal(decodedBase64ByteLength('TWE='), 2)
  assert.equal(decodedBase64ByteLength('TWFu'), 3)
  assert.equal(MAX_REMOTE_MEDIA_BYTES, 256 * 1024 * 1024)
  assert.equal(MAX_UPLOAD_IMAGE_BYTES, 50 * 1024 * 1024)
  assert.equal(MAX_LOCAL_IMPORT_FILES, 64)
  assert.equal(MAX_TEXT_IMPORT_BYTES, 5 * 1024 * 1024)
}

function testAiImageArtifactGuards() {
  assert.equal(normalizeAiAttachmentId('550e8400-e29b-41d4-a716-446655440000'), '550e8400-e29b-41d4-a716-446655440000')
  assert.equal(normalizeAiAttachmentId('../ai/attachments/secret'), '')
  assert.equal(normalizeAiAttachmentId('short'), '')
  assert.equal(aiImageArtifactExtension('image/PNG'), 'png')
  assert.equal(aiImageArtifactExtension('image/jpeg'), 'jpg')
  assert.equal(aiImageArtifactExtension('image/svg+xml'), '')
  assert.equal(MAX_AI_IMAGE_ARTIFACTS, 4)
  assert.equal(isLegacyImageResultTooLarge(Object.assign(new Error('opaque'), { code: 'legacy_result_too_large' })), true)
  assert.equal(isLegacyImageResultTooLarge(new Error('Legacy Base64 image result exceeds the compatibility size limit')), true)
  assert.equal(isLegacyImageResultTooLarge('Legacy Base64 image result exceeds the compatibility size limit'), true)
  assert.equal(isLegacyImageResultTooLarge(new Error('provider failed')), false)
}

testImportMimeFallbacks()
testDroppedPathParsing()
testRemoteUrlBoundary()
testSizeGuards()
testAiImageArtifactGuards()
console.log('input/backend guards: 49 assertions OK')
