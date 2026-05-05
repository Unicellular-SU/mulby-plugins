import type { AnimationName } from './types'

export interface PetColorScheme {
  body: string
  belly: string
  bodyDark: string
  earInner: string
  nose: string
}

export const DEFAULT_COLORS: PetColorScheme = {
  body: '#F5A623',
  belly: '#FFEAA7',
  bodyDark: '#E8930A',
  earInner: '#FFB8C6',
  nose: '#FFB8C6',
}

interface FrameDrawer {
  (ctx: CanvasRenderingContext2D, frame: number, size: number, flipped: boolean): void
}

interface AnimDef {
  frames: number
  fps: number
  loop: boolean
  next?: AnimationName
}

const ANIMS: Record<string, AnimDef> = {
  idle: { frames: 4, fps: 3, loop: true },
  walk_left: { frames: 4, fps: 6, loop: true },
  walk_right: { frames: 4, fps: 6, loop: true },
  run_left: { frames: 4, fps: 10, loop: true },
  run_right: { frames: 4, fps: 10, loop: true },
  jump: { frames: 3, fps: 6, loop: false, next: 'idle' },
  sit: { frames: 2, fps: 2, loop: true },
  sleep: { frames: 2, fps: 1, loop: true },
  surprised: { frames: 2, fps: 8, loop: false, next: 'idle' },
  happy: { frames: 4, fps: 8, loop: false, next: 'idle' },
  cheer: { frames: 4, fps: 8, loop: false, next: 'idle' },
  look_left: { frames: 2, fps: 3, loop: true },
  look_right: { frames: 2, fps: 3, loop: true },
  wobble: { frames: 4, fps: 8, loop: false, next: 'idle' },
  celebrate: { frames: 4, fps: 6, loop: false, next: 'idle' },
}

