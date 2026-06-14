// 安全核心：身份自证 / ECDH 共享密钥 / 传输签名 / 防重放 / 续传 key。
// 这些不变量一旦回归会「静默」削弱安全性（伪造身份、重放、目录穿越），故重点覆盖。

import { describe, it, expect } from 'vitest'
import {
  generateIdentity,
  isValidIdentity,
  fingerprint,
  matchesFingerprint,
  deriveSharedKey,
  deriveFileKey,
  signTransfer,
  verifyTransfer,
  isFreshTimestamp,
  newNonce,
  resumeKey,
  isResumeKey,
  SIG_TTL_MS,
  type TransferAuthFields,
} from './crypto'

function fields(over: Partial<TransferAuthFields> = {}): TransferAuthFields {
  return {
    transferId: 'tx-1',
    senderId: 'sender-abc',
    name: 'photo.jpg',
    size: 1024,
    ts: 1_700_000_000_000,
    nonce: 'deadbeef',
    ...over,
  }
}

describe('identity', () => {
  it('generates a structurally valid, self-consistent identity', () => {
    const id = generateIdentity()
    expect(typeof id.publicKeyB64).toBe('string')
    expect(typeof id.privateKeyB64).toBe('string')
    expect(id.publicKeyB64.length).toBeGreaterThan(0)
    expect(isValidIdentity(id)).toBe(true)
  })

  it('rejects malformed identities', () => {
    expect(isValidIdentity(null)).toBe(false)
    expect(isValidIdentity({})).toBe(false)
    expect(isValidIdentity({ publicKeyB64: 'x', privateKeyB64: 'y' })).toBe(false)
    expect(isValidIdentity({ publicKeyB64: 123, privateKeyB64: 456 })).toBe(false)
  })

  it('fingerprint is deterministic and 32 hex chars (128-bit)', () => {
    const id = generateIdentity()
    const fp = fingerprint(id.publicKeyB64)
    expect(fp).toMatch(/^[0-9a-f]{32}$/)
    expect(fingerprint(id.publicKeyB64)).toBe(fp)
  })

  it('matchesFingerprint accepts the true deviceId and rejects a forged one', () => {
    const id = generateIdentity()
    const deviceId = fingerprint(id.publicKeyB64)
    expect(matchesFingerprint(deviceId, id.publicKeyB64)).toBe(true)
    // 攻击者声称一个不属于该公钥的 id → 必须被拒（自证身份的核心）。
    expect(matchesFingerprint('0'.repeat(32), id.publicKeyB64)).toBe(false)
    expect(matchesFingerprint(deviceId, generateIdentity().publicKeyB64)).toBe(false)
    expect(matchesFingerprint('', id.publicKeyB64)).toBe(false)
    expect(matchesFingerprint(deviceId, '')).toBe(false)
  })
})

describe('ECDH shared key', () => {
  it('both parties derive the identical auth key (and it never crosses the wire)', () => {
    const a = generateIdentity()
    const b = generateIdentity()
    const kA = deriveSharedKey(a.privateKeyB64, b.publicKeyB64)
    const kB = deriveSharedKey(b.privateKeyB64, a.publicKeyB64)
    expect(kA.length).toBe(32)
    expect(kA.equals(kB)).toBe(true)
  })

  it('a different peer yields a different key', () => {
    const a = generateIdentity()
    const b = generateIdentity()
    const c = generateIdentity()
    const kAB = deriveSharedKey(a.privateKeyB64, b.publicKeyB64)
    const kAC = deriveSharedKey(a.privateKeyB64, c.publicKeyB64)
    expect(kAB.equals(kAC)).toBe(false)
  })

  it('throws on an invalid peer public key (caller falls back to confirm dialog)', () => {
    const a = generateIdentity()
    expect(() => deriveSharedKey(a.privateKeyB64, 'not-a-key')).toThrow()
  })
})

describe('file encryption key', () => {
  it('both parties derive the same per-transfer key from the same salt', () => {
    const a = generateIdentity()
    const b = generateIdentity()
    const salt = Buffer.from('per-transfer-salt-0001')
    const kA = deriveFileKey(a.privateKeyB64, b.publicKeyB64, salt)
    const kB = deriveFileKey(b.privateKeyB64, a.publicKeyB64, salt)
    expect(kA.length).toBe(32)
    expect(kA.equals(kB)).toBe(true)
  })

  it('a different salt yields a different file key (per-transfer uniqueness)', () => {
    const a = generateIdentity()
    const b = generateIdentity()
    const k1 = deriveFileKey(a.privateKeyB64, b.publicKeyB64, Buffer.from('salt-1'))
    const k2 = deriveFileKey(a.privateKeyB64, b.publicKeyB64, Buffer.from('salt-2'))
    expect(k1.equals(k2)).toBe(false)
  })

  it('file key is domain-separated from the auth key', () => {
    const a = generateIdentity()
    const b = generateIdentity()
    const auth = deriveSharedKey(a.privateKeyB64, b.publicKeyB64)
    // 即使 salt 恰好等于鉴权 HKDF 盐，info 不同 → 派生密钥也必须不同。
    const file = deriveFileKey(a.privateKeyB64, b.publicKeyB64, Buffer.from('mulby-landrop/pair/v2'))
    expect(auth.equals(file)).toBe(false)
  })
})

