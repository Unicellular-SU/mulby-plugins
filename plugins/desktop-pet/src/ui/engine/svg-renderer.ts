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
  stand: 'pet-float 3.2s ease-in-out infinite',
  walk_1: 'pet-walk-step-a 0.52s ease-in-out',
  walk_2: 'pet-walk-step-b 0.52s ease-in-out',
  sit: 'pet-settle 4.2s ease-in-out infinite',
  sleep: 'pet-slumber 5.4s ease-in-out infinite',
  jump: 'pet-ascend 0.62s ease-out',
  wave: 'pet-wave-idle 1.4s ease-in-out infinite',
  hover: 'pet-hover-loop 2.7s ease-in-out infinite',
  peek: 'pet-peek-idle 1.8s ease-in-out infinite',
  spin: 'pet-spin-loop 1.4s ease-in-out infinite',
  dance: 'pet-dance-loop 1s ease-in-out infinite',
  hide: 'pet-hide-idle 2.4s ease-in-out infinite',
  focus: 'pet-focus-idle 2s ease-in-out infinite',
}

const EXPR_ANIMATIONS: Record<string, string> = {
  happy: 'pet-bounce 0.5s ease-out',
  excited: 'pet-cheer 0.75s ease-out',
  sad: 'pet-droop 0.6s ease-out forwards',
  angry: 'pet-flicker 0.4s ease-in-out 3',
  surprised: 'pet-phase 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)',
  love: 'pet-glow-pulse 1s ease-in-out 2',
  sleepy: 'pet-drowsy 1.1s ease-out forwards',
  shy: 'pet-hide 0.5s ease-out forwards',
  curious: 'pet-peek 0.75s ease-out',
  confused: 'pet-wobble 0.85s ease-in-out',
  proud: 'pet-bounce 0.55s ease-out',
  scared: 'pet-flicker 0.35s ease-in-out 4',
  focused: 'pet-focus-pulse 1s ease-in-out 2',
  dizzy: 'pet-wobble 1s ease-in-out',
}

const NAMED_ANIMATIONS: Record<string, string> = {
  bounce: 'pet-bounce 0.5s ease-out',
  spin_bounce: 'pet-cheer 0.75s ease-out',
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
  hover: 0.72,
  peek: 0.74,
  spin: 0.76,
  dance: 0.78,
  hide: 0.52,
  focus: 0.7,
}

