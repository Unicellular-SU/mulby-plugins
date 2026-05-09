import type { PetExpression, PetPose, PetSpriteKey, PetSpriteSet } from './pet-standard'
import { resolveSpriteKey } from './pet-standard'
import { logPetPresentation } from './presentation-debug'
import { sanitizeSvgString } from './sprite-sanitize'

export interface SvgRendererState {
  pose: PetPose
  expression: PetExpression
  flipped: boolean
}

const POSE_ANIMATIONS: Record<string, string> = {
  stand: 'pet-float 3s ease-in-out infinite',
  walk_1: 'pet-drift 0.4s ease-in-out',
  walk_2: 'pet-drift 0.4s ease-in-out',
  sit: 'pet-settle 3.5s ease-in-out infinite',
  sleep: 'pet-slumber 5s ease-in-out infinite',
  jump: 'pet-ascend 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)',
  wave: 'pet-wiggle 0.6s ease-in-out 3',
}

const EXPR_ANIMATIONS: Record<string, string> = {
  happy: 'pet-bounce 0.5s ease-out',
  excited: 'pet-spin-bounce 0.6s ease-out',
  sad: 'pet-droop 0.6s ease-out forwards',
  angry: 'pet-flicker 0.4s ease-in-out 3',
  surprised: 'pet-phase 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)',
  love: 'pet-glow-pulse 1s ease-in-out 2',
  sleepy: 'pet-droop 0.8s ease-out forwards',
  shy: 'pet-hide 0.5s ease-out forwards',
}

const NAMED_ANIMATIONS: Record<string, string> = {
  bounce: 'pet-bounce 0.5s ease-out',
  spin_bounce: 'pet-spin-bounce 0.6s ease-out',
  droop: 'pet-droop 0.6s ease-out forwards',
  flicker: 'pet-flicker 0.4s ease-in-out 3',
  phase: 'pet-phase 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)',
  glow_pulse: 'pet-glow-pulse 1s ease-in-out 2',
  hide: 'pet-hide 0.5s ease-out forwards',
  wiggle: 'pet-wiggle 0.6s ease-in-out 3',
  ascend: 'pet-ascend 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)',
  wobble: 'pet-wobble 0.8s ease-in-out',
  celebrate: 'pet-celebrate 1s ease-in-out',
}

const POSE_OPACITY: Record<string, number> = {
  stand: 0.7,
  walk_1: 0.65,
  walk_2: 0.65,
  sit: 0.6,
  sleep: 0.45,
  jump: 0.75,
  wave: 0.8,
}

