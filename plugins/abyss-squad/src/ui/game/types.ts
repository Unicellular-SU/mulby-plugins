// ========== 游戏屏幕状态 ==========
export type GameScreen = 'menu' | 'hub' | 'game' | 'gameover' | 'hero_pick'

// ========== 基础向量 ==========
export interface Vec2 {
  x: number
  y: number
}

// ========== 英雄系统 ==========
export type HeroId = 'warrior' | 'mage' | 'ranger' | 'priest' | 'assassin'

export interface HeroDef {
  id: HeroId
  name: string
  color: string
  maxHp: number
  attack: number
  speed: number
  range: number
  attackSpeed: number  // 攻击间隔(ms)
  skill: string
  skillDesc: string
  size: number
}

export interface HeroState {
  def: HeroDef
  x: number
  y: number
  hp: number
  maxHp: number
  xp: number
  level: number
  abilities: AbilityInstance[]
  items: (ItemInstance | null)[]  // 3 slots: weapon, artifact, accessory
  attackCooldown: number
  skillCooldown: number
  isActive: boolean
  isDead: boolean
  buffs: Buff[]
  vx: number
  vy: number
  targetX: number
  targetY: number
}

// ========== 能力系统 ==========
export type AbilityCategory = 'attack' | 'defense' | 'support' | 'mutant'

export interface AbilityDef {
  id: string
  name: string
  category: AbilityCategory
  desc: string
  color: string
  maxStacks: number
  tags: string[]  // 用于协同检测
}

export interface AbilityInstance {
  def: AbilityDef
  stacks: number
}

// ========== 道具系统 ==========
export type ItemSlot = 'weapon' | 'artifact' | 'accessory'
export type ItemRarity = 'common' | 'uncommon' | 'rare' | 'epic'

export interface ItemDef {
  id: string
  name: string
  slot: ItemSlot
  rarity: ItemRarity
  desc: string
  color: string
  tags: string[]
  effect: ItemEffect
}

export interface ItemEffect {
  attackBonus?: number
  hpBonus?: number
  speedBonus?: number
  critChance?: number
  lifesteal?: number
  special?: string  // 特殊效果标识
}

export interface ItemInstance {
  def: ItemDef
}

// ========== Buff/Debuff ==========
export interface Buff {
  id: string
  name: string
  duration: number    // 剩余时间(ms)
  value: number
  isDebuff: boolean
  color?: string
}

// ========== 敌人系统 ==========
export type EnemyType = 'melee' | 'ranged' | 'tank' | 'fast' | 'boss'

export interface EnemyDef {
  id: string
  name: string
  type: EnemyType
  color: string
  maxHp: number
  attack: number
  speed: number
  range: number
  attackSpeed: number
  size: number
  xpValue: number
  crystalValue: number
  isBoss?: boolean
}

export interface EnemyState {
  id: number
  def: EnemyDef
  x: number
  y: number
  hp: number
  maxHp: number
  attackCooldown: number
  buffs: Buff[]
  isDead: boolean
  targetHeroId: number  // 小队中目标索引
  stunTimer: number
  slowTimer: number
  burnTimer: number
  burnDps: number
  oilCovered: boolean
  hitFlash: number      // 受击闪白计时器(ms)
  knockbackVx: number   // 击退X速度
  knockbackVy: number   // 击退Y速度
  markHits: number      // 标记猎人连续命中次数
  // === 精英敌人 ===
  isElite: boolean
  eliteAffix: string    // 词缀标识
  eliteColor: string    // 词缀发光颜色
  shieldValue: number   // 精英护盾值
  shieldTimer: number   // 护盾生成计时器
}

// ========== 弹道 ==========
export interface Projectile {
  id: number
  x: number
  y: number
  vx: number
  vy: number
  damage: number
  radius: number
  isEnemy: boolean
  pierce: number
  bounceCount: number
  maxBounces: number
  color: string
  isAoe?: boolean
  aoeRadius?: number
  lifesteal?: number
  splitCount?: number
  chainCount?: number
  burnDamage?: number
  slowAmount?: number
  returnShot?: boolean   // 回旋镖返回弹道
  returning?: boolean    // 是否正在返回
  ownerId?: number       // 发射者英雄索引
}

// ========== 掉落物 ==========
export interface LootDrop {
  id: number
  x: number
  y: number
  type: 'item' | 'crystal' | 'health' | 'xp'
  itemDef?: ItemDef
  value: number
  pickupRadius: number
}

// ========== 房间/地图 ==========
export type RoomType = 'combat' | 'elite' | 'treasure' | 'shop' | 'event' | 'boss' | 'start'

export interface Room {
  id: number
  type: RoomType
  x: number
  y: number
  width: number
  height: number
  cleared: boolean
  enemies: EnemyState[]
  loot: LootDrop[]
  connections: number[]  // 连接的房间id
  visited: boolean
}

export interface Floor {
  level: number
  rooms: Room[]
  currentRoomId: number
  enemies: EnemyState[]
  loot: LootDrop[]
}

// ========== 协同效果 ==========
export interface SynergyDef {
  id: string
  name: string
  desc: string
  tags: string[]      // 需要的标签组合
  color: string
  effect: SynergyEffect
}

