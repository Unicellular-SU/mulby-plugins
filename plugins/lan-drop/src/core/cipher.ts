// 文件流分帧 AEAD 加密（方案 A：应用层加密，复用 ECDH 会话密钥）。
//
// 帧格式：[4 字节 BE 密文长度][密文][16 字节 GCM tag]
// - 算法：AES-256-GCM
// - 密钥：每次传输由 ECDH 共享密钥 + 随机 salt 经 HKDF 派生（per-transfer 唯一）
// - IV：96 位计数器（前 4 字节 0 + 64 位 BE 帧序号），同一密钥内严格唯一；
//   因密钥 per-transfer 唯一，计数器从 0 开始亦不会跨传输复用 (key, IV)。
// - AAD：transferId，绑定帧到具体传输，杜绝跨传输拼接。
// - 完整性：逐帧 GCM tag 防篡改；帧序错乱→IV 不符→解密失败；
//   尾部截断由上层「明文字节数 == 声明大小」核对兜底。

import * as crypto from 'node:crypto'

const TAG_LEN = 16
const LEN_PREFIX = 4
// 单帧密文上限：正常分块约 64KiB，留足余量；用于抵御伪造超大长度前缀的内存放大攻击。
const MAX_FRAME_CT = 8 * 1024 * 1024

/** 由 96 位计数器构造 IV（前 4 字节 0 + 64 位 BE 序号）。 */
function ivFor(counter: number): Buffer {
  const iv = Buffer.alloc(12)
  iv.writeUInt32BE(Math.floor(counter / 0x1_0000_0000), 4)
  iv.writeUInt32BE(counter >>> 0, 8)
  return iv
}

/** 发送端：把明文分块逐帧加密。每个输入块产出一帧。 */
export class FrameEncryptor {
  private counter = 0

  constructor(
    private readonly key: Buffer,
    private readonly aad: Buffer,
  ) {}

  encrypt(plain: Buffer): Buffer {
    const iv = ivFor(this.counter++)
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv)
    cipher.setAAD(this.aad)
    const ct = Buffer.concat([cipher.update(plain), cipher.final()])
    const tag = cipher.getAuthTag()
    const head = Buffer.alloc(LEN_PREFIX)
    head.writeUInt32BE(ct.length, 0)
    return Buffer.concat([head, ct, tag])
  }
}

/** 接收端：流式喂入原始字节，按帧解密并校验。tag 不符 / 帧错乱时抛出。 */
export class FrameDecryptor {
  private counter = 0
  private buf: Buffer = Buffer.alloc(0)

  constructor(
    private readonly key: Buffer,
    private readonly aad: Buffer,
  ) {}

  /** 喂入原始字节，返回本次可完整解出的明文块数组（可能为空）。 */
  push(raw: Buffer): Buffer[] {
    this.buf = this.buf.length ? Buffer.concat([this.buf, raw]) : raw
    const out: Buffer[] = []
    for (;;) {
      if (this.buf.length < LEN_PREFIX) break
      const ctLen = this.buf.readUInt32BE(0)
      if (ctLen > MAX_FRAME_CT) throw new Error('帧长度超限')
      const frameTotal = LEN_PREFIX + ctLen + TAG_LEN
      if (this.buf.length < frameTotal) break
      const ct = this.buf.subarray(LEN_PREFIX, LEN_PREFIX + ctLen)
      const tag = this.buf.subarray(LEN_PREFIX + ctLen, frameTotal)
      const iv = ivFor(this.counter++)
      const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, iv)
      decipher.setAAD(this.aad)
      decipher.setAuthTag(tag)
      const pt = Buffer.concat([decipher.update(ct), decipher.final()]) // tag 不符则抛错
      out.push(pt)
      this.buf = this.buf.subarray(frameTotal)
    }
    return out
  }

  /** 残留未解析字节数（流结束时应为 0，否则视为不完整/损坏）。 */
  get pending(): number {
    return this.buf.length
  }
}
