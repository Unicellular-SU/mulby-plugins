import { createInputState } from './input'
import type { Vec2, InputState, Camera, HeroState, EnemyState, Projectile, LootDrop, DamageNumber, Particle, DungeonState, Floor, MetaProgress, AbilityDef, AbilityInstance, ItemDef, ActiveSynergy, AttackArc, CloneState, RoomEvent, ActiveItemState, TeamSynergyDef, RunStats } from './types'
import { HEROES } from './data/heroes'
import { ENEMIES, FLOOR_ENEMY_POOLS } from './data/enemies'
import { ABILITIES } from './data/abilities'
import { DEFAULT_ABILITIES } from './data/abilities'
import { ITEMS } from './data/items'
import { SYNERGIES } from './data/synergies'
import { generateEvent } from './data/events'
import { getRandomAffix, ELITE_AFFIXES } from './data/eliteAffixes'
import { randomActiveItem } from './data/activeItems'
import { checkTeamSynergies } from './data/teamSynergies'
import * as sfx from './sfx'

let nextId = 1
const uid = () => nextId++

const ROOM_W = 760
const ROOM_H = 560
const WALL = 20
const XP_PER_LEVEL = (lv: number) => 30 + lv * 20

export type GameEvent =
  | { type: 'level_up'; choices: AbilityDef[]; heroName: string; heroColor: string }
  | { type: 'synergy'; name: string; desc: string; color: string }
  | { type: 'floor_clear'; floor: number }
  | { type: 'run_end'; crystals: number; floor: number; runStats?: RunStats }
  | { type: 'item_drop'; item: ItemDef }
  | { type: 'event_room'; event: RoomEvent }
  | { type: 'achievement'; name: string; desc: string; crystals: number }

export class GameEngine {
  state: DungeonState
  input: InputState
  camera: Camera
  meta: MetaProgress
  events: GameEvent[]
  private animFrame = 0
  private lastTime = 0
  private running = false
  private onEvent: (e: GameEvent) => void
  private waveTimer = 0
  private enemiesKilledThisFloor = 0
  private enemiesNeededThisFloor = 0
  private portalSpawned = false
  private portalX = 0
  private portalY = 0
  private heroRevived: Record<number, boolean> = {}
  private levelUpHeroIndex = 0

  constructor(meta: MetaProgress, onEvent: (e: GameEvent) => void, heroIds?: string[]) {
    this.meta = meta
    this.onEvent = onEvent
    this.events = []
    this.input = createInputState()
    this.camera = { x: 0, y: 0, width: 800, height: 600 }

    // 初始化3人小队
    const ids = heroIds && heroIds.length > 0 ? heroIds : meta.unlockedHeroes.slice(0, 3)
    const heroes = ids.map((id, i) => this.createHero(id, 200 + i * 80, 300))
    const floor = this.generateFloor(1)

    this.state = {
      floor,
      heroes,
      projectiles: [],
      activeSynergies: [],
      crystals: 0,
      floorLevel: 1,
      isPaused: false,
      isLevelUpPending: false,
      levelUpChoices: [],
      activeHeroIndex: 0,
      gameTime: 0,
      damageNumbers: [],
      particles: [],
      synergyPopup: null,
      screenShake: 0,
      hitstop: 0,
      attackArcs: [],
      clone: null,
      // === 新系统 ===
      isEventPending: false,
      currentEvent: null,
      activeItem: null,
      activeTeamSynergies: checkTeamSynergies(ids),
      runStats: {
        heroesUsed: ids,
        synergiesTriggered: [],
        maxFloor: 1,
        enemiesKilled: 0,
        itemsCollected: [],
        bossKilledFullHp: false,
        startTime: Date.now(),
        victory: false,
      },
    }
    this.setupWave(1)
  }

  private createHero(id: string, x: number, y: number): HeroState {
    const baseDef = HEROES[id] || HEROES['warrior']
    const atkMult = 1 + this.meta.attackLevel * 0.05
    const hpMult = 1 + this.meta.healthLevel * 0.05
    const weaponBonus = this.meta.weaponLevel * 2 // 每级锻造+2攻击

    const def = {
      ...baseDef,
      attack: Math.round(baseDef.attack * atkMult) + weaponBonus,
    }

    return {
      def,
      x, y,
      hp: Math.round(def.maxHp * hpMult),
      maxHp: Math.round(def.maxHp * hpMult),
      xp: 0, level: 1,
      abilities: [],
      items: [null, null, null],
      attackCooldown: 0,
      skillCooldown: 0,
      isActive: id === (this.meta.unlockedHeroes?.[0] ?? 'warrior'),
      isDead: false,
      buffs: [],
      vx: 0, vy: 0,
      targetX: x, targetY: y,
    }
  }

  private generateFloor(level: number): Floor {
    return { level, rooms: [], currentRoomId: 0, enemies: [], loot: [] }
  }

  private setupWave(floorLevel: number) {
    const poolIdx = floorLevel <= 10 ? floorLevel : ((floorLevel - 1) % 5) + 6 // >10层循环5-10池
    const pool = FLOOR_ENEMY_POOLS[poolIdx] || FLOOR_ENEMY_POOLS[10]
    const isBossFloor = floorLevel % 3 === 0
    const baseCount = Math.min(3 + floorLevel * 2, 25) // 最多25只
    this.enemiesKilledThisFloor = 0
    this.enemiesNeededThisFloor = isBossFloor ? baseCount + 3 : baseCount
    this.portalSpawned = false
    this.waveTimer = 0

    // 生成初始敌人
    const count = isBossFloor ? 4 : Math.min(baseCount, 8)
    for (let i = 0; i < count; i++) {
      this.spawnEnemy(pool, floorLevel)
    }

    // === 精英敌人：每层 5%~15% 概率升级 1 只普通怪 ===
    if (!isBossFloor) {
      const eliteChance = 0.05 + floorLevel * 0.01
      if (Math.random() < eliteChance && this.state.floor.enemies.length > 0) {
        const idx = Math.floor(Math.random() * this.state.floor.enemies.length)
        this.upgradeToElite(this.state.floor.enemies[idx])
      }
    }
  }

  private spawnEnemy(pool: string[], floorLevel: number) {
    const enemyId = pool[Math.floor(Math.random() * pool.length)]
    const def = ENEMIES.find(e => e.id === enemyId)
    if (!def || (def.isBoss && this.state.floorLevel % 3 !== 0)) return

    // 避免重复spawn boss
    if (def.isBoss && this.state.floor.enemies.some(e => e.def.isBoss && !e.isDead)) return

    // === 全面属性成长 ===
    const hpMult = 1 + (floorLevel - 1) * 0.18
    const atkMult = 1 + (floorLevel - 1) * 0.12
    const spdMult = Math.min(1 + (floorLevel - 1) * 0.05, 2.0) // 速度最多2倍
    const atkSpdMult = Math.max(0.5, 1 - (floorLevel - 1) * 0.03) // 攻速最多快50%

    const side = Math.floor(Math.random() * 4)
    let x: number, y: number
    switch (side) {
      case 0: x = WALL + Math.random() * (ROOM_W - WALL * 2); y = WALL + 10; break
      case 1: x = ROOM_W - WALL - 10; y = WALL + Math.random() * (ROOM_H - WALL * 2); break
      case 2: x = WALL + Math.random() * (ROOM_W - WALL * 2); y = ROOM_H - WALL - 10; break
      default: x = WALL + 10; y = WALL + Math.random() * (ROOM_H - WALL * 2); break
    }

    // 创建敌人，带缩放后的属性
    const scaledDef = {
      ...def,
      maxHp: Math.round(def.maxHp * hpMult),
      attack: Math.round(def.attack * atkMult),
      speed: +(def.speed * spdMult).toFixed(2),
      attackSpeed: Math.round(def.attackSpeed * atkSpdMult),
    }

    this.state.floor.enemies.push({
      id: uid(), def: scaledDef, x, y,
      hp: scaledDef.maxHp,
      maxHp: scaledDef.maxHp,
      attackCooldown: 0,
      buffs: [], isDead: false,
      targetHeroId: 0,
      stunTimer: 0, slowTimer: 0,
      burnTimer: 0, burnDps: 0,
      oilCovered: false,
      hitFlash: 0, knockbackVx: 0, knockbackVy: 0,
      markHits: 0,
      // === 精英敌人 ===
      isElite: false,
      eliteAffix: '',
      eliteColor: '',
      shieldValue: 0,
      shieldTimer: 0,
    })
  }

  // ========== 精英敌人 ==========
  private upgradeToElite(enemy: EnemyState) {
    const affixDef = getRandomAffix()
    enemy.isElite = true
    enemy.eliteAffix = affixDef.affix
    enemy.eliteColor = affixDef.color
    // 应用词缀属性倍率
    if (affixDef.hpMult) {
      enemy.maxHp = Math.round(enemy.maxHp * affixDef.hpMult)
      enemy.hp = enemy.maxHp
    }
    if (affixDef.speedMult) {
      enemy.def = { ...enemy.def, speed: enemy.def.speed * affixDef.speedMult }
    }
    if (affixDef.atkMult) {
      enemy.def = { ...enemy.def, attack: Math.round(enemy.def.attack * affixDef.atkMult) }
    }
    // 体型增大 30%
    enemy.def = { ...enemy.def, size: Math.round(enemy.def.size * 1.3) }
    // 护盾精英初始化护盾计时器
    if (affixDef.special === 'periodic_shield') {
      enemy.shieldValue = enemy.maxHp * 0.3
      enemy.shieldTimer = 10000
    }
  }

