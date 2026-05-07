export interface Festival {
  name: string
  month: number
  day: number
  lunar?: boolean
  greeting: string
  expression: string
}

export const FESTIVALS: Festival[] = [
  { name: '元旦', month: 1, day: 1, greeting: '新年快乐！新的一年要更开心哦~', expression: 'excited' },
  { name: '情人节', month: 2, day: 14, greeting: '情人节快乐！今天有没有收到小心心呀~', expression: 'love' },
  { name: '妇女节', month: 3, day: 8, greeting: '女神节快乐！你是最棒的~', expression: 'happy' },
  { name: '愚人节', month: 4, day: 1, greeting: '嘿嘿，今天是愚人节，小心被骗哦~', expression: 'surprised' },
  { name: '劳动节', month: 5, day: 1, greeting: '劳动节快乐！今天可以好好休息~', expression: 'happy' },
  { name: '儿童节', month: 6, day: 1, greeting: '六一快乐！谁还不是个宝宝呢~', expression: 'excited' },
  { name: '七夕', month: 8, day: 10, greeting: '七夕快乐！今晚的星星格外亮呢~', expression: 'love' },
  { name: '中秋节', month: 9, day: 17, greeting: '中秋快乐！月饼好吃吗~', expression: 'happy' },
  { name: '国庆节', month: 10, day: 1, greeting: '国庆快乐！假期愉快~', expression: 'excited' },
  { name: '万圣节', month: 10, day: 31, greeting: 'Trick or Treat! 万圣节快乐，我可是正宗的小幽灵哦~', expression: 'excited' },
  { name: '光棍节', month: 11, day: 11, greeting: '双十一快乐！钱包还好吗~', expression: 'surprised' },
  { name: '平安夜', month: 12, day: 24, greeting: '平安夜快乐！圣诞老人会来看你的~', expression: 'happy' },
  { name: '圣诞节', month: 12, day: 25, greeting: 'Merry Christmas! 圣诞快乐~', expression: 'excited' },
  { name: '跨年夜', month: 12, day: 31, greeting: '最后一天了！一起倒计时迎接新年吧~', expression: 'excited' },
]

export function checkFestival(date: Date = new Date()): Festival | null {
  const month = date.getMonth() + 1
  const day = date.getDate()
  return FESTIVALS.find(f => f.month === month && f.day === day) ?? null
}

export function checkBirthday(birthday: string | undefined, date: Date = new Date()): boolean {
  if (!birthday) return false
  const parts = birthday.split('-')
  if (parts.length < 2) return false
  const bMonth = parseInt(parts[parts.length - 2], 10)
  const bDay = parseInt(parts[parts.length - 1], 10)
  return (date.getMonth() + 1) === bMonth && date.getDate() === bDay
}