export class PixelCatRenderer {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private currentAnim: string = 'idle'
  private frameIndex = 0
  private elapsed = 0
  private flipped = false
  private colors: PetColorScheme = DEFAULT_COLORS

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')!
    this.ctx.imageSmoothingEnabled = false
  }

  setColors(scheme: PetColorScheme) {
    this.colors = scheme
  }

  getColors(): PetColorScheme {
    return this.colors
  }

  play(anim: string) {
    if (this.currentAnim === anim) return
    this.currentAnim = anim
    this.frameIndex = 0
    this.elapsed = 0
  }

  setFlipped(f: boolean) {
    this.flipped = f
  }

  update(deltaMs: number) {
    const def = ANIMS[this.currentAnim]
    if (!def) return

    this.elapsed += deltaMs
    const frameDuration = 1000 / def.fps

    if (this.elapsed >= frameDuration) {
      this.elapsed -= frameDuration
      this.frameIndex++

      if (this.frameIndex >= def.frames) {
        if (def.loop) {
          this.frameIndex = 0
        } else {
          this.frameIndex = def.frames - 1
          if (def.next) this.play(def.next)
        }
      }
    }
  }

  render() {
    const { ctx, canvas } = this
    const s = canvas.width

    ctx.clearRect(0, 0, s, s)
    ctx.save()

    if (this.flipped) {
      ctx.translate(s, 0)
      ctx.scale(-1, 1)
    }

    this.drawCat(ctx, this.currentAnim, this.frameIndex, s)
    ctx.restore()
  }

  private drawCat(ctx: CanvasRenderingContext2D, anim: string, frame: number, size: number) {
    const u = size / 16
    const bounce = this.getBounce(anim, frame)
    const tilt = this.getTilt(anim, frame)

    ctx.save()
    ctx.translate(size / 2, size / 2 + bounce * u)
    ctx.rotate(tilt)
    ctx.translate(-size / 2, -size / 2)

    this.drawBody(ctx, u, anim, frame)
    this.drawHead(ctx, u, anim, frame)
    this.drawTail(ctx, u, anim, frame)
    this.drawLegs(ctx, u, anim, frame)

    if (anim === 'sleep') this.drawZzz(ctx, u, frame)
    if (anim === 'celebrate') this.drawSparkles(ctx, u, frame, size)
    if (anim === 'happy') this.drawHearts(ctx, u, frame, size)

    ctx.restore()
  }

  private getBounce(anim: string, frame: number): number {
    if (anim === 'jump') return frame === 1 ? -3 : 0
    if (anim === 'happy') return frame % 2 === 0 ? -1.5 : 0
    if (anim === 'cheer') return frame % 2 === 0 ? -1 : 0
    if (anim.startsWith('run_')) return frame % 2 === 0 ? -0.5 : 0
    return 0
  }

  private getTilt(anim: string, frame: number): number {
    if (anim === 'wobble') {
      const angles = [0.1, -0.1, 0.15, -0.15]
      return angles[frame % 4]
    }
    if (anim === 'surprised') return frame === 0 ? -0.05 : 0.05
    return 0
  }

  private drawBody(ctx: CanvasRenderingContext2D, u: number, anim: string, frame: number) {
    ctx.fillStyle = this.colors.body
    const bodyY = anim === 'sit' || anim === 'sleep' ? 8 * u : 7 * u
    const bodyH = anim === 'sit' || anim === 'sleep' ? 5 * u : 5 * u
    this.roundRect(ctx, 4 * u, bodyY, 8 * u, bodyH, 2 * u)

    ctx.fillStyle = this.colors.belly
    const bellyY = bodyY + 1.5 * u
    this.roundRect(ctx, 5.5 * u, bellyY, 5 * u, 3 * u, 1.5 * u)
  }

  private drawHead(ctx: CanvasRenderingContext2D, u: number, anim: string, frame: number) {
    const headY = anim === 'sit' || anim === 'sleep' ? 4 * u : 3 * u
    const headX = 4 * u

    if (anim === 'look_left' || anim === 'look_right') {
      const offset = anim === 'look_left' ? -0.5 * u : 0.5 * u
      ctx.fillStyle = this.colors.body
      this.roundRect(ctx, headX + offset, headY, 8 * u, 5 * u, 2.5 * u)
    } else {
      ctx.fillStyle = this.colors.body
      this.roundRect(ctx, headX, headY, 8 * u, 5 * u, 2.5 * u)
    }

    ctx.fillStyle = this.colors.body
    this.drawTriangle(ctx, 4.5 * u, headY + 0.5 * u, 6 * u, headY - 1.5 * u, 7 * u, headY + 0.5 * u)
    this.drawTriangle(ctx, 9 * u, headY + 0.5 * u, 10 * u, headY - 1.5 * u, 11.5 * u, headY + 0.5 * u)

    ctx.fillStyle = this.colors.earInner
    this.drawTriangle(ctx, 5.2 * u, headY + 0.5 * u, 6 * u, headY - 0.8 * u, 6.5 * u, headY + 0.5 * u)
    this.drawTriangle(ctx, 9.5 * u, headY + 0.5 * u, 10 * u, headY - 0.8 * u, 10.8 * u, headY + 0.5 * u)

    // eyes
    const eyeY = headY + 2 * u
    if (anim === 'sleep') {
      ctx.strokeStyle = '#333'
      ctx.lineWidth = u * 0.4
      ctx.beginPath()
      ctx.moveTo(5.5 * u, eyeY)
      ctx.lineTo(7 * u, eyeY + 0.3 * u)
      ctx.moveTo(9 * u, eyeY)
      ctx.lineTo(10.5 * u, eyeY + 0.3 * u)
      ctx.stroke()
    } else if (anim === 'happy' || anim === 'cheer' || anim === 'celebrate') {
      ctx.strokeStyle = '#333'
      ctx.lineWidth = u * 0.4
      ctx.beginPath()
      ctx.arc(6.2 * u, eyeY, 0.6 * u, Math.PI, 0)
      ctx.moveTo(9.2 * u, eyeY)
      ctx.arc(9.8 * u, eyeY, 0.6 * u, Math.PI, 0)
      ctx.stroke()
    } else if (anim === 'surprised') {
      ctx.fillStyle = '#333'
      ctx.beginPath()
      ctx.arc(6.2 * u, eyeY, 0.8 * u, 0, Math.PI * 2)
      ctx.arc(9.8 * u, eyeY, 0.8 * u, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#FFF'
      ctx.beginPath()
      ctx.arc(6.5 * u, eyeY - 0.2 * u, 0.3 * u, 0, Math.PI * 2)
      ctx.arc(10.1 * u, eyeY - 0.2 * u, 0.3 * u, 0, Math.PI * 2)
      ctx.fill()
    } else {
      ctx.fillStyle = '#333'
      ctx.beginPath()
      ctx.ellipse(6.2 * u, eyeY, 0.5 * u, 0.7 * u, 0, 0, Math.PI * 2)
      ctx.ellipse(9.8 * u, eyeY, 0.5 * u, 0.7 * u, 0, 0, Math.PI * 2)
      ctx.fill()
      if (frame % 4 === 0 && anim === 'idle') {
        ctx.fillStyle = this.colors.body
        ctx.fillRect(5.5 * u, eyeY - 0.7 * u, 1.5 * u, 1.4 * u)
        ctx.fillRect(9 * u, eyeY - 0.7 * u, 1.5 * u, 1.4 * u)
        ctx.strokeStyle = '#333'
        ctx.lineWidth = u * 0.3
        ctx.beginPath()
        ctx.moveTo(5.7 * u, eyeY)
        ctx.lineTo(7 * u, eyeY)
        ctx.moveTo(9.2 * u, eyeY)
        ctx.lineTo(10.5 * u, eyeY)
        ctx.stroke()
      }
    }

    ctx.fillStyle = this.colors.nose
    ctx.beginPath()
    ctx.arc(8 * u, headY + 3.2 * u, 0.35 * u, 0, Math.PI * 2)
    ctx.fill()

    // mouth
    if (anim === 'surprised') {
      ctx.strokeStyle = '#333'
      ctx.lineWidth = u * 0.3
      ctx.beginPath()
      ctx.arc(8 * u, headY + 4 * u, 0.5 * u, 0, Math.PI * 2)
      ctx.stroke()
    } else {
      ctx.strokeStyle = '#333'
      ctx.lineWidth = u * 0.3
      ctx.beginPath()
      ctx.moveTo(7.3 * u, headY + 3.8 * u)
      ctx.quadraticCurveTo(8 * u, headY + 4.3 * u, 8.7 * u, headY + 3.8 * u)
      ctx.stroke()
    }

    // whiskers
    ctx.strokeStyle = '#666'
    ctx.lineWidth = u * 0.2
    ctx.beginPath()
    ctx.moveTo(4.5 * u, headY + 3 * u)
    ctx.lineTo(6 * u, headY + 3.3 * u)
    ctx.moveTo(4.5 * u, headY + 3.8 * u)
    ctx.lineTo(6 * u, headY + 3.5 * u)
    ctx.moveTo(11.5 * u, headY + 3 * u)
    ctx.lineTo(10 * u, headY + 3.3 * u)
    ctx.moveTo(11.5 * u, headY + 3.8 * u)
    ctx.lineTo(10 * u, headY + 3.5 * u)
    ctx.stroke()
  }

  private drawTail(ctx: CanvasRenderingContext2D, u: number, anim: string, frame: number) {
    const tailX = 11 * u
    const tailY = anim === 'sit' || anim === 'sleep' ? 9 * u : 8 * u
    const wave = Math.sin((frame / 2) * Math.PI) * u

    ctx.strokeStyle = this.colors.body
    ctx.lineWidth = 1.5 * u
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(tailX, tailY)
    ctx.quadraticCurveTo(tailX + 2.5 * u, tailY - 2 * u + wave, tailX + 3 * u, tailY - 4 * u + wave)
    ctx.stroke()

    ctx.strokeStyle = this.colors.bodyDark
    ctx.lineWidth = 0.8 * u
    ctx.beginPath()
    ctx.moveTo(tailX + 2.5 * u, tailY - 3.5 * u + wave)
    ctx.lineTo(tailX + 3 * u, tailY - 4 * u + wave)
    ctx.stroke()
  }

  private drawLegs(ctx: CanvasRenderingContext2D, u: number, anim: string, frame: number) {
    if (anim === 'sit' || anim === 'sleep') {
      ctx.fillStyle = this.colors.body
      this.roundRect(ctx, 5 * u, 12 * u, 2.5 * u, 1.5 * u, 0.5 * u)
      this.roundRect(ctx, 8.5 * u, 12 * u, 2.5 * u, 1.5 * u, 0.5 * u)
      return
    }

    const isWalking = anim.includes('walk') || anim.includes('run')
    const legOffset = isWalking ? Math.sin(frame * Math.PI / 2) * u : 0

    ctx.fillStyle = this.colors.body
    this.roundRect(ctx, 5 * u, 11.5 * u + legOffset, 1.8 * u, 3 * u, 0.5 * u)
    this.roundRect(ctx, 9.2 * u, 11.5 * u - legOffset, 1.8 * u, 3 * u, 0.5 * u)

    ctx.fillStyle = this.colors.bodyDark
    this.roundRect(ctx, 4.8 * u, 14 * u + legOffset, 2.2 * u, 0.8 * u, 0.4 * u)
    this.roundRect(ctx, 9 * u, 14 * u - legOffset, 2.2 * u, 0.8 * u, 0.4 * u)
  }

  private drawZzz(ctx: CanvasRenderingContext2D, u: number, frame: number) {
    ctx.fillStyle = '#888'
    ctx.font = `${(frame === 0 ? 1.5 : 2) * u}px sans-serif`
    const x = 12 * u
    const y = (frame === 0 ? 4 : 2.5) * u
    ctx.fillText('z', x, y)
    if (frame === 1) {
      ctx.font = `${1.2 * u}px sans-serif`
      ctx.fillText('z', x + 1.5 * u, y - 1.5 * u)
    }
  }

  private drawSparkles(ctx: CanvasRenderingContext2D, u: number, frame: number, size: number) {
    const sparkles = [
      { x: 2, y: 2 }, { x: 13, y: 1 }, { x: 1, y: 8 },
      { x: 14, y: 6 }, { x: 3, y: 12 }, { x: 12, y: 11 },
    ]
    const colors = ['#FFD700', '#FF6B6B', '#4ECDC4', '#A855F7']

    sparkles.forEach((s, i) => {
      if ((frame + i) % 2 === 0) {
        ctx.fillStyle = colors[i % colors.length]
        const sz = u * (0.4 + Math.random() * 0.4)
        ctx.fillRect(s.x * u - sz / 2, s.y * u - sz / 2, sz, sz)
      }
    })
  }

  private drawHearts(ctx: CanvasRenderingContext2D, u: number, frame: number, size: number) {
    if (frame < 2) return
    ctx.fillStyle = '#FF6B6B'
    const hx = 12 * u
    const hy = (frame === 2 ? 3 : 1.5) * u
    this.drawHeart(ctx, hx, hy, u * 1.2)
  }

  private drawHeart(ctx: CanvasRenderingContext2D, x: number, y: number, size: number) {
    ctx.save()
    ctx.translate(x, y)
    ctx.beginPath()
    ctx.moveTo(0, size * 0.3)
    ctx.bezierCurveTo(-size * 0.5, -size * 0.3, -size, size * 0.1, 0, size)
    ctx.bezierCurveTo(size, size * 0.1, size * 0.5, -size * 0.3, 0, size * 0.3)
    ctx.fill()
    ctx.restore()
  }

  private roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
    ctx.beginPath()
    ctx.roundRect(x, y, w, h, r)
    ctx.fill()
  }

  private drawTriangle(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, x3: number, y3: number) {
    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.lineTo(x2, y2)
    ctx.lineTo(x3, y3)
    ctx.closePath()
    ctx.fill()
  }
}