  // ========== 主动道具 ==========
  useActiveItem() {
    const ai = this.state.activeItem
    if (!ai || ai.cooldownRemaining > 0) return
    const hero = this.state.heroes[this.state.activeHeroIndex]
    if (!hero || hero.isDead) return

    ai.cooldownRemaining = ai.def.cooldown
    sfx.sfxActiveItem()
    const { effectType, value } = ai.def

    switch (effectType) {
      case 'aoe_damage':
        // 全屏伤害
        for (const e of this.state.floor.enemies) {
          if (!e.isDead) this.damageEnemy(e, value, false, hero)
        }
        this.state.screenShake = 500
        this.spawnParticles(hero.x, hero.y, '#ff5722', 20)
        break
      case 'heal_team':
        for (const h of this.state.heroes) {
          if (!h.isDead) {
            h.hp = Math.min(h.maxHp, h.hp + h.maxHp * value)
            this.spawnDamageNumber(h.x, h.y, '+HP', '#4caf50', false)
          }
        }
        break
      case 'teleport':
        hero.x = WALL + 30 + Math.random() * (ROOM_W - WALL * 2 - 60)
        hero.y = WALL + 30 + Math.random() * (ROOM_H - WALL * 2 - 60)
        this.spawnParticles(hero.x, hero.y, '#2196f3', 15)
        break
      case 'freeze_all':
        for (const e of this.state.floor.enemies) {
          if (!e.isDead) e.stunTimer = Math.max(e.stunTimer, value)
        }
        this.spawnParticles(ROOM_W / 2, ROOM_H / 2, '#00bcd4', 30)
        break
      case 'rage_buff':
        ai.buffTimer = ai.def.duration || 5000
        break
      case 'shield_team':
        for (const h of this.state.heroes) {
          if (!h.isDead) {
            h.buffs.push({ id: 'shield', name: '护盾', duration: 10000, value, isDebuff: false, color: '#3f51b5' })
          }
        }
        break
    }
  }

  // ========== 事件房间 ==========
  handleEventChoice(choiceIdx: number) {
    const event = this.state.currentEvent
    if (!event) return
    const choice = event.choices[choiceIdx]
    if (!choice) return

    const hero = this.state.heroes[this.state.activeHeroIndex]

    // 消耗检查
    if (choice.costType === 'crystal' && choice.cost) {
      if (this.state.crystals < choice.cost) return
      this.state.crystals -= choice.cost
    } else if (choice.costType === 'hp_percent' && choice.cost) {
      for (const h of this.state.heroes) {
        if (!h.isDead) h.hp = Math.max(1, h.hp - h.maxHp * choice.cost / 100)
      }
    }

    // 奖励处理
    switch (choice.reward) {
      case 'random_item': {
        const item = this.randomItem()
        if (item && hero && !hero.isDead) {
          const slot = hero.items.findIndex(it => it === null)
          if (slot >= 0) {
            hero.items[slot] = { def: item }
            this.state.runStats.itemsCollected.push(item.id)
            this.onEvent({ type: 'item_drop', item })
          }
        }
        break
      }
      case 'heal_50':
        for (const h of this.state.heroes) {
          if (!h.isDead) h.hp = Math.min(h.maxHp, h.hp + h.maxHp * 0.5)
        }
        break
      case 'random_ability': {
        if (hero && !hero.isDead) {
          // B5: 与升级随机池相同的可用能力过滤
          const availableIds = new Set([...DEFAULT_ABILITIES, ...this.meta.unlockedAbilities])
          const availablePool = ABILITIES.filter(a => availableIds.has(a.id))
          const pool = availablePool.filter(a => !hero.abilities.some(ha => ha.def.id === a.id && ha.stacks >= a.maxStacks))
          if (pool.length > 0) {
            const ab = pool[Math.floor(Math.random() * pool.length)]
            const existing = hero.abilities.find(ha => ha.def.id === ab.id)
            if (existing) {
              existing.stacks++
            } else if (hero.abilities.length < 6) {
              hero.abilities.push({ def: ab, stacks: 1 })
            }
            this.checkSynergies(hero)
          }
        }
        break
      }
      case 'upgrade_item': {
        if (hero && !hero.isDead) {
          const itemSlot = hero.items.findIndex(it => it !== null)
          if (itemSlot >= 0) {
            const oldItem = hero.items[itemSlot]!
            const better = ITEMS.filter(it => {
              const rarityOrder = ['common', 'uncommon', 'rare', 'epic']
              return rarityOrder.indexOf(it.rarity) > rarityOrder.indexOf(oldItem.def.rarity)
            })
            if (better.length > 0) {
              const newItem = better[Math.floor(Math.random() * better.length)]
              hero.items[itemSlot] = { def: newItem }
              this.state.runStats.itemsCollected.push(newItem.id)
              this.onEvent({ type: 'item_drop', item: newItem })
            }
          }
        }
        break
      }
      case 'rare_item_plus_enemies': {
        // 稀有道具（敌人由 setupWave 之后生成）
        const rares = ITEMS.filter(it => it.rarity === 'rare' || it.rarity === 'epic')
        if (rares.length > 0 && hero && !hero.isDead) {
          const item = rares[Math.floor(Math.random() * rares.length)]
          const slot = hero.items.findIndex(it => it === null)
          if (slot >= 0) {
            hero.items[slot] = { def: item }
            this.state.runStats.itemsCollected.push(item.id)
            this.onEvent({ type: 'item_drop', item })
          }
        }
        break
      }
      case 'safe_loot':
        this.state.crystals += 5
        for (const h of this.state.heroes) {
          if (!h.isDead) h.hp = Math.min(h.maxHp, h.hp + h.maxHp * 0.15)
        }
        break
      case 'none':
      default:
        break
    }

    // 结束事件，继续游戏
    this.state.isEventPending = false
    this.state.currentEvent = null
    this.setupWave(this.state.floorLevel)

    // B4: 稀有道具敌人放在 setupWave 之后生成，避免被覆盖
    if (choice.reward === 'rare_item_plus_enemies') {
      const pool = FLOOR_ENEMY_POOLS[this.state.floorLevel] || FLOOR_ENEMY_POOLS[1]
      for (let i = 0; i < 3; i++) this.spawnEnemy(pool, this.state.floorLevel + 2)
    }
  }

  // ========== 游戏循环 ==========
  start() {
    this.running = true
    this.lastTime = performance.now()
    this.loop()
  }

  stop() {
    this.running = false
    if (this.animFrame) cancelAnimationFrame(this.animFrame)
  }

  private loop = () => {
    if (!this.running) return
    const now = performance.now()
    const dt = Math.min(now - this.lastTime, 50) // cap at 50ms
    this.lastTime = now

    if (!this.state.isPaused && !this.state.isLevelUpPending && !this.state.isEventPending) {
      this.update(dt)
    }

    this.animFrame = requestAnimationFrame(this.loop)
  }

  // ========== 核心更新 ==========
  private update(dt: number) {
    // 顿帧：暂停所有游戏逻辑，只渲染
    if (this.state.hitstop > 0) {
      this.state.hitstop -= dt
      // 顿帧期间仍更新视觉特效
      this.updateParticles(dt)
      this.updateDamageNumbers(dt)
      this.updateAttackArcs(dt)
      this.input.justPressed.clear()
      this.input.justClicked = null
      return
    }

    this.state.gameTime += dt
    this.updateHeroes(dt)
    this.updateEnemies(dt)
    this.updateProjectiles(dt)
    this.updateLoot(dt)
    this.updateParticles(dt)
    this.updateDamageNumbers(dt)
    this.updateAttackArcs(dt)
    this.updateWaveSpawning(dt)
    this.checkPortal()

    if (this.state.screenShake > 0) this.state.screenShake -= dt
    if (this.state.synergyPopup) {
      this.state.synergyPopup.timer -= dt
      if (this.state.synergyPopup.timer <= 0) this.state.synergyPopup = null
    }

    this.input.justPressed.clear()
    this.input.justClicked = null
  }

  private updateAttackArcs(dt: number) {
    for (const arc of this.state.attackArcs) {
      arc.timer -= dt
    }
    this.state.attackArcs = this.state.attackArcs.filter(a => a.timer > 0)
  }