describe('transfer signature', () => {
  it('a valid signature verifies', () => {
    const a = generateIdentity()
    const b = generateIdentity()
    const key = deriveSharedKey(a.privateKeyB64, b.publicKeyB64)
    const f = fields()
    const sig = signTransfer(key, f)
    expect(verifyTransfer(deriveSharedKey(b.privateKeyB64, a.publicKeyB64), f, sig)).toBe(true)
  })

  it('tampering ANY signed field invalidates the signature', () => {
    const a = generateIdentity()
    const b = generateIdentity()
    const key = deriveSharedKey(a.privateKeyB64, b.publicKeyB64)
    const f = fields()
    const sig = signTransfer(key, f)
    const mutations: Partial<TransferAuthFields>[] = [
      { transferId: 'tx-2' },
      { senderId: 'someone-else' },
      { name: 'photo.jpg.exe' },
      { size: 1025 },
      { ts: f.ts + 1 },
      { nonce: 'cafebabe' },
    ]
    for (const m of mutations) {
      expect(verifyTransfer(key, fields(m), sig)).toBe(false)
    }
  })

  it('a wrong key (different ECDH pair) does not verify', () => {
    const a = generateIdentity()
    const b = generateIdentity()
    const evil = generateIdentity()
    const f = fields()
    const sig = signTransfer(deriveSharedKey(a.privateKeyB64, b.publicKeyB64), f)
    const wrongKey = deriveSharedKey(evil.privateKeyB64, b.publicKeyB64)
    expect(verifyTransfer(wrongKey, f, sig)).toBe(false)
  })

  it('rejects empty / malformed signatures without throwing', () => {
    const key = deriveSharedKey(generateIdentity().privateKeyB64, generateIdentity().publicKeyB64)
    const f = fields()
    expect(verifyTransfer(key, f, '')).toBe(false)
    expect(verifyTransfer(key, f, 'zzzz')).toBe(false)
    expect(verifyTransfer(key, f, 'ab')).toBe(false) // 正确 hex 但长度不符
  })

  // 端到端的身份伪造场景：攻击者嗅探到广播里的 deviceId + 公钥，但没有对应私钥。
  // 他出示受害者的真实公钥（matchesFingerprint 通过），却只能用自己的私钥派生密钥签名。
  // 接收方用 ECDH(自身私钥, 受害者公钥) 校验 → 与攻击者的密钥不一致 → 签名失败。
  it('a passive eavesdropper cannot forge a trusted-device transfer', () => {
    const victim = generateIdentity()
    const receiver = generateIdentity()
    const attacker = generateIdentity()

    const victimId = fingerprint(victim.publicKeyB64)
    // 攻击者冒充 victim：出示 victim 的真实公钥（指纹自证这一关能过）。
    expect(matchesFingerprint(victimId, victim.publicKeyB64)).toBe(true)

    // 但攻击者只能用自己的私钥派生共享密钥来签名。
    const attackerKey = deriveSharedKey(attacker.privateKeyB64, receiver.publicKeyB64)
    const forged = signTransfer(attackerKey, fields({ senderId: victimId }))

    // 接收方按「出示的公钥 = victim 公钥」派生密钥校验 → 必然不匹配。
    const receiverKey = deriveSharedKey(receiver.privateKeyB64, victim.publicKeyB64)
    expect(verifyTransfer(receiverKey, fields({ senderId: victimId }), forged)).toBe(false)
  })
})

describe('replay protection', () => {
  it('accepts a fresh timestamp and rejects stale / future / non-finite ones', () => {
    const now = 1_700_000_000_000
    expect(isFreshTimestamp(now, now)).toBe(true)
    expect(isFreshTimestamp(now - SIG_TTL_MS + 1000, now)).toBe(true)
    expect(isFreshTimestamp(now + SIG_TTL_MS - 1000, now)).toBe(true)
    expect(isFreshTimestamp(now - SIG_TTL_MS - 1, now)).toBe(false)
    expect(isFreshTimestamp(now + SIG_TTL_MS + 1, now)).toBe(false)
    expect(isFreshTimestamp(Number.NaN, now)).toBe(false)
    expect(isFreshTimestamp(Number.POSITIVE_INFINITY, now)).toBe(false)
  })

  it('nonce is random hex and effectively unique', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 500; i += 1) {
      const n = newNonce()
      expect(n).toMatch(/^[0-9a-f]+$/)
      expect(seen.has(n)).toBe(false)
      seen.add(n)
    }
  })
})

describe('resume key', () => {
  it('is a stable sha256 hex over (senderId, name, size)', () => {
    const k = resumeKey('sender-abc', 'movie.mkv', 12345)
    expect(k).toMatch(/^[0-9a-f]{64}$/)
    expect(resumeKey('sender-abc', 'movie.mkv', 12345)).toBe(k)
  })

  it('changes when any component changes', () => {
    const base = resumeKey('s', 'f', 1)
    expect(resumeKey('s2', 'f', 1)).not.toBe(base)
    expect(resumeKey('s', 'f2', 1)).not.toBe(base)
    expect(resumeKey('s', 'f', 2)).not.toBe(base)
  })

  it('isResumeKey only accepts a 64-char lowercase hex (blocks path traversal in the key)', () => {
    expect(isResumeKey(resumeKey('s', 'f', 1))).toBe(true)
    expect(isResumeKey('../../etc/passwd')).toBe(false)
    expect(isResumeKey('ABCDEF' + '0'.repeat(58))).toBe(false) // 大写不接受
    expect(isResumeKey('0'.repeat(63))).toBe(false)
    expect(isResumeKey('0'.repeat(65))).toBe(false)
    expect(isResumeKey('')).toBe(false)
  })
})
