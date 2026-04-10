export type TextStats = {
  rawCharacters: number
  charactersNoSpaces: number
  chineseCharacters: number
  latinLetters: number
  englishWords: number
  numbers: number
  whitespace: number
  symbols: number
  paragraphs: number
  lines: number
  sentences: number
  readingMinutes: number
}

function toCharacters(input: string) {
  return Array.from(input)
}

export function analyzeText(input: string): TextStats {
  const normalized = input.replace(/\r\n?/g, '\n')
  const characters = toCharacters(normalized)

  const rawCharacters = characters.length
  const charactersNoSpaces = characters.filter((character) => !/\s/u.test(character)).length
  const chineseCharacters = characters.filter((character) => /\p{Script=Han}/u.test(character)).length
  const latinLetters = characters.filter((character) => /[A-Za-z]/.test(character)).length
  const englishWords = normalized.match(/[A-Za-z]+(?:[’'-][A-Za-z]+)*/g)?.length ?? 0
  const numbers = characters.filter((character) => /\p{Number}/u.test(character)).length
  const whitespace = characters.filter((character) => /\s/u.test(character)).length
  const symbols = Math.max(0, rawCharacters - chineseCharacters - latinLetters - numbers - whitespace)

  const trimmed = normalized.trim()
  const lines = trimmed ? normalized.split('\n').length : 0
  const paragraphs = trimmed ? normalized.split(/\n\s*\n/u).filter((part) => part.trim()).length : 0
  const sentences = trimmed
    ? normalized.split(/[.!?。！？]+/u).filter((part) => part.trim()).length
    : 0

  const mixedReadingMinutes = chineseCharacters / 320 + englishWords / 220
  const fallbackReadingMinutes = charactersNoSpaces / 500
  const readingMinutes = trimmed
    ? Number(Math.max(mixedReadingMinutes, fallbackReadingMinutes).toFixed(1))
    : 0

  return {
    rawCharacters,
    charactersNoSpaces,
    chineseCharacters,
    latinLetters,
    englishWords,
    numbers,
    whitespace,
    symbols,
    paragraphs,
    lines,
    sentences,
    readingMinutes
  }
}