  private updateHeroes(dt: number) {
    const { heroes } = this.state

    // === 死亡自动切换：活跃英雄死亡时自动切换到下一个存活英雄 ===
    const currentActive = heroes[this.state.activeHeroIndex]
    if (currentActive && currentActive.isDead) {
      const nextAlive = heroes.findIndex((h, i) => i !== this.state.activeHeroIndex && !h.isDead)
      if (nextAlive >= 0) {
        this.state.activeHeroIndex = nextAlive
        this.spawnParticles(heroes[nextAlive].x, heroes[nextAlive].y, heroes[nextAlive].def.color, 10)
      }
    }

    const active = heroes[this.state.activeHeroIndex]

    for (let i = 0; i < heroes.length; i++) {
      const hero = heroes[i]
      if (hero.isDead) continue

      // Buff更新
      hero.buffs = hero.buffs.filter(b => { b.duration -= dt; return b.duration > 0 })

      // 道具属性加成（动态更新最大生命）
      hero.maxHp = this.getHeroMaxHp(hero)
      hero.hp = Math.min(hero.hp, hero.maxHp)

      // 回复能力
      const regenStacks = this.getAbilityStacks(hero, 'regen')
      if (regenStacks > 0) {
        let healAmount = hero.maxHp * 0.01 * regenStacks * dt / 1000
        // === 队伍协同：守护之光 - 战士受治疗效果+50% ===
        if (hero.def.id === 'warrior' && this.state.activeTeamSynergies.some(s => s.effectType === 'heal_boost')) {
          healAmount *= 1.5
        }
        hero.hp = Math.min(hero.maxHp, hero.hp + healAmount)
      }

      // 治疗光环
      const healAuraStacks = this.getAbilityStacks(hero, 'heal_aura')
      if (healAuraStacks > 0) {
        for (const other of heroes) {
          if (!other.isDead && other !== hero && this.dist(hero, other) < 100) {
            other.hp = Math.min(other.maxHp, other.hp + other.maxHp * 0.005 * healAuraStacks * dt / 1000)
          }
        }
      }

      // 护盾爆发
      const shieldStacks = this.getAbilityStacks(hero, 'shield_burst')
      if (shieldStacks > 0) {
        const hasShield = hero.buffs.some(b => b.id === 'shield')
        if (!hasShield && this.state.gameTime % 10000 < dt) {
          hero.buffs.push({ id: 'shield', name: '护盾', duration: 8000, value: 30 * shieldStacks, isDebuff: false, color: '#3498db' })
        }
      }

      // 治愈石
      if (hero.items.some(it => it?.def.effect.special === 'periodic_heal')) {
        if (Math.floor(this.state.gameTime / 5000) !== Math.floor((this.state.gameTime - dt) / 5000)) {
          hero.hp = Math.min(hero.maxHp, hero.hp + hero.maxHp * 0.05)
        }
      }

      // 反伤磁场：每秒伤害附近敌人
      const auraStacks = this.getAbilityStacks(hero, 'damage_aura')
      if (auraStacks > 0) {
        const auraMult = this.hasActiveSynergy('aura_storm') ? 2 : 1
        const auraRange = 80 * auraMult
        const auraDmg = hero.def.attack * 0.15 * auraStacks * auraMult * dt / 1000
        for (const enemy of this.state.floor.enemies) {
          if (!enemy.isDead && this.dist(hero, enemy) < auraRange) {
            enemy.hp -= auraDmg
            if (Math.random() < 0.02) this.spawnParticles(enemy.x, enemy.y, '#3498db', 1)
            if (enemy.hp <= 0) this.killEnemy(enemy)
          }
        }
      }

      // 非活跃英雄跟随活跃英雄
      if (i !== this.state.activeHeroIndex && active && !active.isDead) {
        const followDist = 60 + i * 30
        const angle = Math.atan2(active.y - hero.y, active.x - hero.x)
        const d = this.dist(hero, active)
        if (d > followDist) {
          const speed = hero.def.speed * 1.2
          hero.x += Math.cos(angle) * speed * dt * 0.06
          hero.y += Math.sin(angle) * speed * dt * 0.06
        }
      }

      hero.attackCooldown = Math.max(0, hero.attackCooldown - dt)
      hero.skillCooldown = Math.max(0, hero.skillCooldown - dt)

      // === 非活跃英雄自动攻击 ===
      if (i !== this.state.activeHeroIndex && hero.attackCooldown <= 0) {
        const target = this.findNearestEnemy(hero)
        if (target && this.dist(hero, target) < hero.def.range + target.def.size + 20) {
          this.heroAttack(hero, target, 0.5)
          hero.attackCooldown = hero.def.attackSpeed * 3
        }
      }
    }

    // === 影子分身更新 ===
    if (this.state.clone && !this.state.clone.isDead) {
      const clone = this.state.clone
      clone.timer -= dt
      clone.attackCooldown = Math.max(0, clone.attackCooldown - dt)
      if (clone.timer <= 0) {
        clone.isDead = true
        this.state.clone = null
      } else if (active && !active.isDead) {
        // 分身跟随活跃英雄
        const cd = this.dist(clone, active)
        if (cd > 50) {
          const ca = Math.atan2(active.y - clone.y, active.x - clone.x)
          clone.x += Math.cos(ca) * clone.speed * dt * 0.06
          clone.y += Math.sin(ca) * clone.speed * dt * 0.06
        }
        // 分身自动攻击最近敌人
        if (clone.attackCooldown <= 0) {
          const nearest = this.findNearestEnemy(clone)
          if (nearest && this.dist(clone, nearest) < 150) {
            this.damageEnemy(nearest, clone.attack, false, active)
            clone.attackCooldown = 600
            const angle = Math.atan2(nearest.y - clone.y, nearest.x - clone.x)
            this.state.projectiles.push({
              id: uid(), x: clone.x, y: clone.y,
              vx: Math.cos(angle) * 7, vy: Math.sin(angle) * 7,
              damage: clone.attack, radius: 4, isEnemy: false,
              pierce: 0, bounceCount: 0, maxBounces: 0, color: '#9b59b6',
            })
          }
        }
      }
    }

    // === 影子分身召唤检查 ===
    if (!this.state.clone) {
      for (const hero of heroes) {
        if (!hero.isDead && this.getAbilityStacks(hero, 'shadow_clone') > 0 && hero.hp < hero.maxHp * 0.3) {
          this.state.clone = {
            id: uid(), x: hero.x + 30, y: hero.y,
            hp: hero.maxHp * 0.5, maxHp: hero.maxHp * 0.5,
            attack: hero.def.attack * 1.2, speed: hero.def.speed,
            color: '#9b59b6', timer: 10000, attackCooldown: 0, isDead: false,
          }
          this.spawnParticles(hero.x + 30, hero.y, '#9b59b6', 15)
          // 协同：时停分身
          if (this.hasActiveSynergy('clone_stop')) {
            for (const enemy of this.state.floor.enemies) {
              if (!enemy.isDead) enemy.slowTimer = 3000
            }
          }
          break
        }
      }
    }

    // === 切换英雄 (1-3) - 无论当前活跃状态都可以切换 ===
    if (this.input.justPressed.has('1') && heroes[0] && !heroes[0].isDead) this.state.activeHeroIndex = 0
    if (this.input.justPressed.has('2') && heroes[1] && !heroes[1].isDead) this.state.activeHeroIndex = 1
    if (this.input.justPressed.has('3') && heroes[2] && !heroes[2].isDead) this.state.activeHeroIndex = 2

    // === 主动道具 Q 键 ===
    if (this.input.justPressed.has('q')) {
      this.useActiveItem()
    }

    // === 主动道具冷却更新 ===
    if (this.state.activeItem) {
      this.state.activeItem.cooldownRemaining = Math.max(0, this.state.activeItem.cooldownRemaining - dt)
      if (this.state.activeItem.buffTimer > 0) {
        this.state.activeItem.buffTimer = Math.max(0, this.state.activeItem.buffTimer - dt)
      }
    }

    // === 队伍协同：生存专家 - 每 10 秒全队回复 5% HP ===
    if (this.state.activeTeamSynergies.some(s => s.effectType === 'team_regen')) {
      if (Math.floor(this.state.gameTime / 10000) !== Math.floor((this.state.gameTime - dt) / 10000)) {
        for (const h of heroes) {
          if (!h.isDead) h.hp = Math.min(h.maxHp, h.hp + h.maxHp * 0.05)
        }
      }
    }

    // 活跃英雄操作（移动/攻击/技能）
    if (active && !active.isDead) {
      // WASD 移动
      let dx = 0, dy = 0
      if (this.input.keys.has('w') || this.input.keys.has('arrowup')) dy -= 1
      if (this.input.keys.has('s') || this.input.keys.has('arrowdown')) dy += 1
      if (this.input.keys.has('a') || this.input.keys.has('arrowleft')) dx -= 1
      if (this.input.keys.has('d') || this.input.keys.has('arrowright')) dx += 1

      // 近战英雄自动追击：无手动输入时，自动向最近敌人移动
      const isMelee = active.def.range <= 60
      if (dx === 0 && dy === 0 && isMelee) {
        const nearest = this.findNearestEnemy(active)
        if (nearest) {
          const d = this.dist(active, nearest)
          const chaseRange = active.def.range + nearest.def.size + 20
          if (d > chaseRange) {
            const angle = Math.atan2(nearest.y - active.y, nearest.x - active.x)
            dx = Math.cos(angle)
            dy = Math.sin(angle)
          }
        }
      }

      if (dx !== 0 || dy !== 0) {
        const len = Math.sqrt(dx * dx + dy * dy)
        dx /= len; dy /= len
        const speed = this.getHeroSpeed(active)
        active.x += dx * speed * dt * 0.06
        active.y += dy * speed * dt * 0.06
        active.x = Math.max(WALL + active.def.size, Math.min(ROOM_W - WALL - active.def.size, active.x))
        active.y = Math.max(WALL + active.def.size, Math.min(ROOM_H - WALL - active.def.size, active.y))
      }

      // === 鼠标左键普攻：向鼠标方向攻击 + 自动攻击最近敌人 ===
      if (active.attackCooldown <= 0) {
        let target: EnemyState | null = null

        if (this.input.mouseDown || this.input.justClicked === 'left') {
          // 左键点击：朝鼠标方向找最近的敌人
          const worldMX = this.input.mouseX - this.camera.x + WALL
          const worldMY = this.input.mouseY - this.camera.y + WALL
          const mouseAngle = Math.atan2(worldMY - active.y, worldMX - active.x)
          const range = Math.max(active.def.range * 3, 200)

          let bestScore = Infinity
          for (const enemy of this.state.floor.enemies) {
            if (enemy.isDead) continue
            const d = this.dist(active, enemy)
            if (d > range) continue
            // 计算敌人与鼠标方向的夹角
            const enemyAngle = Math.atan2(enemy.y - active.y, enemy.x - active.x)
            const angleDiff = Math.abs(this.normalizeAngle(enemyAngle - mouseAngle))
            if (angleDiff < Math.PI / 3) { // 60° 扇形范围
              const score = d + angleDiff * 100
              if (score < bestScore) {
                bestScore = score
                target = enemy
              }
            }
          }
        }

        // 没找到鼠标方向敌人时，自动攻击最近敌人
        if (!target) {
          target = this.findNearestEnemy(active)
        }

        if (target) {
          this.heroAttack(active, target)
          let cdTime = active.def.attackSpeed / (1 + this.getAttackSpeedBonus(active))
          // 连鸳：攻速极快
          if (active.items.some(it => it?.def.id === 'repeating_crossbow')) cdTime *= 0.5
          active.attackCooldown = cdTime
        }
      }

      // === 技能释放：右键 / 空格 ===
      const skillTriggered = this.input.justClicked === 'right' || this.input.justPressed.has(' ')
      if (skillTriggered && active.skillCooldown <= 0) {
        this.useHeroSkill(active)
        let skillCd = 8000
        // 沙漏：技能冷却减少30%
        if (active.items.some(it => it?.def.effect.special === 'cd_reduce')) skillCd *= 0.7
        active.skillCooldown = skillCd
      }

      // 拾取掉落物
      for (const hero of heroes) {
        if (hero.isDead) continue
        this.checkLootPickup(hero)
      }
    }
  }

  private getHeroSpeed(hero: HeroState): number {
    let speed = hero.def.speed
    // 训练营速度强化
    speed *= 1 + this.meta.speedLevel * 0.03
    const speedStacks = this.getAbilityStacks(hero, 'speed_boost')
    speed *= 1 + speedStacks * 0.2
    for (const item of hero.items) {
      if (item?.def.effect.speedBonus) speed += item.def.effect.speedBonus
    }
    return speed
  }

  private getAttackSpeedBonus(hero: HeroState): number {
    let bonus = 0
    if (hero.items.some(it => it?.def.effect.special === 'berserker')) bonus += 1
    // === 队伍协同：致命连击 - 攻速+25% ===
    if (this.state.activeTeamSynergies.some(s => s.effectType === 'attack_speed')) bonus += 0.25
    return bonus
  }

