import type { EnemyDef } from '../types'

export const ENEMIES: EnemyDef[] = [
  // === 普通敌人 ===
  { id: 'slime', name: '史莱姆', type: 'melee', color: '#27ae60', maxHp: 30, attack: 8, speed: 1.2, range: 30, attackSpeed: 1500, size: 14, xpValue: 10, crystalValue: 0 },
  { id: 'skeleton', name: '骷髅兵', type: 'melee', color: '#bdc3c7', maxHp: 45, attack: 12, speed: 1.5, range: 35, attackSpeed: 1200, size: 15, xpValue: 15, crystalValue: 1 },
  { id: 'goblin_archer', name: '哥布林弓手', type: 'ranged', color: '#2ecc71', maxHp: 25, attack: 10, speed: 1.8, range: 180, attackSpeed: 1800, size: 13, xpValue: 12, crystalValue: 0 },
  { id: 'bat', name: '吸血蝠', type: 'fast', color: '#8e44ad', maxHp: 20, attack: 6, speed: 3.0, range: 25, attackSpeed: 800, size: 10, xpValue: 8, crystalValue: 0 },
  { id: 'golem', name: '石魔像', type: 'tank', color: '#7f8c8d', maxHp: 120, attack: 18, speed: 0.8, range: 35, attackSpeed: 2000, size: 22, xpValue: 25, crystalValue: 1 },
  { id: 'dark_mage', name: '暗黑法师', type: 'ranged', color: '#9b59b6', maxHp: 35, attack: 20, speed: 1.0, range: 200, attackSpeed: 2500, size: 14, xpValue: 20, crystalValue: 1 },
  { id: 'wolf', name: '暗狼', type: 'fast', color: '#546e7a', maxHp: 35, attack: 14, speed: 2.8, range: 30, attackSpeed: 1000, size: 16, xpValue: 14, crystalValue: 1 },
  { id: 'mimic', name: '宝箱怪', type: 'tank', color: '#f39c12', maxHp: 80, attack: 22, speed: 1.0, range: 40, attackSpeed: 1500, size: 20, xpValue: 30, crystalValue: 2 },
  // === Boss ===
  { id: 'boss_spider', name: '蛛后阿拉克涅', type: 'boss', color: '#c0392b', maxHp: 500, attack: 25, speed: 1.5, range: 150, attackSpeed: 1500, size: 35, xpValue: 100, crystalValue: 8, isBoss: true },
  { id: 'boss_dragon', name: '深渊巨龙', type: 'boss', color: '#e74c3c', maxHp: 800, attack: 35, speed: 1.2, range: 200, attackSpeed: 2000, size: 40, xpValue: 150, crystalValue: 12, isBoss: true },
  { id: 'boss_lich', name: '巫妖王', type: 'boss', color: '#4a148c', maxHp: 1200, attack: 40, speed: 1.0, range: 250, attackSpeed: 1800, size: 38, xpValue: 200, crystalValue: 20, isBoss: true },
]

export const FLOOR_ENEMY_POOLS: Record<number, string[]> = {
  1: ['slime', 'bat'],
  2: ['slime', 'skeleton', 'bat'],
  3: ['skeleton', 'goblin_archer', 'bat', 'boss_spider'],
  4: ['skeleton', 'goblin_archer', 'wolf'],
  5: ['wolf', 'golem', 'dark_mage'],
  6: ['wolf', 'golem', 'dark_mage', 'boss_dragon'],
  7: ['golem', 'dark_mage', 'mimic'],
  8: ['dark_mage', 'mimic', 'wolf'],
  9: ['mimic', 'golem', 'dark_mage', 'bat', 'goblin_archer', 'wolf'],
  10: ['mimic', 'dark_mage', 'golem', 'boss_lich'],
}
