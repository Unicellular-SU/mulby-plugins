// 安全核心：AES-256-GCM 分帧加密。覆盖往返一致性、流式分块边界，
// 以及所有「必须解密失败」的篡改场景（密文/tag/key/AAD/帧序/超长帧/截断）。

import { describe, it, expect } from 'vitest'
import * as crypto from 'node:crypto'
import { FrameEncryptor, FrameDecryptor } from './cipher'

const KEY = crypto.createHash('sha256').update('test-key').digest() // 32 字节
const AAD = Buffer.from('transfer-id-xyz')

function enc(key = KEY, aad = AAD): FrameEncryptor {
  return new FrameEncryptor(key, aad)
}
function dec(key = KEY, aad = AAD): FrameDecryptor {
  return new FrameDecryptor(key, aad)
}

describe('round-trip', () => {
  it('encrypts then decrypts multiple chunks back to the original plaintext', () => {
    const e = enc()
    const chunks = [Buffer.from('hello '), Buffer.from('lan'), Buffer.from('drop!')]
    const frames = chunks.map((c) => e.encrypt(c))

    const d = dec()
    const out: Buffer[] = []
    for (const f of frames) out.push(...d.push(f))
    expect(d.pending).toBe(0)
    expect(Buffer.concat(out).toString()).toBe('hello landrop!')
  })

  it('handles an empty plaintext frame', () => {
    const e = enc()
    const frame = e.encrypt(Buffer.alloc(0))
    const d = dec()
    const out = d.push(frame)
    expect(d.pending).toBe(0)
    expect(Buffer.concat(out).length).toBe(0)
  })

  it('round-trips a large random payload across many frames', () => {
    const e = enc()
    const total = crypto.randomBytes(256 * 1024)
    const frames: Buffer[] = []
    for (let off = 0; off < total.length; off += 64 * 1024) {
      frames.push(e.encrypt(total.subarray(off, off + 64 * 1024)))
    }
    const d = dec()
    const out: Buffer[] = []
    for (const f of frames) out.push(...d.push(f))
    expect(d.pending).toBe(0)
    expect(Buffer.concat(out).equals(total)).toBe(true)
  })
})

describe('streaming reassembly', () => {
  it('decodes correctly when bytes are split at arbitrary boundaries', () => {
    const e = enc()
    const payload = Buffer.from('the quick brown fox jumps over the lazy dog')
    const stream = Buffer.concat([e.encrypt(payload.subarray(0, 10)), e.encrypt(payload.subarray(10))])

    const d = dec()
    const out: Buffer[] = []
    // 每次只喂 1 字节，强制跨多次 push 才能凑齐一帧。
    for (const byte of stream) out.push(...d.push(Buffer.from([byte])))
    expect(d.pending).toBe(0)
    expect(Buffer.concat(out).equals(payload)).toBe(true)
  })

  it('reports pending > 0 when the trailing frame is truncated', () => {
    const e = enc()
    const frame = e.encrypt(Buffer.from('incomplete'))
    const d = dec()
    const out = d.push(frame.subarray(0, frame.length - 3)) // 砍掉尾部 3 字节
    expect(out.length).toBe(0)
    expect(d.pending).toBeGreaterThan(0)
  })
})

describe('tamper resistance', () => {
  it('throws when a ciphertext byte is flipped', () => {
    const e = enc()
    const frame = e.encrypt(Buffer.from('secret payload'))
    frame[6] ^= 0xff // 翻转密文区某字节
    const d = dec()
    expect(() => d.push(frame)).toThrow()
  })

  it('throws when the GCM tag is tampered', () => {
    const e = enc()
    const frame = e.encrypt(Buffer.from('secret payload'))
    frame[frame.length - 1] ^= 0x01 // 翻转 tag 末字节
    const d = dec()
    expect(() => d.push(frame)).toThrow()
  })

  it('throws when decrypting with the wrong key', () => {
    const frame = enc().encrypt(Buffer.from('secret payload'))
    const wrong = dec(crypto.createHash('sha256').update('other-key').digest())
    expect(() => wrong.push(frame)).toThrow()
  })

  it('throws when the AAD (transferId binding) differs — blocks cross-transfer splicing', () => {
    const frame = enc().encrypt(Buffer.from('secret payload'))
    const wrong = dec(KEY, Buffer.from('different-transfer'))
    expect(() => wrong.push(frame)).toThrow()
  })

  it('throws when frames are reordered (IV/counter mismatch)', () => {
    const e = enc()
    const f0 = e.encrypt(Buffer.from('frame-zero'))
    const f1 = e.encrypt(Buffer.from('frame-one'))
    const d = dec()
    // 先喂第二帧 → 解密器按 counter=0 的 IV 处理 → 必然失败。
    expect(() => d.push(f1)).toThrow()
    void f0
  })

  it('throws on an oversized length prefix (memory-amplification guard)', () => {
    const huge = Buffer.alloc(4 + 32)
    huge.writeUInt32BE(64 * 1024 * 1024, 0) // 64 MiB，超过单帧上限
    const d = dec()
    expect(() => d.push(huge)).toThrow(/帧长度超限/)
  })
})