  private getHeroAttack(hero: HeroState): number {
    let atk = hero.def.attack
    // 能力加成
    const doubleEdge = this.getAbilityStacks(hero, 'double_edge')
    if (doubleEdge > 0) atk *= 1.5
    const berserk = this.getAbilityStacks(hero, 'berserk')
    if (berserk > 0 && hero.hp < hero.maxHp * 0.3) atk *= 2
    const bloodMagic = this.getAbilityStacks(hero, 'blood_magic')
    if (bloodMagic > 0) atk *= 1.5
    // 道具加成
    for (const item of hero.items) {
      if (item?.def.effect.attackBonus) atk += item.def.effect.attackBonus
    }
    // 协同加成
    if (this.hasActiveSynergy('damage_overload') && hero.hp < hero.maxHp * 0.3) atk *= 3
    // === 队伍协同：元素风暴 - 技能伤害+40% ===
    if (this.state.activeTeamSynergies.some(s => s.effectType === 'skill_boost')) {
      atk *= 1.4
    }
    // === 主动道具：狂暴药剂 ===
    if (this.state.activeItem && this.state.activeItem.buffTimer > 0) {
      atk *= 2
    }
    return atk
  }

  private getCritChance(hero: HeroState): number {
    let crit = 0.05
    const critStacks = this.getAbilityStacks(hero, 'crit_mastery')
    crit += critStacks * 0.15
    for (const item of hero.items) {
      if (item?.def.effect.critChance) crit += item.def.effect.critChance
    }
    return crit
  }

  private heroAttack(hero: HeroState, target: EnemyState, damageMult = 1) {
    const atk = this.getHeroAttack(hero) * damageMult
    const isCrit = Math.random() < this.getCritChance(hero) * damageMult // 非活跃英雄降低暴击率
    const hasGambleDice = hero.items.some(it => it?.def.id === 'gamblers_dice')
    const critMult = hasGambleDice ? 3.0 : 1.8
    let damage = isCrit ? atk * critMult : atk
    const isRanged = hero.def.range > 60

    // === 队伍协同：魔法箭雨 - 远程攻击 10% 概率附加法术伤害 ===
    if (isRanged && this.state.activeTeamSynergies.some(s => s.effectType === 'magic_proc')) {
      if (Math.random() < 0.1) {
        damage += atk * 0.5  // 额外法术伤害
        this.spawnParticles(target.x, target.y, '#3498db', 5)
      }
    }

    // 血刃：攻击消耗生命
    if (hero.items.some(it => it?.def.id === 'blood_blade')) {
      hero.hp -= 3
      if (hero.hp <= 0) { hero.hp = 1 } // 不会自杀
    }

    // 血魔法：消耗生命值代替攻击冷却，伤害已在getHeroAttack中提升
    if (this.getAbilityStacks(hero, 'blood_magic') > 0) {
      hero.hp -= Math.max(hero.maxHp * 0.02, 1) // 每次攻击消耗2%最大HP
      if (hero.hp <= 0) { hero.hp = 1 }
    }

    if (isRanged) {
      // 远程：发射弹道
      const angle = Math.atan2(target.y - hero.y, target.x - hero.x)
      const projSpeed = 6
      const proj: Projectile = {
        id: uid(), x: hero.x, y: hero.y,
        vx: Math.cos(angle) * projSpeed, vy: Math.sin(angle) * projSpeed,
        damage, radius: 5, isEnemy: false,
        pierce: this.hasActiveSynergy('barrage_return') ? 99 : this.getAbilityStacks(hero, 'pierce'),
        bounceCount: 0,
        maxBounces: this.hasActiveSynergy('bullet_hell') ? 99 : (hero.items.some(it => it?.def.id === 'bounce_dagger') ? 3 : 0),
        color: hero.def.color,
        lifesteal: this.getLifesteal(hero),
        splitCount: this.getAbilityStacks(hero, 'split_bullet') > 0 ? 3 : 0,
        burnDamage: this.getAbilityStacks(hero, 'fire_enchant') > 0 ? atk * 0.3 : 0,
        slowAmount: this.getAbilityStacks(hero, 'time_slow') > 0 ? 0.4 : 0,
        returnShot: hero.items.some(it => it?.def.id === 'boomerang') || this.hasActiveSynergy('barrage_return'),
        ownerId: this.state.heroes.indexOf(hero),
      }

      // 多重射击
      const multiStacks = this.getAbilityStacks(hero, 'multi_shot')
      if (multiStacks > 0) {
        for (let i = 1; i <= multiStacks; i++) {
          const spreadAngle = angle + (i * 0.25) * (i % 2 === 0 ? 1 : -1)
          this.state.projectiles.push({
            ...proj, id: uid(),
            vx: Math.cos(spreadAngle) * projSpeed,
            vy: Math.sin(spreadAngle) * projSpeed,
          })
        }
      }

      this.state.projectiles.push(proj)
    } else {
      // 近战：直接伤害 + 攻击弧光 + 冲击粒子
      const attackRange = hero.def.range + target.def.size + 20
      if (this.dist(hero, target) < attackRange) {
        this.damageEnemy(target, damage, isCrit, hero)
        // === 队伍协同：暗影双杀 - 暴击时额外攻击 ===
        if (isCrit && this.state.activeTeamSynergies.some(s => s.effectType === 'double_attack')) {
          if (!target.isDead) {
            this.damageEnemy(target, atk * 0.5, false, hero)
            this.spawnParticles(target.x, target.y, '#9b59b6', 8)
          }
        }
        // 生成攻击弧光特效（更醒目）
        const angle = Math.atan2(target.y - hero.y, target.x - hero.x)
        const arcRadius = hero.def.range + 30
        this.state.attackArcs.push({
          id: uid(), x: hero.x, y: hero.y,
          angle, radius: arcRadius,
          color: hero.def.color, timer: 250, maxTimer: 250,
        })
        // 挥刀拖尾粒子：沿弧线撒出
        const slashCount = isCrit ? 8 : 5
        for (let i = 0; i < slashCount; i++) {
          const spreadAngle = angle + (Math.random() - 0.5) * 1.2 // ±34°
          const dist = arcRadius * (0.5 + Math.random() * 0.5)
          this.state.particles.push({
            id: uid(),
            x: hero.x + Math.cos(spreadAngle) * dist,
            y: hero.y + Math.sin(spreadAngle) * dist,
            vx: Math.cos(spreadAngle) * 2,
            vy: Math.sin(spreadAngle) * 2,
            color: isCrit ? '#ffd700' : '#fff',
            size: isCrit ? 4 : 3,
            life: 200,
            maxLife: 200,
          })
        }
      }
    }
  }

  private useHeroSkill(hero: HeroState) {
    const { id } = hero.def
    if (id === 'warrior') {
      // 嘲讽：吸引附近敌人 + 短暂护盾
      for (const enemy of this.state.floor.enemies) {
        if (!enemy.isDead && this.dist(hero, enemy) < 200) {
          enemy.targetHeroId = this.state.activeHeroIndex
          enemy.stunTimer = 500
        }
      }
      hero.buffs.push({ id: 'taunt_shield', name: '嘲讽护盾', duration: 3000, value: 50, isDebuff: false, color: '#e74c3c' })
      this.spawnParticles(hero.x, hero.y, '#e74c3c', 15)
    } else if (id === 'mage') {
      // 陨石术：AOE伤害
      const mx = this.input.mouseX - this.camera.x + WALL
      const my = this.input.mouseY - this.camera.y + WALL
      for (const enemy of this.state.floor.enemies) {
        if (!enemy.isDead && this.dist({ x: mx, y: my }, enemy) < 100) {
          this.damageEnemy(enemy, hero.def.attack * 3, false, hero)
        }
      }
      this.spawnParticles(mx, my, '#3498db', 25)
      this.state.screenShake = 300
    } else if (id === 'ranger') {
      // 闪避射击：后退 + 3支快速箭
      const angle = Math.atan2(hero.y - (this.input.mouseY - this.camera.y + WALL), hero.x - (this.input.mouseX - this.camera.x + WALL))
      hero.x += Math.cos(angle) * 80
      hero.y += Math.sin(angle) * 80
      hero.x = Math.max(WALL + hero.def.size, Math.min(ROOM_W - WALL - hero.def.size, hero.x))
      hero.y = Math.max(WALL + hero.def.size, Math.min(ROOM_H - WALL - hero.def.size, hero.y))
      for (let i = -1; i <= 1; i++) {
        const a = angle + Math.PI + i * 0.3
        this.state.projectiles.push({
          id: uid(), x: hero.x, y: hero.y,
          vx: Math.cos(a) * 8, vy: Math.sin(a) * 8,
          damage: hero.def.attack * 1.5, radius: 5, isEnemy: false,
          pierce: 1, bounceCount: 0, maxBounces: 0, color: '#2ecc71',
        })
      }
    } else if (id === 'priest') {
      // 治愈光环：治疗全队
      for (const h of this.state.heroes) {
        if (!h.isDead) {
          h.hp = Math.min(h.maxHp, h.hp + h.maxHp * 0.3)
          this.spawnParticles(h.x, h.y, '#f1c40f', 10)
        }
      }
    } else if (id === 'assassin') {
      // 暗影步：瞬移到最近敌人背后，下次攻击必暴击
      const nearest = this.findNearestEnemy(hero)
      if (nearest) {
        hero.x = nearest.x + nearest.def.size + 10
        hero.y = nearest.y
        this.damageEnemy(nearest, hero.def.attack * 2.5, true, hero)
        this.spawnParticles(hero.x, hero.y, '#9b59b6', 12)
      }
    }
  }

  private getLifesteal(hero: HeroState): number {
    let ls = 0
    const lsStacks = this.getAbilityStacks(hero, 'lifesteal')
    ls += lsStacks * 0.15
    for (const item of hero.items) {
      if (item?.def.effect.lifesteal) ls += item.def.effect.lifesteal
    }
    if (this.hasActiveSynergy('blood_fortress')) ls += 0.3
    return ls
  }

  private getHeroMaxHp(hero: HeroState): number {
    let hp = hero.def.maxHp * (1 + this.meta.healthLevel * 0.05)
    // 铁皮能力加成
    const ironSkinStacks = this.getAbilityStacks(hero, 'iron_skin')
    hp *= (1 + ironSkinStacks * 0.25)
    for (const item of hero.items) {
      if (item?.def.effect.hpBonus) hp += item.def.effect.hpBonus
    }
    return Math.round(hp)
  }

