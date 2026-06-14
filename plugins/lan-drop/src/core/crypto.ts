// 设备身份与传输鉴权（P0 安全加固）。
//
// 方案：基于 x25519 的自证身份 + ECDH 共享密钥 + HMAC 传输签名。
// - 每台设备持有一对长期 x25519 身份密钥（持久化）。
// - deviceId = 公钥指纹（sha256(SPKI) 截断）→ 身份「自证」：伪造 id 必然与公钥指纹不符。
// - 发送方用 ECDH(本机私钥, 对端公钥) 派生共享密钥，对传输元数据做 HMAC 签名。
// - 接收方用 ECDH(本机私钥, 对端公钥) 派生同一密钥校验签名 → 证明对端确实持有其私钥。
// - 共享密钥永不上线（仅公钥在局域网内交换），被动嗅探无法伪造「受信任设备」。
// - 配合时间戳 + nonce 防重放。

import * as crypto from 'node:crypto'

// HKDF 盐 / info：版本化，便于将来协议升级时隔离密钥域。
const HKDF_SALT = Buffer.from('mulby-landrop/pair/v2')
const HKDF_INFO = Buffer.from('transfer-auth')

// 签名时间窗：超出该偏差视为过期（防重放 + 容忍少量时钟漂移）。
export const SIG_TTL_MS = 5 * 60 * 1000

// deviceId 指纹长度（十六进制字符数）。32 hex = 128 bit，足够抗碰撞且便于展示。
const FINGERPRINT_HEX_LEN = 32

export interface Identity {
  /** SPKI DER, base64 —— 可公开广播的设备公钥。 */
  publicKeyB64: string
  /** PKCS8 DER, base64 —— 仅本机持久化，绝不外发。 */
  privateKeyB64: string
}

/** 待签名 / 校验的传输字段（收发双方必须按同一规范拼装）。 */
export interface TransferAuthFields {
  transferId: string
  senderId: string
  name: string
  size: number
  ts: number
  nonce: string
}

/** 生成一对全新的 x25519 身份密钥。 */
export function generateIdentity(): Identity {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('x25519')
  return {
    publicKeyB64: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
    privateKeyB64: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'),
  }
}

/** 校验一个持久化的身份对象是否结构完整且可用。 */
export function isValidIdentity(id: unknown): id is Identity {
  if (!id || typeof id !== 'object') return false
  const obj = id as Record<string, unknown>
  if (typeof obj.publicKeyB64 !== 'string' || typeof obj.privateKeyB64 !== 'string') return false
  try {
    importPublic(obj.publicKeyB64)
    importPrivate(obj.privateKeyB64)
    return true
  } catch {
    return false
  }
}

/** 由公钥派生稳定、自证的设备指纹（即 deviceId）。 */
export function fingerprint(publicKeyB64: string): string {
  const der = Buffer.from(publicKeyB64, 'base64')
  return crypto.createHash('sha256').update(der).digest('hex').slice(0, FINGERPRINT_HEX_LEN)
}

/** 校验「自报 deviceId」是否确实等于其公钥指纹（自证身份的核心）。 */
export function matchesFingerprint(deviceId: string, publicKeyB64: string): boolean {
  if (!deviceId || !publicKeyB64) return false
  try {
    return fingerprint(publicKeyB64) === deviceId
  } catch {
    return false
  }
}

function importPublic(b64: string): crypto.KeyObject {
  return crypto.createPublicKey({ key: Buffer.from(b64, 'base64'), type: 'spki', format: 'der' })
}

function importPrivate(b64: string): crypto.KeyObject {
  return crypto.createPrivateKey({ key: Buffer.from(b64, 'base64'), type: 'pkcs8', format: 'der' })
}

/**
 * ECDH(本机私钥, 对端公钥) → HKDF-SHA256 → 32 字节共享密钥。
 * 收发双方各自计算，结果一致，且密钥从不经过网络。
 * 失败（公钥非法等）抛出，调用方据此回退到「确认弹窗」。
 */
export function deriveSharedKey(myPrivateB64: string, peerPublicB64: string): Buffer {
  const secret = crypto.diffieHellman({
    privateKey: importPrivate(myPrivateB64),
    publicKey: importPublic(peerPublicB64),
  })
  return Buffer.from(crypto.hkdfSync('sha256', secret, HKDF_SALT, HKDF_INFO, 32))
}

// 文件加密密钥域：独立于鉴权 HMAC 密钥（不同 HKDF info），并由每次传输的随机 salt 派生。
const FILE_ENC_INFO = Buffer.from('mulby-landrop/file-enc/v2')

/**
 * 由 ECDH 共享密钥 + 每传输随机 salt 派生 32 字节文件加密密钥（AES-256-GCM）。
 * 与鉴权密钥使用不同的 HKDF info，避免跨算法密钥复用；salt 保证每次传输密钥唯一。
 */
export function deriveFileKey(
  myPrivateB64: string,
  peerPublicB64: string,
  salt: Buffer,
): Buffer {
  const secret = crypto.diffieHellman({
    privateKey: importPrivate(myPrivateB64),
    publicKey: importPublic(peerPublicB64),
  })
  return Buffer.from(crypto.hkdfSync('sha256', secret, salt, FILE_ENC_INFO, 32))
}

/**
 * 文本消息的「签名名」：把正文哈希放进签名字段的 name，使 HMAC 签名覆盖正文内容，
 * 从而即便明文传输（未加密）也能在身份已验证时检测正文篡改。收发双方按同一函数计算。
 */
export function textSignName(text: string): string {
  return 'text:' + crypto.createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 32)
}

/** 把传输字段拼成规范化签名串（收发双方必须完全一致）。 */
function canonical(f: TransferAuthFields): string {
  return [f.transferId, f.senderId, f.name, String(f.size), String(f.ts), f.nonce].join('\n')
}

/** 对传输字段计算 HMAC-SHA256 签名（十六进制）。 */
export function signTransfer(key: Buffer, fields: TransferAuthFields): string {
  return crypto.createHmac('sha256', key).update(canonical(fields)).digest('hex')
}

/** 常量时间校验传输签名。 */
export function verifyTransfer(key: Buffer, fields: TransferAuthFields, sig: string): boolean {
  if (!sig) return false
  let provided: Buffer
  try {
    provided = Buffer.from(sig, 'hex')
  } catch {
    return false
  }
  const expected = Buffer.from(signTransfer(key, fields), 'hex')
  if (provided.length !== expected.length || expected.length === 0) return false
  return crypto.timingSafeEqual(provided, expected)
}

/** 时间戳是否在允许窗口内（防重放 + 容忍时钟漂移）。 */
export function isFreshTimestamp(ts: number, now: number = Date.now()): boolean {
  return Number.isFinite(ts) && Math.abs(now - ts) <= SIG_TTL_MS
}

/** 生成一次性随机 nonce（用于防重放）。 */
export function newNonce(): string {
  return crypto.randomBytes(12).toString('hex')
}

/**
 * 断点续传分片标识：sha256(senderId + 文件名 + 大小) 的十六进制。
 * 同一 (发送方, 文件名, 大小) 跨会话稳定，作为接收端 .part 文件名。
 */
export function resumeKey(senderId: string, name: string, size: number): string {
  return crypto
    .createHash('sha256')
    .update(`${senderId}\n${name}\n${size}`)
    .digest('hex')
}

/** 校验续传 key 是否为合法 sha256 十六进制（防路径穿越）。 */
export function isResumeKey(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value)
}