const ANIM_KEYFRAMES = `
/* Ghost float: gentle hovering with subtle sway and rotation */
@keyframes pet-float {
  0%, 100% { transform: translateY(0) translateX(0) rotate(0deg) VAR_FLIP; }
  25% { transform: translateY(-4px) translateX(1.5px) rotate(0.8deg) VAR_FLIP; }
  50% { transform: translateY(-6px) translateX(0) rotate(0deg) VAR_FLIP; }
  75% { transform: translateY(-4px) translateX(-1.5px) rotate(-0.8deg) VAR_FLIP; }
}

/* Ghost drift: floating movement with bob */
@keyframes pet-drift {
  0%, 100% { transform: translateY(0) VAR_FLIP; }
  30% { transform: translateY(-5px) VAR_FLIP; }
  60% { transform: translateY(-2px) VAR_FLIP; }
}

/* Settling down: slow breathing while sinking */
@keyframes pet-settle {
  0%, 100% { transform: scale(1) translateY(0) rotate(0deg) VAR_FLIP; }
  30% { transform: scale(1.02) translateY(-1px) rotate(0.3deg) VAR_FLIP; }
  60% { transform: scale(0.99) translateY(1px) rotate(-0.3deg) VAR_FLIP; }
}

/* Sleep: very slow dreamy float, ghost fading in and out */
@keyframes pet-slumber {
  0%, 100% { transform: scale(1) translateY(0) rotate(0deg) VAR_FLIP; opacity: 0.45; }
  25% { transform: scale(1.01) translateY(1px) rotate(0.5deg) VAR_FLIP; opacity: 0.4; }
  50% { transform: scale(1.02) translateY(2px) rotate(0deg) VAR_FLIP; opacity: 0.35; }
  75% { transform: scale(1.01) translateY(1px) rotate(-0.5deg) VAR_FLIP; opacity: 0.4; }
}

/* Ascend: ghost rising high with ethereal stretch */
@keyframes pet-ascend {
  0% { transform: translateY(0) scale(1, 1) VAR_FLIP; }
  25% { transform: translateY(-14px) scale(0.88, 1.12) VAR_FLIP; }
  50% { transform: translateY(-18px) scale(0.85, 1.15) VAR_FLIP; opacity: 0.5; }
  75% { transform: translateY(-8px) scale(1.06, 0.94) VAR_FLIP; opacity: 0.7; }
  100% { transform: translateY(0) scale(1) VAR_FLIP; }
}

/* Wiggle: excited ghostly wobble */
@keyframes pet-wiggle {
  0%, 100% { transform: rotate(0deg) translateY(0) VAR_FLIP; }
  15% { transform: rotate(-6deg) translateY(-3px) VAR_FLIP; }
  35% { transform: rotate(6deg) translateY(-5px) VAR_FLIP; }
  55% { transform: rotate(-4deg) translateY(-3px) VAR_FLIP; }
  75% { transform: rotate(4deg) translateY(-4px) VAR_FLIP; }
}

/* Bounce: happy hop with slight spin */
@keyframes pet-bounce {
  0% { transform: translateY(0) rotate(0deg) VAR_FLIP; }
  20% { transform: translateY(-10px) rotate(3deg) VAR_FLIP; }
  45% { transform: translateY(-3px) rotate(-1deg) VAR_FLIP; }
  65% { transform: translateY(-7px) rotate(2deg) VAR_FLIP; }
  100% { transform: translateY(0) rotate(0deg) VAR_FLIP; }
}

/* Spin-bounce: excited double bounce with rotation */
@keyframes pet-spin-bounce {
  0% { transform: translateY(0) rotate(0deg) scale(1) VAR_FLIP; }
  20% { transform: translateY(-12px) rotate(8deg) scale(1.08) VAR_FLIP; }
  40% { transform: translateY(-4px) rotate(-3deg) scale(0.97) VAR_FLIP; }
  60% { transform: translateY(-10px) rotate(5deg) scale(1.05) VAR_FLIP; }
  80% { transform: translateY(-2px) rotate(-2deg) scale(0.98) VAR_FLIP; }
  100% { transform: translateY(0) rotate(0deg) scale(1) VAR_FLIP; }
}

/* Droop: sad ghost sinking and fading */
@keyframes pet-droop {
  0% { transform: translateY(0) scale(1) rotate(0deg) VAR_FLIP; }
  100% { transform: translateY(4px) scale(0.96) rotate(-2deg) VAR_FLIP; opacity: 0.5; }
}

/* Flicker: angry ghost rapidly flickering in and out */
@keyframes pet-flicker {
  0%, 100% { transform: translateX(0) VAR_FLIP; opacity: 0.8; }
  10% { transform: translateX(-3px) VAR_FLIP; opacity: 0.4; }
  20% { transform: translateX(3px) VAR_FLIP; opacity: 0.9; }
  30% { transform: translateX(-2px) VAR_FLIP; opacity: 0.3; }
  40% { transform: translateX(2px) VAR_FLIP; opacity: 0.85; }
  50% { transform: translateX(0) VAR_FLIP; opacity: 0.7; }
  70% { transform: translateX(-1px) VAR_FLIP; opacity: 0.5; }
  90% { transform: translateX(1px) VAR_FLIP; opacity: 0.75; }
}

/* Phase: surprised ghost briefly phasing through reality */
@keyframes pet-phase {
  0% { transform: scale(1) VAR_FLIP; opacity: 0.7; }
  25% { transform: scale(1.25) VAR_FLIP; opacity: 0.3; }
  50% { transform: scale(0.9) VAR_FLIP; opacity: 0.9; }
  75% { transform: scale(1.05) VAR_FLIP; opacity: 0.6; }
  100% { transform: scale(1) VAR_FLIP; opacity: 0.7; }
}

/* Glow-pulse: love ghost warmly glowing */
@keyframes pet-glow-pulse {
  0%, 100% { transform: scale(1) VAR_FLIP; filter: brightness(1) drop-shadow(0 0 0px transparent); }
  50% { transform: scale(1.08) VAR_FLIP; filter: brightness(1.2) drop-shadow(0 0 6px rgba(207, 142, 140, 0.6)); }
}

/* Hide: shy ghost shrinking and turning away */
@keyframes pet-hide {
  0% { transform: scale(1) rotate(0deg) translateX(0) VAR_FLIP; }
  40% { transform: scale(0.88) rotate(-5deg) translateX(-3px) VAR_FLIP; opacity: 0.5; }
  100% { transform: scale(0.85) rotate(-4deg) translateX(-2px) VAR_FLIP; opacity: 0.55; }
}

/* Ghost wobble: being blown by wind */
@keyframes pet-wobble {
  0%, 100% { transform: rotate(0deg) translateX(0) translateY(0) VAR_FLIP; }
  10% { transform: rotate(-10deg) translateX(-5px) translateY(-2px) VAR_FLIP; }
  25% { transform: rotate(8deg) translateX(4px) translateY(-4px) VAR_FLIP; }
  40% { transform: rotate(-6deg) translateX(-3px) translateY(-2px) VAR_FLIP; }
  55% { transform: rotate(5deg) translateX(2px) translateY(-3px) VAR_FLIP; }
  70% { transform: rotate(-3deg) translateX(-2px) translateY(-1px) VAR_FLIP; }
  85% { transform: rotate(2deg) translateX(1px) translateY(-2px) VAR_FLIP; }
}

/* Ghost celebrate: joyful spinning rise */
@keyframes pet-celebrate {
  0% { transform: translateY(0) scale(1) rotate(0deg) VAR_FLIP; }
  15% { transform: translateY(-12px) scale(1.1) rotate(8deg) VAR_FLIP; }
  30% { transform: translateY(-6px) scale(1.05) rotate(-5deg) VAR_FLIP; }
  45% { transform: translateY(-16px) scale(1.12) rotate(10deg) VAR_FLIP; opacity: 0.5; }
  60% { transform: translateY(-8px) scale(1.05) rotate(-6deg) VAR_FLIP; opacity: 0.8; }
  75% { transform: translateY(-14px) scale(1.08) rotate(5deg) VAR_FLIP; opacity: 0.55; }
  90% { transform: translateY(-4px) scale(1.02) rotate(-2deg) VAR_FLIP; }
  100% { transform: translateY(0) scale(1) rotate(0deg) VAR_FLIP; }
}
`