  private getAbilityStacks(hero: HeroState, abilityId: string): number {
    const ab = hero.abilities.find(a => a.def.id === abilityId)
    return ab ? ab.stacks : 0
  }

  // ========== 敌人更新 ==========
  private updateEnemies(dt: number) {
    const { heroes, floor } = this.state

    for (const enemy of floor.enemies) {
      if (enemy.isDead) continue

      // 状态效果
      enemy.stunTimer = Math.max(0, enemy.stunTimer - dt)
      enemy.slowTimer = Math.max(0, enemy.slowTimer - dt)
      enemy.burnTimer = Math.max(0, enemy.burnTimer - dt)
      enemy.attackCooldown = Math.max(0, enemy.attackCooldown - dt)
      enemy.hitFlash = Math.max(0, enemy.hitFlash - dt)

      // 击退处理
      if (Math.abs(enemy.knockbackVx) > 0.1 || Math.abs(enemy.knockbackVy) > 0.1) {
        enemy.x += enemy.knockbackVx
        enemy.y += enemy.knockbackVy
        enemy.knockbackVx *= 0.7
        enemy.knockbackVy *= 0.7
        enemy.x = Math.max(WALL + enemy.def.size, Math.min(ROOM_W - WALL - enemy.def.size, enemy.x))
        enemy.y = Math.max(WALL + enemy.def.size, Math.min(ROOM_H - WALL - enemy.def.size, enemy.y))
      }

      // 燃烧伤害
      if (enemy.burnTimer > 0 && enemy.burnDps > 0) {
        enemy.hp -= enemy.burnDps * dt / 1000
        if (Math.random() < 0.1) this.spawnParticles(enemy.x, enemy.y, '#e67e22', 1)
        if (enemy.hp <= 0) { this.killEnemy(enemy); continue }
      }

      // === 精英敌人特殊行为 ===
      if (enemy.isElite) {
        // 护盾精英：每 10 秒生成护盾
        if (enemy.eliteAffix === 'shielded') {
          enemy.shieldTimer -= dt
          if (enemy.shieldTimer <= 0) {
            enemy.shieldValue = enemy.maxHp * 0.3
            enemy.shieldTimer = 10000
            this.spawnParticles(enemy.x, enemy.y, '#ffd600', 8)
          }
        }
      }

      // 协同：时停
      if (this.state.activeSynergies.some(s => s.def.id === 'time_stop' && s.triggerCooldown > 0)) {
        continue
      }

      if (enemy.stunTimer > 0) continue

      const speedMult = enemy.slowTimer > 0 ? 0.5 : 1

      // 寻找目标英雄：始终优先攻击活跃英雄
      const activeHero = heroes[this.state.activeHeroIndex]
      const target = (activeHero && !activeHero.isDead) ? activeHero : heroes.find(h => !h.isDead)
      if (!target) continue

      const dist = this.dist(enemy, target)
      const attackRange = enemy.def.range + target.def.size

      if (dist > attackRange) {
        // 移动向目标
        const angle = Math.atan2(target.y - enemy.y, target.x - enemy.x)
        enemy.x += Math.cos(angle) * enemy.def.speed * speedMult * dt * 0.06
        enemy.y += Math.sin(angle) * enemy.def.speed * speedMult * dt * 0.06
        enemy.x = Math.max(WALL + enemy.def.size, Math.min(ROOM_W - WALL - enemy.def.size, enemy.x))
        enemy.y = Math.max(WALL + enemy.def.size, Math.min(ROOM_H - WALL - enemy.def.size, enemy.y))
      } else if (enemy.attackCooldown <= 0) {
        // === 精英狂怒：HP低于50%时攻击×2 ===
        let atkDmg = enemy.def.attack
        if (enemy.isElite && enemy.eliteAffix === 'enraged' && enemy.hp < enemy.maxHp * 0.5) {
          atkDmg *= 2
        }
        // 攻击
        if (enemy.def.range > 60) {
          // 远程敌人
          const angle = Math.atan2(target.y - enemy.y, target.x - enemy.x)
          this.state.projectiles.push({
            id: uid(), x: enemy.x, y: enemy.y,
            vx: Math.cos(angle) * 4, vy: Math.sin(angle) * 4,
            damage: atkDmg, radius: 4, isEnemy: true,
            pierce: 0, bounceCount: 0, maxBounces: 0, color: enemy.isElite ? enemy.eliteColor : enemy.def.color,
          })
        } else {
          // 近战敌人
          this.damageHero(target, atkDmg, enemy)
        }
        // === 精英吸血：攻击后回复 5% HP ===
        if (enemy.isElite && enemy.eliteAffix === 'vampiric') {
          enemy.hp = Math.min(enemy.maxHp, enemy.hp + enemy.maxHp * 0.05)
        }
        enemy.attackCooldown = enemy.def.attackSpeed
      }
    }

    // 清理死亡敌人
    floor.enemies = floor.enemies.filter(e => !e.isDead || e.hp > -100)
  }

  private damageHero(hero: HeroState, damage: number, _attacker: EnemyState) {
    if (hero.isDead) return
    sfx.sfxHeroHurt()

    // 闪避检查
    const dodgeStacks = this.getAbilityStacks(hero, 'dodge')
    if (dodgeStacks > 0 && Math.random() < dodgeStacks * 0.15) {
      this.spawnDamageNumber(hero.x, hero.y, 'MISS', '#1abc9c', false)
      return
    }

    // 双刃剑debuff
    const doubleEdge = this.getAbilityStacks(hero, 'double_edge')
    if (doubleEdge > 0) damage *= 1.3

    // 狂战士戒指：防御减半 → 受伤+50%
    if (hero.items.some(it => it?.def.id === 'berserker_ring')) damage *= 1.5

    // === 队伍协同：铁壁防线 - 全队受伤-15% ===
    if (this.state.activeTeamSynergies.some(s => s.effectType === 'damage_reduce')) {
      damage *= 0.85
    }

    // 护盾吸收
    const shield = hero.buffs.find(b => b.id === 'shield' || b.id === 'taunt_shield')
    if (shield) {
      shield.value -= damage
      if (shield.value <= 0) {
        damage = -shield.value
        hero.buffs = hero.buffs.filter(b => b !== shield)
      } else {
        damage = 0
      }
    }

    // 灵魂锁链：伤害分摊给队友
    if (hero.items.some(it => it?.def.id === 'soul_chain')) {
      const teammates = this.state.heroes.filter(h => !h.isDead && h !== hero)
      if (teammates.length > 0) {
        const sharedDmg = damage * 0.3
        const perHero = sharedDmg / teammates.length
        for (const t of teammates) {
          t.hp -= perHero
          this.spawnDamageNumber(t.x, t.y, Math.round(perHero), '#78909c', false)
        }
        damage *= 0.7
      }
    }

    // 诅咒转化：受伤时30%概率转为治疗
    if (this.getAbilityStacks(hero, 'curse_convert') > 0 && Math.random() < 0.3) {
      hero.hp = Math.min(hero.maxHp, hero.hp + damage)
      this.spawnDamageNumber(hero.x, hero.y, '+HP', '#8e44ad', false)
      this.spawnParticles(hero.x, hero.y, '#8e44ad', 5)
      return
    }

    hero.hp -= damage
    this.spawnDamageNumber(hero.x, hero.y - 10, Math.round(damage), '#e74c3c', false)

    // 荆棘反弹（能力+道具）
    const thornsStacks = this.getAbilityStacks(hero, 'thorns')
    const hasThornShield = hero.items.some(it => it?.def.id === 'thorn_shield')
    if ((thornsStacks > 0 || hasThornShield) && _attacker && !_attacker.isDead) {
      const reflectRatio = thornsStacks > 0 ? 0.3 * thornsStacks : 0.2
      const reflectDmg = damage * reflectRatio
      _attacker.hp -= reflectDmg
      if (_attacker.hp <= 0) this.killEnemy(_attacker)
    }

    if (hero.hp <= 0) {
      // 不死鸟检查
      const phoenix = this.getAbilityStacks(hero, 'phoenix')
      if (phoenix > 0 && !this.heroRevived[this.state.heroes.indexOf(hero)]) {
        hero.hp = hero.maxHp * 0.5
        this.heroRevived[this.state.heroes.indexOf(hero)] = true
        this.spawnParticles(hero.x, hero.y, '#e74c3c', 20)
        this.spawnDamageNumber(hero.x, hero.y, '复活!', '#e74c3c', false)
      } else {
        hero.isDead = true
        hero.hp = 0
        sfx.sfxHeroDeath()
        this.spawnParticles(hero.x, hero.y, '#555', 15)
        this.checkGameOver()
      }
    }
  }

