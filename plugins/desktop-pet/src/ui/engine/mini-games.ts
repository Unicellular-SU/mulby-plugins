import type { PetExpression } from './pet-standard'
import { emotionToExpression } from './pet-standard'
import { extractJsonObject } from './json-utils'
import { logPetPresentation } from './presentation-debug'

export type GameType = 'riddle' | 'idiom' | 'trivia'

export interface GameSession {
  type: GameType
  active: boolean
  answer: string
  attempts: number
}

const GAME_LABELS: Record<GameType, string> = {
  riddle: '猜谜语',
  idiom: '成语接龙',
  trivia: '冷知识问答',
}

export function getGameLabel(type: GameType): string {
  return GAME_LABELS[type]
}

export async function startGame(
  type: GameType,
  model: string,
  onChunk?: (text: string) => void,
): Promise<{ question: string; answer: string; expression: PetExpression } | null> {
  const ai = (window as any).mulby?.ai
  if (!ai || !model) return null

  const prompts: Record<GameType, string> = {
    riddle: '出一个有趣的中文谜语。返回 JSON: {"question":"谜面（不超过30字）","answer":"谜底（1-4字）","hint":"提示（10字内）"}',
    idiom: '出一个成语填空题。返回 JSON: {"question":"__X__（给出成语的一部分，让用户填完整）","answer":"完整成语","hint":"提示（10字内）"}',
    trivia: '出一个有趣的冷知识问答题。返回 JSON: {"question":"问题（不超过30字）","answer":"正确答案（不超过10字）","hint":"提示（10字内）"}',
  }

  try {
    let result = ''
    const req = ai.call(
      {
        model,
        messages: [
          { role: 'system', content: `你是一个小游戏出题助手。${prompts[type]}` },
          { role: 'user', content: '出题吧！' },
        ],
        params: { maxOutputTokens: 150, temperature: 1.0 },
        capabilities: [],
        toolingPolicy: { enableInternalTools: false },
        mcp: { mode: 'off' },
        skills: { mode: 'off' },
      },
      (chunk: any) => {
        if (chunk.chunkType === 'text' && chunk.content) {
          result += chunk.content
        }
      }
    )

    const resp = await req
    if (resp?.content && typeof resp.content === 'string') result = resp.content

    if (!result) return null
    const { data: parsed, reason } = extractJsonObject<{ question?: string; answer?: string }>(result)
    if (!parsed) {
      logPetPresentation('mini-game.parse-failed', { type, reason, sample: result.slice(0, 120) })
      return null
    }
    const question = typeof parsed.question === 'string' ? parsed.question.trim() : ''
    const answer = typeof parsed.answer === 'string' ? parsed.answer.trim() : ''
    if (!question || !answer) return null

    const questionText = `[小游戏·${GAME_LABELS[type]}]\n${question}`
    onChunk?.(questionText)

    return { question: questionText, answer, expression: 'excited' }
  } catch (err) {
    logPetPresentation('mini-game.start.error', {
      type,
      message: (err as Error)?.message ?? String(err),
    })
    return null
  }
}

export function checkAnswer(userAnswer: string, correctAnswer: string): { correct: boolean; expression: PetExpression; response: string } {
  const normalizedUser = userAnswer.trim().toLowerCase()
  const normalizedCorrect = correctAnswer.trim().toLowerCase()

  if (normalizedUser === normalizedCorrect || normalizedUser.includes(normalizedCorrect) || normalizedCorrect.includes(normalizedUser)) {
    return {
      correct: true,
      expression: 'excited',
      response: `答对啦！答案就是「${correctAnswer}」！`,
    }
  }

  return {
    correct: false,
    expression: 'surprised',
    response: `不对哦~ 再想想？`,
  }
}

export function getGameAnswer(correctAnswer: string): string {
  return `答案是「${correctAnswer}」！下次一定能猜到~`
}