export class SvgPetRenderer {
  private container: HTMLElement
  private svgWrap: HTMLDivElement
  private ghostTrail: HTMLDivElement
  private styleEl: HTMLStyleElement
  private spriteSet: PetSpriteSet | null = null
  private availableKeys: Set<PetSpriteKey> = new Set()
  private currentKey: PetSpriteKey = 'stand_neutral'
  private state: SvgRendererState = { pose: 'stand', expression: 'neutral', flipped: false }
  private walkFrame = 0
  private walkTimer = 0
  private blinkTimer = 0
  private targetOpacity = 0.7
  private currentOpacity = 0.7
  private isMoving = false
  private transientAnimationActive = false
  private transientAnimationToken = 0

  constructor(container: HTMLElement, size: number) {
    this.container = container
    this.container.style.width = `${size}px`
    this.container.style.height = `${size}px`
    this.container.style.overflow = 'visible'
    this.container.style.position = 'relative'

    this.styleEl = document.createElement('style')
    this.styleEl.textContent = ANIM_KEYFRAMES.replace(/VAR_FLIP/g, '')
    document.head.appendChild(this.styleEl)

    this.ghostTrail = document.createElement('div')
    this.ghostTrail.style.cssText = 'width:100%;height:100%;position:absolute;top:0;left:0;pointer-events:none;opacity:0;filter:blur(3px);transition:opacity 0.3s;transform-origin:center bottom;'
    this.container.appendChild(this.ghostTrail)

    this.svgWrap = document.createElement('div')
    this.svgWrap.style.width = '100%'
    this.svgWrap.style.height = '100%'
    this.svgWrap.style.imageRendering = 'pixelated'
    this.svgWrap.style.position = 'absolute'
    this.svgWrap.style.opacity = '0.7'
    this.svgWrap.style.top = '0'
    this.svgWrap.style.left = '0'
    this.svgWrap.style.transformOrigin = 'center bottom'
    this.svgWrap.style.transition = 'filter 0.5s ease, opacity 0.15s ease'
    this.container.appendChild(this.svgWrap)

    this.updateAnimation()
  }