  private damageEnemy(enemy: EnemyState, damage: number, isCrit: boolean, source: HeroState) {
    if (enemy.isDead) return

    // === 精英护盾吸收 ===
    if (enemy.shieldValue > 0) {
      if (damage <= enemy.shieldValue) {
        enemy.shieldValue -= damage
        this.spawnDamageNumber(enemy.x, enemy.y, 'SHIELD', '#ffd600', false)
        return
      } else {
        damage -= enemy.shieldValue
        enemy.shieldValue = 0
        this.spawnParticles(enemy.x, enemy.y, '#ffd600', 10)
      }
    }

    // 油瓶+火焰协同（火焰剑/火焰附魔）
    const hasFireSource = source.items.some(it => it?.def.id === 'flame_sword') || this.getAbilityStacks(source, 'fire_enchant') > 0
    if (enemy.oilCovered && hasFireSource) {
      damage *= 2.5
      enemy.oilCovered = false
      this.spawnParticles(enemy.x, enemy.y, '#ff5722', 12)
    }

        // 标记猎人：连续命中伤害递增
        const markedStacks = this.getAbilityStacks(source, 'marked_prey')
        if (markedStacks > 0) {
          enemy.markHits = (enemy.markHits || 0) + 1
          if (enemy.markHits > 2) {
            const markBonus = 1 + (enemy.markHits - 2) * 0.1 * markedStacks
            damage *= markBonus
          }
          // 协同：猎杀风暴 - 标记3次后爆炸
          if (this.hasActiveSynergy('hunting_storm') && enemy.markHits > 0 && enemy.markHits % 3 === 0) {
            for (const e of this.state.floor.enemies) {
              if (!e.isDead && e !== enemy && this.dist(enemy, e) < 60) {
                this.damageEnemy(e, 40, false, source)
              }
            }
            this.spawnParticles(enemy.x, enemy.y, '#ff5722', 10)
          }
        }
    
        // 导电护符：小额电系附伤
    if (source.items.some(it => it?.def.id === 'conductive_charm') && !source.items.some(it => it?.def.id === 'thunder_staff')) {
      damage += 5
    }

    enemy.hp -= damage

    // === 打击感反馈 ===
    // 受击闪白
    enemy.hitFlash = 80
    // 击退
    const kbAngle = Math.atan2(enemy.y - source.y, enemy.x - source.x)
    const kbForce = isCrit ? 8 : 4
    enemy.knockbackVx += Math.cos(kbAngle) * kbForce
    enemy.knockbackVy += Math.sin(kbAngle) * kbForce
    // 顿帧（暴击更长）
    this.state.hitstop = isCrit ? 60 : 30
    // 屏幕震动
    this.state.screenShake = isCrit ? 200 : 80
    // 击中粒子
    const hitColor = isCrit ? '#ffd700' : source.def.color
    this.spawnParticles(enemy.x, enemy.y, hitColor, isCrit ? 8 : 3)
    // 伤害数字（更醒目）
    this.spawnDamageNumber(enemy.x, enemy.y - 15, Math.round(damage), isCrit ? '#ffd700' : '#fff', isCrit)

    // 燃烧效果（能力+火焰剑）
    const hasFlameSword = source.items.some(it => it?.def.id === 'flame_sword')
    const abilityBurn = this.getAbilityStacks(source, 'fire_enchant') > 0 ? source.def.attack * 0.3 : 0
    const burnDmg = abilityBurn || (hasFlameSword ? source.def.attack * 0.25 : 0)
    if (burnDmg > 0) {
      enemy.burnTimer = 3000
      enemy.burnDps = burnDmg
    }

    // 爆裂冲击：命中时小范围爆炸
    const explosiveStacks = this.getAbilityStacks(source, 'explosive_hit')
    if (explosiveStacks > 0) {
      for (const e of this.state.floor.enemies) {
        if (!e.isDead && e !== enemy && this.dist(enemy, e) < 50) {
          this.damageEnemy(e, damage * 0.3 * explosiveStacks, false, source)
        }
      }
      this.spawnParticles(enemy.x, enemy.y, '#e67e22', 6)
    }

    // 火焰剑点燃（油瓶+火焰剑 = 额外爆炸）
    if (hasFlameSword && enemy.oilCovered) {
      enemy.oilCovered = false
      this.spawnParticles(enemy.x, enemy.y, '#ff5722', 10)
      this.damageEnemy(enemy, damage * 0.5, false, source) // 额外50%伤害
    }

    // 冰霜弓：冻结敌人1秒
    if (source.items.some(it => it?.def.id === 'frost_bow')) {
      enemy.stunTimer = Math.max(enemy.stunTimer, 1000)
      this.spawnParticles(enemy.x, enemy.y, '#3498db', 5)
    }

    // 雷霆法杖：25%概率闪电链（导电护符增加目标+攻击）
    if (source.items.some(it => it?.def.id === 'thunder_staff') && Math.random() < 0.25) {
      const hasCharm = source.items.some(it => it?.def.id === 'conductive_charm')
      const chainCount = hasCharm ? 5 : 3
      const chainDmg = (hasCharm ? damage * 0.7 : damage * 0.5)
      this.chainLightning(enemy, chainDmg, chainCount)
    }


    // 油瓶效果
    if (source.items.some(it => it?.def.id === 'oil_flask')) {
      enemy.oilCovered = true
    }

    // 减速效果
    if (this.getAbilityStacks(source, 'time_slow') > 0) {
      enemy.slowTimer = 2000
    }

    // 吸血
    const ls = this.getLifesteal(source)
    if (ls > 0) {
      source.hp = Math.min(source.maxHp, source.hp + damage * ls)
    }

    // 协同：血之壁垒 - 受伤也回血
    if (this.hasActiveSynergy('blood_fortress')) {
      source.hp = Math.min(source.maxHp, source.hp + damage * 0.1)
    }

    if (enemy.hp <= 0) {
      this.killEnemy(enemy)
    }
  }

  private killEnemy(enemy: EnemyState) {
    enemy.isDead = true
    enemy.hp = 0
    this.enemiesKilledThisFloor++
    this.state.runStats.enemiesKilled++
    if (enemy.def.isBoss) sfx.sfxBossKill()
    else sfx.sfxKill()

    // === 精英敌人额外奖励 ===
    if (enemy.isElite) {
      const affixDef = ELITE_AFFIXES.find(a => a.affix === enemy.eliteAffix)
      if (affixDef) {
        this.state.crystals += affixDef.bonusCrystal
        this.spawnDamageNumber(enemy.x, enemy.y - 20, `+${affixDef.bonusCrystal}◆`, '#ffd600', false)
      }
      // 分裂：死亡时分裂为2个小怪
      if (enemy.eliteAffix === 'splitter') {
        const pool = [enemy.def.id]
        for (let i = 0; i < 2; i++) {
          this.spawnEnemy(pool, this.state.floorLevel)
        }
      }
    }

    // === Boss 无伤检查 ===
    if (enemy.def.isBoss) {
      const allFullHp = this.state.heroes.every(h => h.isDead || h.hp >= h.maxHp)
      if (allFullHp) this.state.runStats.bossKilledFullHp = true
    }

    // === 死亡爆炸特效 ===
    const deathParticleCount = enemy.def.isBoss ? 30 : 12
    this.spawnParticles(enemy.x, enemy.y, enemy.def.color, deathParticleCount)
    this.spawnParticles(enemy.x, enemy.y, '#fff', Math.floor(deathParticleCount / 3))
    // 死亡屏幕震动
    this.state.screenShake = enemy.def.isBoss ? 400 : 100
    // 死亡顿帧
    this.state.hitstop = enemy.def.isBoss ? 100 : 40

    // 掉落
    const crystalMult = this.state.heroes.some(h => h.items.some(it => it?.def.id === 'crystal_amulet')) ? 2 : 1
    const goldFinder = Math.max(...this.state.heroes.map(h => this.getAbilityStacks(h, 'gold_finder')), 0)
    const crystalCount = Math.ceil(enemy.def.crystalValue * crystalMult * (1 + goldFinder * 0.3))

    this.state.floor.loot.push({
      id: uid(), x: enemy.x, y: enemy.y,
      type: 'crystal', value: crystalCount, pickupRadius: 40,
    })

    // 经验球
    this.state.floor.loot.push({
      id: uid(), x: enemy.x + 10, y: enemy.y + 10,
      type: 'xp', value: enemy.def.xpValue, pickupRadius: 50,
    })

    // 随机掉落生命
    if (Math.random() < 0.15) {
      this.state.floor.loot.push({
        id: uid(), x: enemy.x - 10, y: enemy.y - 10,
        type: 'health', value: 0.15, pickupRadius: 35,
      })
    }

    // 随机掉落道具 (boss必掉，普通敌人小概率)
    const dropChance = enemy.def.isBoss ? 1 : 0.08
    if (Math.random() < dropChance) {
      const item = this.randomItem()
      if (item) {
        this.state.floor.loot.push({
          id: uid(), x: enemy.x + 15, y: enemy.y,
          type: 'item', itemDef: item, value: 0, pickupRadius: 45,
        })
      }
    }

    // === Boss 必掉主动道具 ===
    if (enemy.def.isBoss && !this.state.activeItem) {
      const activeDef = randomActiveItem()
      this.state.activeItem = { def: activeDef, cooldownRemaining: 0, buffTimer: 0 }
      this.spawnDamageNumber(enemy.x, enemy.y - 30, `Q: ${activeDef.name}`, activeDef.color, false)
    }

    // 灵魂收割
    for (const hero of this.state.heroes) {
      if (!hero.isDead && this.getAbilityStacks(hero, 'soul_harvest') > 0) {
        hero.hp = Math.min(hero.maxHp, hero.hp + hero.maxHp * 0.1)
      }
    }

    // 连锁爆炸：敌人死亡时爆炸伤害周围
    for (const hero of this.state.heroes) {
      const chainExplosionStacks = this.getAbilityStacks(hero, 'chain_explosion')
      if (!hero.isDead && chainExplosionStacks > 0) {
        const explodeDmg = enemy.def.maxHp * 0.3 * chainExplosionStacks
        for (const e of this.state.floor.enemies) {
          if (!e.isDead && e !== enemy && this.dist(enemy, e) < 80) {
            this.damageEnemy(e, explodeDmg, false, hero)
          }
        }
        this.spawnParticles(enemy.x, enemy.y, '#ff5722', 15)
        this.state.screenShake = Math.max(this.state.screenShake, 150)
        break
      }
    }

    // 击杀刷新：击杀敌人重置技能冷却
    for (const hero of this.state.heroes) {
      if (!hero.isDead && this.getAbilityStacks(hero, 'kill_refresh') > 0) {
        hero.skillCooldown = 0
        this.spawnDamageNumber(hero.x, hero.y, 'CD刷新', '#2ecc71', false)
        break
      }
    }

    // 协同：死亡收割 - 击杀回血20%
    if (this.hasActiveSynergy('death_harvest')) {
      for (const hero of this.state.heroes) {
        if (!hero.isDead) {
          hero.hp = Math.min(hero.maxHp, hero.hp + hero.maxHp * 0.2)
        }
      }
    }

    this.spawnParticles(enemy.x, enemy.y, enemy.def.color, 8)
  }

  private randomItem(): ItemDef | null {
    const pool = ITEMS.filter(it => it.rarity === 'common' || (it.rarity === 'uncommon' && Math.random() < 0.5) || (it.rarity === 'rare' && Math.random() < 0.2) || (it.rarity === 'epic' && Math.random() < 0.05))
    return pool.length > 0 ? pool[Math.floor(Math.random() * pool.length)] : null
  }

