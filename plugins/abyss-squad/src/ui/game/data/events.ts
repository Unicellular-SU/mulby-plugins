import type { RoomEvent } from '../types'

export function generateEvent(floorLevel: number, crystals: number, heroHasItems = false): RoomEvent {
  const types: Array<'merchant' | 'altar' | 'treasure_trap'> = ['merchant', 'altar', 'treasure_trap']
  // 每 3 层必出商人，其余随机
  const type = (floorLevel % 3 === 0) ? 'merchant' : types[Math.floor(Math.random() * types.length)]

  switch (type) {
    case 'merchant':
      return {
        id: 'merchant',
        type: 'merchant',
        title: '神秘商人',
        desc: '一位裹着斗篷的商人从阴影中走出，展示他的货物...',
        choices: [
          { label: '购买随机道具', cost: 20, costType: 'crystal', reward: 'random_item', disabled: crystals < 20 },
          { label: '全队回复 50% HP', cost: 15, costType: 'crystal', reward: 'heal_50', disabled: crystals < 15 },
          { label: '离开', reward: 'none' },
        ],
      }
    case 'altar':
      return {
        id: 'altar',
        type: 'altar',
        title: '献祭祭坛',
        desc: '古老的祭坛散发着诡异的光芒，似乎在呼唤着什么...',
        choices: [
          { label: '献祭 20% HP → 获得随机能力', cost: 20, costType: 'hp_percent', reward: 'random_ability' },
          { label: '献祭一个道具 → 获得更高品质道具', cost: 1, costType: 'item', reward: 'upgrade_item', disabled: !heroHasItems },
          { label: '离开', reward: 'none' },
        ],
      }
    case 'treasure_trap':
      return {
        id: 'treasure_trap',
        type: 'treasure_trap',
        title: '宝箱房',
        desc: '房间中央放着一个金光闪闪的宝箱，但周围似乎有危险的气息...',
        choices: [
          { label: '开启宝箱（稀有道具 + 3个强敌）', reward: 'rare_item_plus_enemies' },
          { label: '谨慎搜刮（10 水晶 + 15% HP）', reward: 'safe_loot' },
          { label: '离开', reward: 'none' },
        ],
      }
  }
}