  loadSpriteSet(spriteSet: PetSpriteSet) {
    this.spriteSet = spriteSet
    this.availableKeys = new Set(
      Object.keys(spriteSet.sprites) as PetSpriteKey[]
    )
    logPetPresentation('renderer.sprite-set.load', {
      id: spriteSet.id,
      name: spriteSet.name,
      spriteCount: this.availableKeys.size,
      keys: [...this.availableKeys],
    })
    this.applySprite()
  }

  setExpression(expression: PetExpression) {
    if (this.state.expression === expression) return
    logPetPresentation('renderer.expression.set', {
      from: this.state.expression,
      to: expression,
      pose: this.state.pose,
    })
    this.state.expression = expression
    this.applySprite()
    this.playExpressionAnim(expression)
  }

  private exprAnimTimer = 0
  private namedAnimTimer = 0

  private playExpressionAnim(expression: PetExpression) {
    const exprAnim = EXPR_ANIMATIONS[expression]
    if (!exprAnim) return

    logPetPresentation('renderer.expression.animation', { expression, animation: exprAnim })
    clearTimeout(this.exprAnimTimer)
    const token = ++this.transientAnimationToken
    this.transientAnimationActive = true
    this.svgWrap.style.animation = 'none'
    void this.svgWrap.offsetHeight
    this.svgWrap.style.animation = exprAnim

    if (expression === 'love' || expression === 'excited') {
      this.svgWrap.style.filter = 'drop-shadow(0 0 4px rgba(207, 142, 140, 0.5))'
    } else if (expression === 'angry') {
      this.svgWrap.style.filter = 'drop-shadow(0 0 3px rgba(200, 80, 80, 0.4))'
    }

    const dur = parseFloat(exprAnim.match(/[\d.]+s/)?.[0] || '0.5') * 1000
    const count = parseInt(exprAnim.match(/(\d+)$/)?.[1] || '1')
    const isFwd = exprAnim.includes('forwards')

    if (!isFwd) {
      this.exprAnimTimer = window.setTimeout(() => {
        if (token !== this.transientAnimationToken) return
        this.transientAnimationActive = false
        this.svgWrap.style.filter = ''
        this.updateAnimation()
      }, dur * count + 50)
    } else {
      this.exprAnimTimer = window.setTimeout(() => {
        if (token !== this.transientAnimationToken) return
        this.transientAnimationActive = false
        this.svgWrap.style.filter = ''
      }, dur * count + 500)
    }
  }

  playAnimation(animation: string) {
    const anim = NAMED_ANIMATIONS[animation]
    if (!anim) {
      logPetPresentation('renderer.animation.missing', { animation })
      return
    }

    logPetPresentation('renderer.animation.play', { animation, css: anim })
    clearTimeout(this.namedAnimTimer)
    const token = ++this.transientAnimationToken
    this.transientAnimationActive = true
    this.svgWrap.style.animation = 'none'
    void this.svgWrap.offsetHeight
    this.svgWrap.style.animation = anim

    const dur = parseFloat(anim.match(/[\d.]+s/)?.[0] || '0.6') * 1000
    const count = parseInt(anim.match(/(\d+)$/)?.[1] || '1')
    this.namedAnimTimer = window.setTimeout(() => {
      if (token !== this.transientAnimationToken) return
      this.transientAnimationActive = false
      this.updateAnimation()
    }, dur * count + 80)
  }

  setPose(pose: PetPose) {
    if (this.state.pose === pose) return
    const wasMoving = this.state.pose === 'walk_1' || this.state.pose === 'walk_2'
    logPetPresentation('renderer.pose.set', {
      from: this.state.pose,
      to: pose,
      expression: this.state.expression,
    })
    this.state.pose = pose
    this.targetOpacity = POSE_OPACITY[pose] ?? 0.7
    this.applySprite()
    this.updateAnimation()

    const moving = pose === 'walk_1' || pose === 'walk_2'
    if (moving !== wasMoving) {
      this.isMoving = moving
      if (moving) {
        this.syncTrailContent()
        this.ghostTrail.style.opacity = '0.25'
      } else {
        this.ghostTrail.style.opacity = '0'
      }
    }
  }