export interface SynergyEffect {
  type: 'aoe_burn' | 'infinite_bounce' | 'thorns_lifesteal' | 'chain_lightning' | 'time_stop' | 'split_explosion' | 'damage_mult' | 'shield_burst' | 'poison_cloud' | 'freeze_field' | 'aura_thorns' | 'clone_slow' | 'kill_regen' | 'boomerang_barrage' | 'marked_explosion'
  value: number
  duration?: number
}

export interface ActiveSynergy {
  def: SynergyDef
  triggerCooldown: number
}

// ========== 影子分身 ==========
export interface CloneState {
  id: number
  x: number
  y: number
  hp: number
  maxHp: number
  attack: number
  speed: number
  color: string
  timer: number        // 剩余时间(ms)
  attackCooldown: number
  isDead: boolean
}

// ========== 事件房间 ==========
export type EventType = 'merchant' | 'altar' | 'treasure_trap'

export interface RoomEvent {
  id: string
  type: EventType
  title: string
  desc: string
  choices: EventChoiceDef[]
}

export interface EventChoiceDef {
  label: string
  cost?: number        // 水晶消耗
  costType?: 'crystal' | 'hp_percent' | 'item'
  reward?: string      // 奖励描述
  disabled?: boolean   // 是否不可选
}

// ========== 精英词缀 ==========
export type EliteAffix = 'swift' | 'vampiric' | 'splitter' | 'shielded' | 'enraged'

export interface EliteAffixDef {
  affix: EliteAffix
  name: string
  color: string
  speedMult?: number
  hpMult?: number
  atkMult?: number
  special?: string
  bonusCrystal: number
  bonusXp: number
}

// ========== 主动道具 ==========
export interface ActiveItemDef {
  id: string
  name: string
  desc: string
  cooldown: number   // 冷却时间(ms)
  color: string
  effectType: 'aoe_damage' | 'heal_team' | 'teleport' | 'freeze_all' | 'rage_buff' | 'shield_team'
  value: number
  duration?: number
}

export interface ActiveItemState {
  def: ActiveItemDef
  cooldownRemaining: number  // 剩余冷却(ms)
  buffTimer: number          // 狂怒等buff剩余时间
}

// ========== 队伍协同 ==========
export interface TeamSynergyDef {
  id: string
  name: string
  requiredHeroes: string[]
  desc: string
  color: string
  effectType: 'heal_boost' | 'magic_proc' | 'double_attack' | 'damage_reduce' | 'skill_boost' | 'team_regen' | 'attack_speed'
  value: number
}

// ========== 局内统计 ==========
export interface RunStats {
  heroesUsed: string[]
  synergiesTriggered: string[]
  maxFloor: number
  enemiesKilled: number
  itemsCollected: string[]
  bossKilledFullHp: boolean
  startTime: number
  victory: boolean
}

// ========== 成就 ==========
export interface AchievementDef {
  id: string
  name: string
  desc: string
  rewardCrystals: number
  category: 'basic' | 'challenge'
}

export interface AchievementProgress {
  unlocked: string[]   // 已解锁的成就 id
}

// ========== 地下城状态 ==========
export interface DungeonState {
  floor: Floor
  heroes: HeroState[]
  projectiles: Projectile[]
  activeSynergies: ActiveSynergy[]
  crystals: number
  floorLevel: number
  isPaused: boolean
  isLevelUpPending: boolean
  levelUpChoices: AbilityDef[]
  activeHeroIndex: number
  gameTime: number
  damageNumbers: DamageNumber[]
  particles: Particle[]
  synergyPopup: { name: string; desc: string; color: string; timer: number } | null
  screenShake: number
  hitstop: number        // 顿帧计时器(ms)
  attackArcs: AttackArc[] // 近战攻击弧光
  clone: CloneState | null // 影子分身
  // === 新系统 ===
  isEventPending: boolean
  currentEvent: RoomEvent | null
  activeItem: ActiveItemState | null
  activeTeamSynergies: TeamSynergyDef[]
  runStats: RunStats
}

export interface DamageNumber {
  id: number
  x: number
  y: number
  value: number
  color: string
  timer: number
  vy: number
  isCrit: boolean
}

export interface Particle {
  id: number
  x: number
  y: number
  vx: number
  vy: number
  color: string
  size: number
  life: number
  maxLife: number
}

export interface AttackArc {
  id: number
  x: number
  y: number
  angle: number    // 朝向角度
  radius: number   // 弧光半径
  color: string
  timer: number    // 剩余时间(ms)
  maxTimer: number // 总时间
}

// ========== 局外进度 ==========
export interface MetaProgress {
  crystals: number
  attackLevel: number
  healthLevel: number
  speedLevel: number
  unlockedHeroes: string[]
  unlockedAbilities: string[]
  unlockedItems: string[]
  unlockedSynergies: string[]
  weaponLevel: number
  totalRuns: number
  bestFloor: number
  achievements: string[]   // 已解锁成就 id
  allHeroesUsed: string[] // 历史使用过的英雄
}

// ========== 输入状态 ==========
export interface InputState {
  keys: Set<string>
  mouseX: number
  mouseY: number
  mouseDown: boolean
  mouseRightDown: boolean
  justPressed: Set<string>
  justClicked: 'left' | 'right' | null
}

// ========== 相机 ==========
export interface Camera {
  x: number
  y: number
  width: number
  height: number
}
