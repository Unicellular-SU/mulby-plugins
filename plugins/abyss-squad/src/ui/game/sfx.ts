/**
 * 程序化音效引擎 — 使用 Web Audio API 生成游戏音效
 * 不需要任何外部音频文件
 */

let ctx: AudioContext | null = null
let masterGain: GainNode | null = null
let muted = false

function getCtx(): AudioContext | null {
  if (!ctx) {
    try {
      ctx = new AudioContext()
      masterGain = ctx.createGain()
      masterGain.gain.value = 0.3
      masterGain.connect(ctx.destination)
    } catch {
      return null
    }
  }
  return ctx
}

function getMaster(): GainNode | null {
  getCtx()
  return masterGain
}

export function setMuted(m: boolean) {
  muted = m
  const g = getMaster()
  if (g) g.gain.value = m ? 0 : 0.3
}

export function isMuted(): boolean {
  return muted
}

export function setVolume(v: number) {
  const g = getMaster()
  if (g) g.gain.value = muted ? 0 : Math.max(0, Math.min(1, v))
}

/** 恢复 AudioContext（浏览器要求用户交互后才能播放） */
export function resumeAudio() {
  const c = getCtx()
  if (c && c.state === 'suspended') c.resume()
}

// ========== 基础振荡器工具 ==========

function playTone(freq: number, duration: number, type: OscillatorType = 'square', volume = 0.3, detune = 0) {
  const c = getCtx()
  const g = getMaster()
  if (!c || !g) return

  const osc = c.createOscillator()
  const gain = c.createGain()
  osc.type = type
  osc.frequency.value = freq
  osc.detune.value = detune
  gain.gain.setValueAtTime(volume, c.currentTime)
  gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + duration)
  osc.connect(gain)
  gain.connect(g)
  osc.start(c.currentTime)
  osc.stop(c.currentTime + duration)
}

function playNoise(duration: number, volume = 0.15) {
  const c = getCtx()
  const g = getMaster()
  if (!c || !g) return

  const bufferSize = c.sampleRate * duration
  const buffer = c.createBuffer(1, bufferSize, c.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1

  const source = c.createBufferSource()
  source.buffer = buffer
  const gain = c.createGain()
  gain.gain.setValueAtTime(volume, c.currentTime)
  gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + duration)
  source.connect(gain)
  gain.connect(g)
  source.start(c.currentTime)
}

// ========== 游戏音效 ==========

/** 英雄攻击/射击 */
export function sfxShoot() {
  playTone(800, 0.06, 'square', 0.2)
  playTone(600, 0.04, 'sawtooth', 0.1, 50)
}

/** 敌人受伤 */
export function sfxHit() {
  playTone(200, 0.08, 'square', 0.15)
  playNoise(0.05, 0.08)
}

/** 敌人死亡 */
export function sfxKill() {
  playTone(150, 0.15, 'sawtooth', 0.2)
  playTone(100, 0.2, 'square', 0.1)
  playNoise(0.12, 0.1)
}

/** Boss 死亡 */
export function sfxBossKill() {
  playTone(80, 0.4, 'sawtooth', 0.25)
  playTone(60, 0.5, 'square', 0.15)
  playNoise(0.3, 0.15)
  setTimeout(() => playTone(120, 0.2, 'triangle', 0.2), 100)
}

/** 英雄受伤 */
export function sfxHeroHurt() {
  playTone(300, 0.12, 'sawtooth', 0.2)
  playTone(200, 0.15, 'square', 0.1)
}

/** 英雄死亡 */
export function sfxHeroDeath() {
  playTone(400, 0.1, 'sawtooth', 0.25)
  setTimeout(() => playTone(300, 0.15, 'sawtooth', 0.2), 80)
  setTimeout(() => playTone(150, 0.3, 'sawtooth', 0.15), 180)
}

/** 升级 */
export function sfxLevelUp() {
  playTone(523, 0.1, 'triangle', 0.25) // C5
  setTimeout(() => playTone(659, 0.1, 'triangle', 0.25), 80) // E5
  setTimeout(() => playTone(784, 0.15, 'triangle', 0.2), 160) // G5
}

/** 拾取道具 */
export function sfxPickup() {
  playTone(880, 0.06, 'sine', 0.2)
  setTimeout(() => playTone(1100, 0.08, 'sine', 0.15), 50)
}

/** 拾取水晶 */
export function sfxCrystal() {
  playTone(1200, 0.04, 'sine', 0.12)
}

/** 协同触发 */
export function sfxSynergy() {
  playTone(440, 0.08, 'sine', 0.2)
  playTone(554, 0.08, 'sine', 0.15) // A4 + C#5 和弦
  setTimeout(() => playTone(659, 0.12, 'sine', 0.2), 60) // E5
}

/** 传送门开启 */
export function sfxPortal() {
  playTone(200, 0.3, 'sine', 0.15)
  playTone(400, 0.3, 'sine', 0.1)
  playTone(800, 0.3, 'sine', 0.08)
  setTimeout(() => {
    playTone(1600, 0.2, 'sine', 0.12)
  }, 150)
}

/** 事件房间 */
export function sfxEvent() {
  playTone(350, 0.15, 'triangle', 0.15)
  setTimeout(() => playTone(500, 0.15, 'triangle', 0.12), 120)
}

/** 主动道具 Q 使用 */
export function sfxActiveItem() {
  playTone(600, 0.05, 'square', 0.2)
  playTone(900, 0.08, 'sawtooth', 0.15)
  playNoise(0.06, 0.1)
}

/** 成就解锁 */
export function sfxAchievement() {
  playTone(523, 0.1, 'sine', 0.2) // C5
  setTimeout(() => playTone(659, 0.1, 'sine', 0.2), 100) // E5
  setTimeout(() => playTone(784, 0.1, 'sine', 0.2), 200) // G5
  setTimeout(() => playTone(1047, 0.2, 'sine', 0.25), 300) // C6
}

/** 按钮点击 UI */
export function sfxClick() {
  playTone(1000, 0.03, 'sine', 0.1)
}

/** 新层开始 */
export function sfxNewFloor() {
  playTone(440, 0.1, 'triangle', 0.12)
  setTimeout(() => playTone(550, 0.12, 'triangle', 0.1), 80)
}

/** 游戏结束 */
export function sfxGameOver() {
  playTone(400, 0.15, 'sawtooth', 0.2)
  setTimeout(() => playTone(350, 0.15, 'sawtooth', 0.18), 120)
  setTimeout(() => playTone(300, 0.15, 'sawtooth', 0.15), 240)
  setTimeout(() => playTone(200, 0.4, 'sawtooth', 0.12), 360)
}

/** 胜利 */
export function sfxVictory() {
  playTone(523, 0.1, 'sine', 0.2)
  setTimeout(() => playTone(659, 0.1, 'sine', 0.2), 100)
  setTimeout(() => playTone(784, 0.1, 'sine', 0.2), 200)
  setTimeout(() => playTone(1047, 0.3, 'sine', 0.25), 300)
  setTimeout(() => playTone(784, 0.1, 'sine', 0.2), 500)
  setTimeout(() => playTone(1047, 0.4, 'sine', 0.3), 600)
}