  private syncTrailContent() {
    while (this.ghostTrail.firstChild) {
      this.ghostTrail.removeChild(this.ghostTrail.firstChild)
    }
    const sourceSvg = this.svgWrap.querySelector('svg')
    if (!sourceSvg) return
    const cloned = sourceSvg.cloneNode(true) as SVGSVGElement
    cloned.style.width = '100%'
    cloned.style.height = '100%'
    cloned.style.display = 'block'
    this.ghostTrail.appendChild(cloned)
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

    const opacityDiff = this.targetOpacity - this.currentOpacity
    if (Math.abs(opacityDiff) > 0.01) {
      this.currentOpacity += opacityDiff * Math.min(1, deltaMs / 300)
      this.svgWrap.style.opacity = String(this.currentOpacity)
    }

    if (this.isMoving) {
      this.ghostTrail.style.transform = this.state.flipped ? 'scaleX(-1) translateX(4px)' : 'translateX(-4px)'
    }

    this.blinkTimer += deltaMs
    if (this.blinkTimer > 3500 + Math.random() * 2000) {
      this.blinkTimer = 0
      this.doBlink()
    }
  }

  private updateAnimation() {
    if (this.transientAnimationActive) return

    const flipStr = this.state.flipped ? 'scaleX(-1)' : ''

    this.styleEl.textContent = ANIM_KEYFRAMES.replace(/VAR_FLIP/g, flipStr)

    const poseBase = this.state.pose.startsWith('walk_') ? 'walk_1' : this.state.pose
    const anim = POSE_ANIMATIONS[poseBase] || POSE_ANIMATIONS['stand']
    if (this.svgWrap.style.animation !== anim) {
      this.svgWrap.style.animation = anim
    }
  }

  private doBlink() {
    if (this.state.pose === 'sleep') return
    const base = this.targetOpacity
    this.svgWrap.style.opacity = String(base * 0.82)
    setTimeout(() => {
      this.currentOpacity = base
      this.svgWrap.style.opacity = String(base)
    }, 150)
  }

  private applySprite() {
    if (!this.spriteSet) {
      logPetPresentation('renderer.sprite.skipped', {
        reason: 'missing-sprite-set',
        pose: this.state.pose,
        expression: this.state.expression,
      })
      return
    }

    const key = resolveSpriteKey(this.availableKeys, this.state.pose, this.state.expression)
    if (key === this.currentKey) return
    this.currentKey = key

    const svg = this.spriteSet.sprites[key]
    if (!svg) {
      logPetPresentation('renderer.sprite.missing', {
        key,
        pose: this.state.pose,
        expression: this.state.expression,
      })
      return
    }

    const sanitized = sanitizeSvgString(svg)
    if (!sanitized) {
      logPetPresentation('renderer.sprite.rejected', {
        key,
        reason: 'sanitize-failed',
        size: svg.length,
      })
      return
    }

    logPetPresentation('renderer.sprite.apply', {
      requested: `${this.state.pose}_${this.state.expression}`,
      applied: key,
      fallback: key !== `${this.state.pose}_${this.state.expression}`,
    })

    while (this.svgWrap.firstChild) {
      this.svgWrap.removeChild(this.svgWrap.firstChild)
    }
    sanitized.style.width = '100%'
    sanitized.style.height = '100%'
    sanitized.style.display = 'block'
    this.svgWrap.appendChild(sanitized)

    if (this.isMoving) {
      this.syncTrailContent()
    }
  }

  destroy() {
    clearTimeout(this.exprAnimTimer)
    clearTimeout(this.namedAnimTimer)
    const safeRemove = (parent: ParentNode | null, child: Element) => {
      if (!parent) return
      if (child.parentNode === parent) {
        try {
          parent.removeChild(child)
        } catch {
          /* node already detached */
        }
      }
    }
    safeRemove(this.container, this.svgWrap)
    safeRemove(this.container, this.ghostTrail)
    safeRemove(document.head, this.styleEl)
  }
}
