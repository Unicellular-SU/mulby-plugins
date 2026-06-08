import type { AbilityDef } from '../types'

export const ABILITIES: AbilityDef[] = [
  // === 攻击类 (红) ===
  { id: 'multi_shot', name: '多重射击', category: 'attack', desc: '攻击额外发射2颗弹道', color: '#e74c3c', maxStacks: 3, tags: ['projectile', 'multi'] },
  { id: 'fire_enchant', name: '火焰附魔', category: 'attack', desc: '攻击附带燃烧效果', color: '#e67e22', maxStacks: 3, tags: ['fire', 'enchant'] },
  { id: 'split_bullet', name: '分裂弹', category: 'attack', desc: '弹道命中后分裂为3颗', color: '#c0392b', maxStacks: 2, tags: ['projectile', 'split'] },
  { id: 'chain_lightning', name: '连锁闪电', category: 'attack', desc: '攻击有概率连锁到附近敌人', color: '#f39c12', maxStacks: 3, tags: ['lightning', 'chain'] },
  { id: 'crit_mastery', name: '暴击精通', category: 'attack', desc: '暴击率+15%', color: '#e74c3c', maxStacks: 5, tags: ['crit'] },
  { id: 'pierce', name: '穿透', category: 'attack', desc: '弹道可以穿透敌人', color: '#c0392b', maxStacks: 3, tags: ['projectile', 'pierce'] },
  { id: 'explosive_hit', name: '爆裂冲击', category: 'attack', desc: '攻击命中时产生小范围爆炸', color: '#e67e22', maxStacks: 2, tags: ['explosion', 'aoe'] },
  // === 防御类 (蓝) ===
  { id: 'thorns', name: '荆棘护盾', category: 'defense', desc: '受到攻击时反弹30%伤害', color: '#3498db', maxStacks: 3, tags: ['thorns', 'reflect'] },
  { id: 'iron_skin', name: '铁皮', category: 'defense', desc: '最大生命值+25%', color: '#2980b9', maxStacks: 5, tags: ['defense', 'hp'] },
  { id: 'dodge', name: '幻影步', category: 'defense', desc: '15%概率闪避攻击', color: '#1abc9c', maxStacks: 3, tags: ['dodge', 'speed'] },
  { id: 'regen', name: '自然回复', category: 'defense', desc: '每秒恢复1%最大生命值', color: '#3498db', maxStacks: 3, tags: ['heal', 'regen'] },
  { id: 'shield_burst', name: '护盾爆发', category: 'defense', desc: '每10秒获得一个吸收伤害的护盾', color: '#2980b9', maxStacks: 2, tags: ['shield', 'defense'] },
  // === 辅助类 (绿) ===
  { id: 'lifesteal', name: '吸血攻击', category: 'support', desc: '攻击伤害的15%转化为生命', color: '#2ecc71', maxStacks: 3, tags: ['lifesteal', 'heal'] },
  { id: 'speed_boost', name: '疾风步', category: 'support', desc: '移动速度+20%', color: '#27ae60', maxStacks: 5, tags: ['speed', 'movement'] },
  { id: 'time_slow', name: '时间减速', category: 'support', desc: '攻击使敌人减速40%', color: '#16a085', maxStacks: 3, tags: ['slow', 'time'] },
  { id: 'xp_magnet', name: '经验磁铁', category: 'support', desc: '经验获取范围+50%', color: '#2ecc71', maxStacks: 3, tags: ['xp', 'magnet'] },
  { id: 'heal_aura', name: '治疗光环', category: 'support', desc: '周围队友每秒恢复0.5%生命值', color: '#27ae60', maxStacks: 2, tags: ['heal', 'aura'] },
  { id: 'gold_finder', name: '寻宝直觉', category: 'support', desc: '水晶掉落率+30%', color: '#f1c40f', maxStacks: 3, tags: ['crystal', 'loot'] },
  // === 变异类 (紫-稀有) ===
  { id: 'berserk', name: '狂暴', category: 'mutant', desc: '生命低于30%时攻击力翻倍', color: '#9b59b6', maxStacks: 1, tags: ['berserk', 'rage'] },
  { id: 'blood_magic', name: '血魔法', category: 'mutant', desc: '消耗生命值代替攻击，伤害提升50%', color: '#8e44ad', maxStacks: 1, tags: ['blood', 'magic'] },
  { id: 'soul_harvest', name: '灵魂收割', category: 'mutant', desc: '击杀敌人恢复10%最大生命值', color: '#9b59b6', maxStacks: 1, tags: ['kill', 'heal'] },
  { id: 'double_edge', name: '双刃剑', category: 'mutant', desc: '攻击力+50%，但受到伤害+30%', color: '#8e44ad', maxStacks: 1, tags: ['risk', 'reward'] },
  { id: 'phoenix', name: '不死鸟', category: 'mutant', desc: '死亡时以50%生命复活(每局1次)', color: '#e74c3c', maxStacks: 1, tags: ['revive', 'phoenix'] },
  // === 新增能力 ===
  { id: 'chain_explosion', name: '连锁爆炸', category: 'attack', desc: '敌人死亡时爆炸，伤害周围敌人', color: '#ff5722', maxStacks: 3, tags: ['explosion', 'death_explode'] },
  { id: 'marked_prey', name: '标记猎人', category: 'attack', desc: '连续攻击同一目标，伤害递增10%/层', color: '#e74c3c', maxStacks: 3, tags: ['mark', 'stack_damage'] },
  { id: 'damage_aura', name: '反伤磁场', category: 'defense', desc: '靠近的敌人每秒受到伤害', color: '#3498db', maxStacks: 3, tags: ['aura', 'reflect'] },
  { id: 'kill_refresh', name: '击杀刷新', category: 'support', desc: '击杀敌人时重置技能冷却', color: '#2ecc71', maxStacks: 2, tags: ['kill', 'cooldown'] },
  { id: 'shadow_clone', name: '影子分身', category: 'mutant', desc: '低血量时召唤分身战斗10秒', color: '#9b59b6', maxStacks: 1, tags: ['clone', 'summon'] },
  { id: 'curse_convert', name: '诅咒转化', category: 'mutant', desc: '受伤时30%概率把伤害转为治疗', color: '#8e44ad', maxStacks: 1, tags: ['curse', 'convert'] },
]

export const ABILITY_CATEGORY_COLORS: Record<string, string> = {
  attack: '#e74c3c',
  defense: '#3498db',
  support: '#2ecc71',
  mutant: '#9b59b6',
}

export const DEFAULT_ABILITIES: string[] = [
  // 基础免费能力 (12个)
  'multi_shot', 'fire_enchant', 'crit_mastery', 'pierce',
  'thorns', 'iron_skin', 'dodge',
  'lifesteal', 'speed_boost', 'time_slow', 'xp_magnet', 'gold_finder',
]

export const ABILITY_UNLOCK_COST = 30  // 每个新能力解锁费用