  // ========== 弹道更新 ==========
  private updateProjectiles(dt: number) {
    const toRemove: number[] = []

    for (const proj of this.state.projectiles) {
      proj.x += proj.vx * dt * 0.06
      proj.y += proj.vy * dt * 0.06

      // 回旋镖：飞出一定距离后返回
      if (!proj.isEnemy && proj.returnShot && !proj.returning) {
        const ownerIdx = proj.ownerId ?? 0
        const owner = this.state.heroes[ownerIdx]
        if (owner) {
          const distFromOwner = this.dist(proj, owner)
          if (distFromOwner > 180) {
            proj.returning = true
          }
        }
      }
      if (!proj.isEnemy && proj.returning && (proj.ownerId ?? 0) >= 0) {
        const owner = this.state.heroes[proj.ownerId ?? 0]
        if (owner && !owner.isDead) {
          const returnAngle = Math.atan2(owner.y - proj.y, owner.x - proj.x)
          proj.vx = Math.cos(returnAngle) * 7
          proj.vy = Math.sin(returnAngle) * 7
          // 回到英雄身边时移除
          if (this.dist(proj, owner) < 20) {
            toRemove.push(proj.id)
            continue
          }
        }
      }

      // 墙壁碰撞
      if (proj.x < WALL || proj.x > ROOM_W - WALL || proj.y < WALL || proj.y > ROOM_H - WALL) {
        if (proj.maxBounces > 0 && proj.bounceCount < proj.maxBounces) {
          if (proj.x < WALL || proj.x > ROOM_W - WALL) proj.vx *= -1
          if (proj.y < WALL || proj.y > ROOM_H - WALL) proj.vy *= -1
          proj.bounceCount++
        } else {
          toRemove.push(proj.id)
          continue
        }
      }

      if (!proj.isEnemy) {
        // 英雄弹道 vs 敌人
        for (const enemy of this.state.floor.enemies) {
          if (enemy.isDead) continue
          if (this.dist(proj, enemy) < proj.radius + enemy.def.size) {
            this.damageEnemy(enemy, proj.damage, Math.random() < 0.1, this.state.heroes[this.state.activeHeroIndex])

            // 分裂弹
            if (proj.splitCount && proj.splitCount > 0 && proj.splitCount < 10) {
              for (let i = 0; i < 3; i++) {
                const angle = Math.random() * Math.PI * 2
                this.state.projectiles.push({
                  id: uid(), x: proj.x, y: proj.y,
                  vx: Math.cos(angle) * 5, vy: Math.sin(angle) * 5,
                  damage: proj.damage * 0.5, radius: 4, isEnemy: false,
                  pierce: 0, bounceCount: 0, maxBounces: 0, color: '#c0392b',
                  splitCount: 0,
                })
              }
            }

            // 协同：核爆
            if (this.hasActiveSynergy('nuclear_blast') && proj.splitCount) {
              for (const enemy2 of this.state.floor.enemies) {
                if (!enemy2.isDead && this.dist(proj, enemy2) < 100) {
                  this.damageEnemy(enemy2, 80, false, this.state.heroes[this.state.activeHeroIndex])
                }
              }
              this.spawnParticles(proj.x, proj.y, '#f44336', 20)
              this.state.screenShake = 200
            }

            // 连锁闪电
            const chainStacks = Math.max(...this.state.heroes.map(h => this.getAbilityStacks(h, 'chain_lightning')), 0)
            if (chainStacks > 0 && Math.random() < 0.3) {
              const maxChain = this.hasActiveSynergy('thunder_god') ? 99 : chainStacks + 1
              this.chainLightning(enemy, proj.damage * 0.6, maxChain)
            }

            // 爆炸宝石：弹道命中时产生AOE爆炸
            const activeHero2 = this.state.heroes[this.state.activeHeroIndex]
            if (activeHero2 && !activeHero2.isDead && activeHero2.items.some(it => it?.def.id === 'explosive_gem')) {
              for (const enemy2 of this.state.floor.enemies) {
                if (!enemy2.isDead && this.dist(proj, enemy2) < 60) {
                  this.damageEnemy(enemy2, proj.damage * 0.5, false, activeHero2)
                }
              }
              this.spawnParticles(proj.x, proj.y, '#ff5722', 8)
              this.state.screenShake = Math.max(this.state.screenShake, 60)
            }

            // 弹射匕首：弹射到附近其他敌人
            if (proj.maxBounces > 0 && proj.bounceCount < proj.maxBounces) {
              const otherEnemies = this.state.floor.enemies.filter(
                e => !e.isDead && e !== enemy && this.dist(proj, e) < 120
              )
              if (otherEnemies.length > 0) {
                const nextTarget = otherEnemies.reduce((a, b) =>
                  this.dist(proj, a) < this.dist(proj, b) ? a : b
                )
                const angle = Math.atan2(nextTarget.y - proj.y, nextTarget.x - proj.x)
                this.state.projectiles.push({
                  id: uid(), x: proj.x, y: proj.y,
                  vx: Math.cos(angle) * 5, vy: Math.sin(angle) * 5,
                  damage: proj.damage * 0.7, radius: 4, isEnemy: false,
                  pierce: 0, bounceCount: proj.bounceCount + 1, maxBounces: proj.maxBounces,
                  color: '#95a5a6',
                })
              }
            }

            if (proj.pierce > 0) {
              proj.pierce--
            } else {
              toRemove.push(proj.id)
            }
            break
          }
        }
      } else {
        // 敌人弹道 vs 英雄（仅活跃英雄受伤）
        for (const hero of this.state.heroes) {
          const heroIdx = this.state.heroes.indexOf(hero)
          if (hero.isDead || heroIdx !== this.state.activeHeroIndex) continue
          if (this.dist(proj, hero) < proj.radius + hero.def.size) {
            const attacker = this.state.floor.enemies[0] ?? { isDead: true } as any
            this.damageHero(hero, proj.damage, attacker)
            toRemove.push(proj.id)
            break
          }
        }
      }
    }

    this.state.projectiles = this.state.projectiles.filter(p => !toRemove.includes(p.id))
  }

  private chainLightning(from: EnemyState, damage: number, remaining: number) {
    if (remaining <= 0) return
    const nearby = this.state.floor.enemies.filter(e => !e.isDead && e !== from && this.dist(from, e) < 120)
    if (nearby.length === 0) return
    const target = nearby[0]
    this.damageEnemy(target, damage, false, this.state.heroes[this.state.activeHeroIndex])
    this.spawnParticles(target.x, target.y, '#f39c12', 3)
    this.chainLightning(target, damage * 0.8, remaining - 1)
  }

  // ========== 掉落物 ==========
  private updateLoot(dt: number) {
    // 掉落物不做特殊更新，由拾取检查处理
  }

  private checkLootPickup(hero: HeroState) {
    let magnetRange = 40 + this.getAbilityStacks(hero, 'xp_magnet') * 25
    // 磁石：超强磁铁
    if (hero.items.some(it => it?.def.effect.special === 'super_magnet')) magnetRange += 100
    const toRemove: number[] = []

    for (const loot of this.state.floor.loot) {
      const d = this.dist(hero, loot)

      // 磁铁效果：远处慢慢吸过来
      if (d < magnetRange && d > loot.pickupRadius) {
        const angle = Math.atan2(hero.y - loot.y, hero.x - loot.x)
        const pullSpeed = hero.items.some(it => it?.def.effect.special === 'super_magnet') ? 5 : 3
        loot.x += Math.cos(angle) * pullSpeed
        loot.y += Math.sin(angle) * pullSpeed
      }

      if (d < loot.pickupRadius + hero.def.size) {
        if (loot.type === 'crystal') {
          this.state.crystals += loot.value
          if (loot.value > 0) sfx.sfxCrystal()
        } else if (loot.type === 'xp') {
          hero.xp += loot.value
          this.checkLevelUp(hero)
        } else if (loot.type === 'health') {
          hero.hp = Math.min(hero.maxHp, hero.hp + hero.maxHp * loot.value)
          this.spawnDamageNumber(hero.x, hero.y, '+HP', '#2ecc71', false)
        } else if (loot.type === 'item' && loot.itemDef) {
          this.equipItem(hero, loot.itemDef)
        }
        toRemove.push(loot.id)
      }
    }

    this.state.floor.loot = this.state.floor.loot.filter(l => !toRemove.includes(l.id))
  }

  private equipItem(hero: HeroState, item: ItemDef) {
    const slotIdx = item.slot === 'weapon' ? 0 : item.slot === 'artifact' ? 1 : 2
    hero.items[slotIdx] = { def: item }
    this.state.runStats.itemsCollected.push(item.id) // B2: 记录拾取的道具
    this.spawnDamageNumber(hero.x, hero.y - 20, item.name, item.color, false)
    this.onEvent({ type: 'item_drop', item })
    this.checkSynergies(hero)
  }

  // ========== 升级系统 ==========
  private checkLevelUp(hero: HeroState) {
    const needed = XP_PER_LEVEL(hero.level)
    if (hero.xp >= needed) {
      hero.xp -= needed
      hero.level++
      hero.maxHp += 5
      hero.hp = Math.min(hero.maxHp, hero.hp + 20)

      // 生成3个随机能力选择
      const choices = this.generateAbilityChoices()
      this.levelUpHeroIndex = this.state.heroes.indexOf(hero)
      this.state.isLevelUpPending = true
      this.state.levelUpChoices = choices
      this.onEvent({ type: 'level_up', choices, heroName: hero.def.name, heroColor: hero.def.color })
    }
  }

  selectAbility(choiceIndex: number) {
    if (!this.state.isLevelUpPending) return
    const choice = this.state.levelUpChoices[choiceIndex]
    if (!choice) return

    const hero = this.state.heroes[this.levelUpHeroIndex] || this.state.heroes[this.state.activeHeroIndex]
    const existing = hero.abilities.find(a => a.def.id === choice.id)
    if (existing) {
      existing.stacks = Math.min(existing.stacks + 1, choice.maxStacks)
    } else if (hero.abilities.length < 6) {
      hero.abilities.push({ def: choice, stacks: 1 })
    }

    this.state.isLevelUpPending = false
    this.state.levelUpChoices = []
    this.checkSynergies(hero)
  }

