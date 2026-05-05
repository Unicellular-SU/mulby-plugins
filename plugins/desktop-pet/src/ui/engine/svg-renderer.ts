import type { PetExpression, PetPose, PetSpriteKey, PetSpriteSet } from './pet-standard'
import { resolveSpriteKey } from './pet-standard'

export interface SvgRendererState {
  pose: PetPose
  expression: PetExpression
  flipped: boolean
}

const POSE_ANIMATIONS: Record<string, string> = {
  stand: 'pet-idle 2s ease-in-out infinite',
  walk_1: 'pet-walk 0.3s ease-in-out',
  walk_2: 'pet-walk 0.3s ease-in-out',
  sit: 'pet-breathe 3s ease-in-out infinite',
  sleep: 'pet-sleep 4s ease-in-out infinite',
  jump: 'pet-jump 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)',
  wave: 'pet-wave 0.5s ease-in-out 2',
}

const ANIM_KEYFRAMES = `
@keyframes pet-idle {
  0%, 100% { transform: translateY(0) VAR_FLIP; }
  50% { transform: translateY(-2px) VAR_FLIP; }
}
@keyframes pet-walk {
  0%, 100% { transform: translateY(0) VAR_FLIP; }
  50% { transform: translateY(-3px) VAR_FLIP; }
}
@keyframes pet-breathe {
  0%, 100% { transform: scale(1) VAR_FLIP; }
  50% { transform: scale(1.02) VAR_FLIP; }
}
@keyframes pet-sleep {
  0%, 100% { transform: scale(1) translateY(0) VAR_FLIP; }
  50% { transform: scale(1.01) translateY(1px) VAR_FLIP; }
}
@keyframes pet-jump {
  0% { transform: translateY(0) scale(1) VAR_FLIP; }
  40% { transform: translateY(-8px) scale(1.05, 0.95) VAR_FLIP; }
  70% { transform: translateY(-4px) scale(0.98, 1.02) VAR_FLIP; }
  100% { transform: translateY(0) scale(1) VAR_FLIP; }
}
@keyframes pet-wave {
  0%, 100% { transform: rotate(0) VAR_FLIP; }
  25% { transform: rotate(-3deg) VAR_FLIP; }
  75% { transform: rotate(3deg) VAR_FLIP; }
}
@keyframes pet-blink {
  0%, 90%, 100% { opacity: 1; }
  95% { opacity: 0.7; }
}
`

export class SvgPetRenderer {
  private container: HTMLElement
  private imgEl: HTMLImageElement
  private styleEl: HTMLStyleElement
  private spriteSet: PetSpriteSet | null = null
  private availableKeys: Set<PetSpriteKey> = new Set()
  private currentKey: PetSpriteKey = 'stand_neutral'
  private state: SvgRendererState = { pose: 'stand', expression: 'neutral', flipped: false }
  private walkFrame = 0
  private walkTimer = 0
  private blinkTimer = 0

  constructor(container: HTMLElement, size: number) {
    this.container = container
    this.container.style.width = `${size}px`
    this.container.style.height = `${size}px`
    this.container.style.overflow = 'visible'
    this.container.style.position = 'relative'

    this.styleEl = document.createElement('style')
    this.styleEl.textContent = ANIM_KEYFRAMES.replace(/VAR_FLIP/g, '')
    document.head.appendChild(this.styleEl)

    this.imgEl = document.createElement('img')
    this.imgEl.style.width = '100%'
    this.imgEl.style.height = '100%'
    this.imgEl.style.imageRendering = 'pixelated'
    this.imgEl.style.position = 'absolute'
    this.imgEl.style.top = '0'
    this.imgEl.style.left = '0'
    this.imgEl.style.transformOrigin = 'center bottom'
    this.imgEl.draggable = false
    this.container.appendChild(this.imgEl)

    this.updateAnimation()
  }

  loadSpriteSet(spriteSet: PetSpriteSet) {
    this.spriteSet = spriteSet
    this.availableKeys = new Set(
      Object.keys(spriteSet.sprites) as PetSpriteKey[]
    )
    this.applySprite()
  }

  getSpriteSet(): PetSpriteSet | null {
    return this.spriteSet
  }

  setExpression(expression: PetExpression) {
    if (this.state.expression === expression) return
    this.state.expression = expression
    this.applySprite()
  }

  setPose(pose: PetPose) {
    if (this.state.pose === pose) return
    this.state.pose = pose
    this.applySprite()
    this.updateAnimation()
  }

  setFlipped(flipped: boolean) {
    if (this.state.flipped === flipped) return
    this.state.flipped = flipped
    this.updateAnimation()
  }

  update(deltaMs: number) {
    if (this.state.pose === 'walk_1' || this.state.pose === 'walk_2') {
      this.walkTimer += deltaMs
      if (this.walkTimer >= 300) {
        this.walkTimer -= 300
        this.walkFrame = (this.walkFrame + 1) % 2
        const walkPose: PetPose = this.walkFrame === 0 ? 'walk_1' : 'walk_2'
        if (this.state.pose !== walkPose) {
          this.state.pose = walkPose
          this.applySprite()
        }
      }
    } else {
      this.walkTimer = 0
      this.walkFrame = 0
    }

    this.blinkTimer += deltaMs
    if (this.blinkTimer > 4000) {
      this.blinkTimer = 0
      this.doBlink()
    }
  }

  startWalk() {
    this.state.pose = 'walk_1'
    this.walkFrame = 0
    this.walkTimer = 0
    this.applySprite()
    this.updateAnimation()
  }

  private updateAnimation() {
    const flipStr = this.state.flipped ? 'scaleX(-1)' : ''
    const poseBase = this.state.pose.startsWith('walk_') ? 'walk_1' : this.state.pose

    this.styleEl.textContent = ANIM_KEYFRAMES.replace(/VAR_FLIP/g, flipStr)

    const anim = POSE_ANIMATIONS[poseBase] || POSE_ANIMATIONS['stand']
    this.imgEl.style.animation = 'none'
    void this.imgEl.offsetHeight
    this.imgEl.style.animation = anim
  }

  private doBlink() {
    if (this.state.pose === 'sleep') return
    this.imgEl.style.animation = 'pet-blink 0.3s ease'
    setTimeout(() => this.updateAnimation(), 300)
  }

  private applySprite() {
    if (!this.spriteSet) return

    const key = resolveSpriteKey(this.availableKeys, this.state.pose, this.state.expression)
    if (key === this.currentKey) return
    this.currentKey = key

    const svg = this.spriteSet.sprites[key]
    if (!svg) return

    const dataUrl = svg.startsWith('data:')
      ? svg
      : `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`

    this.imgEl.src = dataUrl
  }

  destroy() {
    this.container.removeChild(this.imgEl)
    document.head.removeChild(this.styleEl)
  }
}