const ANIM_KEYFRAMES = `
/* All animations move the wrapper only; the SVG silhouette is never squashed or stretched. */
@keyframes pet-float {
  0%, 100% { transform: translateY(0) translateX(0) rotate(0deg) VAR_FLIP; }
  30% { transform: translateY(-5px) translateX(2px) rotate(0.8deg) VAR_FLIP; }
  55% { transform: translateY(-8px) translateX(0) rotate(0deg) VAR_FLIP; }
  80% { transform: translateY(-4px) translateX(-2px) rotate(-0.8deg) VAR_FLIP; }
}

/* Walk frame A: light forward glide. */
@keyframes pet-walk-step-a {
  0% { transform: translateY(0) translateX(0) rotate(0deg) VAR_FLIP; }
  35% { transform: translateY(-6px) translateX(3px) rotate(1.8deg) VAR_FLIP; }
  70% { transform: translateY(-2px) translateX(4px) rotate(0.8deg) VAR_FLIP; }
  100% { transform: translateY(0) translateX(0) rotate(0deg) VAR_FLIP; }
}

/* Walk frame B: alternate glide with a different timing accent. */
@keyframes pet-walk-step-b {
  0% { transform: translateY(-2px) translateX(0) rotate(0deg) VAR_FLIP; }
  40% { transform: translateY(-4px) translateX(-3px) rotate(-1.8deg) VAR_FLIP; }
  75% { transform: translateY(-7px) translateX(-4px) rotate(-0.6deg) VAR_FLIP; }
  100% { transform: translateY(-2px) translateX(0) rotate(0deg) VAR_FLIP; }
}

/* Sit: slower, lower hover with drowsy opacity. */
@keyframes pet-settle {
  0%, 100% { transform: translateY(4px) rotate(0deg) VAR_FLIP; opacity: 0.62; }
  40% { transform: translateY(1px) rotate(0.45deg) VAR_FLIP; opacity: 0.68; }
  75% { transform: translateY(6px) rotate(-0.45deg) VAR_FLIP; opacity: 0.56; }
}

/* Sleep: dreamy float, using opacity and blur instead of extra SVG marks. */
@keyframes pet-slumber {
  0%, 100% { transform: translateY(5px) rotate(-0.8deg) VAR_FLIP; opacity: 0.46; filter: blur(0px); }
  30% { transform: translateY(7px) rotate(-0.3deg) VAR_FLIP; opacity: 0.4; filter: blur(0.2px); }
  60% { transform: translateY(9px) rotate(0.6deg) VAR_FLIP; opacity: 0.34; filter: blur(0.35px); }
}

/* Jump: a short float-hop without silhouette deformation. */
@keyframes pet-ascend {
  0% { transform: translateY(0) rotate(0deg) VAR_FLIP; }
  28% { transform: translateY(-14px) rotate(-2deg) VAR_FLIP; }
  55% { transform: translateY(-19px) rotate(1.8deg) VAR_FLIP; opacity: 0.66; }
  78% { transform: translateY(-7px) rotate(-0.8deg) VAR_FLIP; opacity: 0.74; }
  100% { transform: translateY(0) rotate(0deg) VAR_FLIP; }
}

/* Wiggle: greeting/excitement through rotation only. */
@keyframes pet-wiggle {
  0%, 100% { transform: rotate(0deg) translateY(0) VAR_FLIP; }
  18% { transform: rotate(-6deg) translateY(-4px) VAR_FLIP; }
  40% { transform: rotate(6deg) translateY(-6px) VAR_FLIP; }
  62% { transform: rotate(-4deg) translateY(-4px) VAR_FLIP; }
  82% { transform: rotate(3deg) translateY(-2px) VAR_FLIP; }
}

/* Wave: friendly side-to-side hover; the face carries the gesture. */
@keyframes pet-wave-idle {
  0%, 100% { transform: rotate(0deg) translateY(0) VAR_FLIP; }
  30% { transform: rotate(-4deg) translateY(-4px) VAR_FLIP; }
  60% { transform: rotate(4deg) translateY(-2px) VAR_FLIP; }
}

/* Hover: higher airy float with a wider drift path. */
@keyframes pet-hover-loop {
  0%, 100% { transform: translateY(-4px) translateX(0) rotate(0deg) VAR_FLIP; opacity: 0.72; }
  25% { transform: translateY(-13px) translateX(5px) rotate(1.8deg) VAR_FLIP; opacity: 0.78; }
  50% { transform: translateY(-18px) translateX(0) rotate(0deg) VAR_FLIP; opacity: 0.7; }
  75% { transform: translateY(-11px) translateX(-5px) rotate(-1.8deg) VAR_FLIP; opacity: 0.76; }
}

/* Peek: curious side lean without changing the SVG body. */
@keyframes pet-peek-idle {
  0%, 100% { transform: translateX(0) translateY(0) rotate(0deg) VAR_FLIP; }
  35% { transform: translateX(8px) translateY(-5px) rotate(5deg) VAR_FLIP; }
  70% { transform: translateX(-4px) translateY(-2px) rotate(-2.5deg) VAR_FLIP; }
}

/* Spin: playful ghost turn using rotation only. */
@keyframes pet-spin-loop {
  0%, 100% { transform: translateY(0) rotate(0deg) VAR_FLIP; opacity: 0.76; }
  25% { transform: translateY(-7px) rotate(8deg) VAR_FLIP; opacity: 0.62; }
  50% { transform: translateY(-2px) rotate(-6deg) VAR_FLIP; opacity: 0.82; }
  75% { transform: translateY(-9px) rotate(5deg) VAR_FLIP; opacity: 0.68; }
}

/* Dance: rhythmic sway for lively moments. */
@keyframes pet-dance-loop {
  0%, 100% { transform: translateX(0) translateY(0) rotate(0deg) VAR_FLIP; }
  20% { transform: translateX(-7px) translateY(-6px) rotate(-7deg) VAR_FLIP; }
  40% { transform: translateX(6px) translateY(-3px) rotate(6deg) VAR_FLIP; }
  65% { transform: translateX(-4px) translateY(-8px) rotate(-4deg) VAR_FLIP; }
  85% { transform: translateX(4px) translateY(-2px) rotate(3deg) VAR_FLIP; }
}

/* Hide pose: turned-away idle, expressed through opacity and offset. */
@keyframes pet-hide-idle {
  0%, 100% { transform: translateX(-4px) translateY(2px) rotate(-4deg) VAR_FLIP; opacity: 0.54; }
  50% { transform: translateX(-8px) translateY(-2px) rotate(-6deg) VAR_FLIP; opacity: 0.44; }
}

/* Focus pose: steady hover with a cool glow. */
@keyframes pet-focus-idle {
  0%, 100% { transform: translateY(0) rotate(0deg) VAR_FLIP; filter: brightness(1); }
  50% { transform: translateY(-6px) rotate(0.4deg) VAR_FLIP; filter: brightness(1.14) drop-shadow(0 0 5px rgba(120, 170, 190, 0.35)); }
}

/* Bounce: happy float-pop. */
@keyframes pet-bounce {
  0% { transform: translateY(0) rotate(0deg) VAR_FLIP; }
  22% { transform: translateY(-12px) rotate(2.8deg) VAR_FLIP; }
  48% { transform: translateY(-3px) rotate(-1deg) VAR_FLIP; }
  70% { transform: translateY(-7px) rotate(1.6deg) VAR_FLIP; }
  100% { transform: translateY(0) rotate(0deg) VAR_FLIP; }
}

/* Cheer: energetic glow and light hops, not body stretching. */
@keyframes pet-cheer {
  0% { transform: translateY(0) rotate(0deg) VAR_FLIP; filter: brightness(1); }
  20% { transform: translateY(-11px) rotate(-4deg) VAR_FLIP; filter: brightness(1.16); }
  42% { transform: translateY(-2px) rotate(2deg) VAR_FLIP; filter: brightness(1); }
  64% { transform: translateY(-9px) rotate(4deg) VAR_FLIP; filter: brightness(1.2); }
  82% { transform: translateY(-3px) rotate(-1.5deg) VAR_FLIP; filter: brightness(1.08); }
  100% { transform: translateY(0) rotate(0deg) VAR_FLIP; filter: brightness(1); }
}

/* Drowsy: eyelid expression plus a tiny downward drift. */
@keyframes pet-drowsy {
  0% { transform: translateY(0) rotate(0deg) VAR_FLIP; opacity: 0.72; filter: blur(0px); }
  100% { transform: translateY(6px) rotate(-0.8deg) VAR_FLIP; opacity: 0.55; filter: blur(0.15px); }
}

/* Droop: sad ghost sinking and fading. */
@keyframes pet-droop {
  0% { transform: translateY(0) rotate(0deg) VAR_FLIP; }
  100% { transform: translateY(7px) rotate(-1.8deg) VAR_FLIP; opacity: 0.5; }
}

/* Flicker: angry ghost rapidly flickering in place. */
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

/* Phase: surprised ghost briefly blinking through reality. */
@keyframes pet-phase {
  0% { transform: translateY(0) rotate(0deg) VAR_FLIP; opacity: 0.7; filter: blur(0px); }
  25% { transform: translateY(-9px) rotate(-3deg) VAR_FLIP; opacity: 0.3; filter: blur(0.75px); }
  50% { transform: translateY(2px) rotate(1.8deg) VAR_FLIP; opacity: 0.92; filter: blur(0px); }
  75% { transform: translateY(-4px) rotate(-1deg) VAR_FLIP; opacity: 0.62; filter: blur(0.25px); }
  100% { transform: translateY(0) rotate(0deg) VAR_FLIP; opacity: 0.7; filter: blur(0px); }
}

/* Glow-pulse: love ghost warmly glowing. */
@keyframes pet-glow-pulse {
  0%, 100% { transform: translateY(0) VAR_FLIP; filter: brightness(1) drop-shadow(0 0 0px transparent); }
  50% { transform: translateY(-5px) VAR_FLIP; filter: brightness(1.25) drop-shadow(0 0 8px rgba(207, 142, 140, 0.65)); }
}

/* Hide: shy ghost turning away through opacity and rotation. */
@keyframes pet-hide {
  0% { transform: rotate(0deg) translateX(0) VAR_FLIP; }
  40% { transform: rotate(-5deg) translateX(-5px) VAR_FLIP; opacity: 0.48; }
  100% { transform: rotate(-4deg) translateX(-4px) VAR_FLIP; opacity: 0.55; }
}

/* Wobble: playful side sway without changing proportions. */
@keyframes pet-wobble {
  0%, 100% { transform: rotate(0deg) translateX(0) translateY(0) VAR_FLIP; }
  12% { transform: rotate(-7deg) translateX(-6px) translateY(-2px) VAR_FLIP; }
  28% { transform: rotate(6deg) translateX(5px) translateY(-5px) VAR_FLIP; }
  45% { transform: rotate(-4deg) translateX(-4px) translateY(-2px) VAR_FLIP; }
  62% { transform: rotate(3.5deg) translateX(4px) translateY(-4px) VAR_FLIP; }
  80% { transform: rotate(-2deg) translateX(-2px) translateY(-2px) VAR_FLIP; }
}

/* Celebrate: bright ghostly orbit using position, opacity, and glow only. */
@keyframes pet-celebrate {
  0% { transform: translateY(0) translateX(0) rotate(0deg) VAR_FLIP; filter: brightness(1); }
  18% { transform: translateY(-13px) translateX(4px) rotate(4deg) VAR_FLIP; filter: brightness(1.18) drop-shadow(0 0 5px rgba(207, 142, 140, 0.5)); }
  36% { transform: translateY(-5px) translateX(-4px) rotate(-3deg) VAR_FLIP; filter: brightness(1); }
  58% { transform: translateY(-17px) translateX(3px) rotate(5deg) VAR_FLIP; opacity: 0.62; filter: brightness(1.22) drop-shadow(0 0 8px rgba(207, 142, 140, 0.55)); }
  76% { transform: translateY(-7px) translateX(-2px) rotate(-2deg) VAR_FLIP; opacity: 0.82; filter: brightness(1.08); }
  100% { transform: translateY(0) translateX(0) rotate(0deg) VAR_FLIP; filter: brightness(1); }
}

@keyframes pet-peek {
  0% { transform: translateX(0) translateY(0) rotate(0deg) VAR_FLIP; }
  35% { transform: translateX(6px) translateY(-5px) rotate(4deg) VAR_FLIP; }
  70% { transform: translateX(-3px) translateY(-2px) rotate(-2deg) VAR_FLIP; }
  100% { transform: translateX(0) translateY(0) rotate(0deg) VAR_FLIP; }
}

@keyframes pet-focus-pulse {
  0%, 100% { transform: translateY(0) rotate(0deg) VAR_FLIP; filter: brightness(1); }
  50% { transform: translateY(-3px) rotate(0deg) VAR_FLIP; filter: brightness(1.12) drop-shadow(0 0 5px rgba(120, 170, 190, 0.35)); }
}
`