  private generateAbilityChoices(): AbilityDef[] {
    // 可用能力：默认免费 + 图书馆已解锁
    const availableIds = new Set([...DEFAULT_ABILITIES, ...this.meta.unlockedAbilities])
    const pool = ABILITIES.filter(a => availableIds.has(a.id))
    const choices: AbilityDef[] = []
    // 确保至少有1个变异类(低概率)
    const mutantPool = pool.filter(a => a.category === 'mutant')
    const normalPool = pool.filter(a => a.category !== 'mutant')

    if (Math.random() < 0.15 && mutantPool.length > 0) {
      choices.push(mutantPool[Math.floor(Math.random() * mutantPool.length)])
    }

    while (choices.length < 3 && normalPool.length > 0) {
      const idx = Math.floor(Math.random() * normalPool.length)
      const picked = normalPool.splice(idx, 1)[0]
      if (picked) choices.push(picked)
    }

    return choices.slice(0, 3)
  }

  // ========== 协同系统 ==========
  private checkSynergies(hero: HeroState) {
    const allTags = new Set<string>()
    for (const ab of hero.abilities) {
      for (const tag of ab.def.tags) allTags.add(tag)
    }
    for (const item of hero.items) {
      if (item) for (const tag of item.def.tags) allTags.add(tag)
    }

    // 仅能触发已在神龛解锁的协同
    const unlockedSet = new Set(this.meta.unlockedSynergies)
    for (const syn of SYNERGIES) {
      if (!unlockedSet.has(syn.id)) continue
      if (this.state.activeSynergies.some(s => s.def.id === syn.id)) continue
      const hasAll = syn.tags.every(tag => allTags.has(tag))
      if (hasAll) {
        this.state.activeSynergies.push({ def: syn, triggerCooldown: 0 })
        this.state.runStats.synergiesTriggered.push(syn.id) // B1: 记录触发的协同
        this.state.synergyPopup = { name: syn.name, desc: syn.desc, color: syn.color, timer: 3000 }
        this.onEvent({ type: 'synergy', name: syn.name, desc: syn.desc, color: syn.color })
        this.triggerSynergy(syn)
      }
    }
  }

  private hasActiveSynergy(synergyId: string): boolean {
    return this.state.activeSynergies.some(s => s.def.id === synergyId)
  }

  private triggerSynergy(syn: import('./types').SynergyDef) {
    const eff = syn.effect
    switch (eff.type) {
      case 'aoe_burn':
        // 烈焰风暴：对所有敌人造成火焰伤害
        for (const enemy of this.state.floor.enemies) {
          if (!enemy.isDead) {
            enemy.hp -= eff.value
            enemy.burnTimer = eff.duration || 5000
            enemy.burnDps = eff.value * 0.5
            this.spawnParticles(enemy.x, enemy.y, '#ff5722', 5)
          }
        }
        this.state.screenShake = 500
        break
      case 'time_stop': {
        const active = this.state.activeSynergies.find(s => s.def.id === syn.id)
        if (active) active.triggerCooldown = eff.duration || 3000
        for (const enemy of this.state.floor.enemies) {
          if (!enemy.isDead) enemy.stunTimer = eff.value
        }
        break
      }
      case 'freeze_field':
        for (const enemy of this.state.floor.enemies) {
          if (!enemy.isDead) {
            enemy.stunTimer = eff.value
            this.spawnParticles(enemy.x, enemy.y, '#03a9f4', 3)
          }
        }
        break
      case 'aura_thorns':
        // 磁场风暴：反伤磁场范围和伤害翻倍（被动生效，由updateHeroes处理）
        break
      case 'clone_slow':
        // 时停分身：分身召唤时全屏减速（已在分身召唤时触发）
        break
      case 'kill_regen':
        // 死亡收割：击杀回血20%（已在killEnemy中处理）
        break
      case 'boomerang_barrage':
        // 弹幕回力：所有弹道回旋（已在弹道创建时处理）
        break
      case 'marked_explosion':
        // 猎杀风暴：每3次命中爆炸（已在damageEnemy中处理）
        break
    }
  }

  // ========== 波次生成 ==========
  private updateWaveSpawning(dt: number) {
    this.waveTimer += dt
    const aliveEnemies = this.state.floor.enemies.filter(e => !e.isDead).length

    // 每3秒补充敌人(直到达到本层需求)
    if (this.waveTimer > 3000 && aliveEnemies < 4 && this.enemiesKilledThisFloor < this.enemiesNeededThisFloor) {
      this.waveTimer = 0
      const floorLevel = this.state.floorLevel
      const poolIdx = floorLevel <= 10 ? floorLevel : ((floorLevel - 1) % 5) + 6
      const pool = FLOOR_ENEMY_POOLS[poolIdx] || FLOOR_ENEMY_POOLS[10]
      const toSpawn = Math.min(2, this.enemiesNeededThisFloor - this.enemiesKilledThisFloor - aliveEnemies)
      for (let i = 0; i < toSpawn; i++) {
        this.spawnEnemy(pool, floorLevel)
      }
    }

    // Boss层特殊处理: 确保boss出现
    if (this.state.floorLevel % 3 === 0 && this.enemiesKilledThisFloor >= this.enemiesNeededThisFloor - 1) {
      const bossPool = FLOOR_ENEMY_POOLS[Math.min(this.state.floorLevel, 10)] || FLOOR_ENEMY_POOLS[10]
      const hasBoss = this.state.floor.enemies.some(e => e.def.isBoss && !e.isDead)
      const bossKilled = this.state.floor.enemies.some(e => e.def.isBoss && e.isDead)
      if (!hasBoss && !bossKilled) {
        this.spawnEnemy(bossPool, this.state.floorLevel)
      }
    }
  }

  // ========== 传送门 ==========
  private checkPortal() {
    const aliveEnemies = this.state.floor.enemies.filter(e => !e.isDead).length
    const killed = this.enemiesKilledThisFloor

    if (killed >= this.enemiesNeededThisFloor && aliveEnemies === 0 && !this.portalSpawned) {
      this.portalSpawned = true
      this.portalX = ROOM_W / 2
      this.portalY = ROOM_H / 2
      sfx.sfxPortal()
    }

    if (this.portalSpawned) {
      const hero = this.state.heroes[this.state.activeHeroIndex]
      if (hero && !hero.isDead && this.dist(hero, { x: this.portalX, y: this.portalY }) < 40) {
        this.nextFloor()
      }
    }
  }

  private nextFloor() {
    if (this.state.floorLevel >= 10) {
      // 通关!
      this.endRun(true)
      return
    }

    this.state.floorLevel++
    this.state.runStats.maxFloor = this.state.floorLevel
    this.state.floor = this.generateFloor(this.state.floorLevel)
    this.state.projectiles = []
    this.state.floor.loot = []
    this.portalSpawned = false

    // 每层通关奖励 +2 水晶
    this.state.crystals += 2

    // === 事件房间：每 2 层触发，跳过第 10 层 Boss ===
    if (this.state.floorLevel % 2 === 0 && this.state.floorLevel < 10) {
      this.state.isEventPending = true
      this.state.currentEvent = generateEvent(this.state.floorLevel, this.state.crystals, this.state.heroes.some(h => !h.isDead && h.items.some(it => it !== null)))
      // 回复一些生命
      for (const hero of this.state.heroes) {
        if (!hero.isDead) hero.hp = Math.min(hero.maxHp, hero.hp + hero.maxHp * 0.15)
      }
      this.onEvent({ type: 'event_room', event: this.state.currentEvent })
      this.onEvent({ type: 'floor_clear', floor: this.state.floorLevel - 1 })
      return
    }

    this.setupWave(this.state.floorLevel)

    // 回复一些生命
    for (const hero of this.state.heroes) {
      if (!hero.isDead) hero.hp = Math.min(hero.maxHp, hero.hp + hero.maxHp * 0.15)
    }

    this.onEvent({ type: 'floor_clear', floor: this.state.floorLevel - 1 })
  }

  // ========== 游戏结束 ==========
  private checkGameOver() {
    const allDead = this.state.heroes.every(h => h.isDead)
    if (allDead) {
      this.endRun(false)
    }
  }

  private endRun(victory: boolean) {
    const crystals = this.state.crystals + (victory ? 25 : 0)
    this.state.runStats.victory = victory
    this.stop()
    this.onEvent({ type: 'run_end', crystals, floor: this.state.floorLevel, runStats: this.state.runStats })
  }

  // ========== 工具方法 ==========
  private dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
    return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2)
  }

  private normalizeAngle(angle: number): number {
    while (angle > Math.PI) angle -= 2 * Math.PI
    while (angle < -Math.PI) angle += 2 * Math.PI
    return angle
  }

  private findNearestEnemy(pos: { x: number; y: number }): EnemyState | null {
    let nearest: EnemyState | null = null
    let minDist = Infinity
    for (const enemy of this.state.floor.enemies) {
      if (enemy.isDead) continue
      const d = this.dist(pos, enemy)
      if (d < minDist) { minDist = d; nearest = enemy }
    }
    return nearest
  }

  private spawnDamageNumber(x: number, y: number, value: number | string, color: string, isCrit: boolean) {
    this.state.damageNumbers.push({
      id: uid(), x: x + (Math.random() - 0.5) * 10, y,
      value: typeof value === 'number' ? value : 0,
      color, timer: 1200, vy: isCrit ? -3.5 : -2.5, isCrit,
    })
  }

  private spawnParticles(x: number, y: number, color: string, count: number) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2
      const speed = 1 + Math.random() * 3
      this.state.particles.push({
        id: uid(), x, y,
        vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
        color, size: 2 + Math.random() * 4,
        life: 500 + Math.random() * 500, maxLife: 1000,
      })
    }
  }

  private updateParticles(dt: number) {
    for (const p of this.state.particles) {
      p.x += p.vx; p.y += p.vy
      p.life -= dt
      p.vx *= 0.95; p.vy *= 0.95
    }
    this.state.particles = this.state.particles.filter(p => p.life > 0)
  }

  private updateDamageNumbers(dt: number) {
    for (const d of this.state.damageNumbers) {
      d.y += d.vy
      d.vy *= 0.95
      d.timer -= dt
    }
    this.state.damageNumbers = this.state.damageNumbers.filter(d => d.timer > 0)
  }

  // ========== 公共接口 ==========
  getAliveHeroes() { return this.state.heroes.filter(h => !h.isDead) }
  getActiveHero() { return this.state.heroes[this.state.activeHeroIndex] }
  getFloorInfo() { return { level: this.state.floorLevel, killed: this.enemiesKilledThisFloor, needed: this.enemiesNeededThisFloor, portalReady: this.portalSpawned } }
}