export class SvgPetRenderer {
  private container: HTMLElement
  private svgWrap: HTMLDivElement
  private ghostTrail: HTMLDivElement
  private styleEl: HTMLStyleElement
  private spriteSet: PetSpriteSet | null = null
  private availableKeys: Set<PetSpriteKey> = new Set()
  private currentKey: PetSpriteKey | null = null
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
    if (expression === 'neutral') {
      this.transientAnimationToken++
      this.transientAnimationActive = false
      this.svgWrap.style.filter = ''
      this.updateAnimation()
      return
    }
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

    if (expression === 'love' || expression === 'excited' || expression === 'proud') {
      this.svgWrap.style.filter = 'drop-shadow(0 0 4px rgba(207, 142, 140, 0.5))'
    } else if (expression === 'angry') {
      this.svgWrap.style.filter = 'drop-shadow(0 0 3px rgba(200, 80, 80, 0.4))'
    } else if (expression === 'focused' || expression === 'curious') {
      this.svgWrap.style.filter = 'drop-shadow(0 0 3px rgba(120, 170, 190, 0.35))'
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
          this.updateAnimation()
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

    const anim = POSE_ANIMATIONS[this.state.pose] || POSE_ANIMATIONS['stand']
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
    if (key === this.currentKey && this.svgWrap.firstChild) return
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
