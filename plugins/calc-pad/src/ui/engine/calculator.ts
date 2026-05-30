// src/ui/engine/calculator.ts

export interface EvalResult {
  value: number
  error?: string
}

class Parser {
  private pos = 0
  private tokens: string[] = []

  constructor(private readonly expression: string, private readonly previousAns: number = 0) {
    this.tokenize()
  }

  private tokenize() {
    const expr = this.expression.replace(/ans/ig, this.previousAns.toString())
    const regex = /\s*([A-Za-z0-9_.]+|[+\-*\/^%()×÷])\s*/g
    let match
    while ((match = regex.exec(expr)) !== null) {
      this.tokens.push(match[1])
    }
  }

  private peek(): string | undefined {
    return this.tokens[this.pos]
  }

  private consume(): string | undefined {
    return this.tokens[this.pos++]
  }

  public parse(): number {
    if (this.tokens.length === 0) return 0
    const result = this.parseExpression()
    if (this.pos < this.tokens.length) {
      throw new Error(`Unexpected token at end: ${this.peek()}`)
    }
    return result
  }

  private parseExpression(): number {
    let left = this.parseTerm()
    while (true) {
      const op = this.peek()
      if (op === '+' || op === '-') {
        this.consume()
        const right = this.parseTerm()
        if (op === '+') left += right
        else left -= right
      } else {
        break
      }
    }
    return left
  }

  private parseTerm(): number {
    let left = this.parseFactor()
    while (true) {
      const op = this.peek()
      if (op === '*' || op === '×' || op === 'x' || op === '/' || op === '÷') {
        this.consume()
        const right = this.parseFactor()
        if (op === '*' || op === '×' || op === 'x') left *= right
        else left /= right
      } else {
        break
      }
    }
    return left
  }

  private parseFactor(): number {
    let left = this.parsePrimary()
    while (true) {
      const op = this.peek()
      if (op === '^' || op === '**') {
        this.consume()
        const right = this.parsePrimary() // right-associative usually, but this handles sequence
        left = Math.pow(left, right)
      } else if (op === '%') {
        this.consume()
        left = left / 100
      } else {
        break
      }
    }
    return left
  }

  private parsePrimary(): number {
    const token = this.consume()
    if (!token) throw new Error('Unexpected end of expression')

    if (token === '-' || token === '+') {
      const val = this.parsePrimary()
      return token === '-' ? -val : val
    }

    if (token === '(') {
      const val = this.parseExpression()
      const close = this.consume()
      if (close !== ')') throw new Error('Expected )')
      return val
    }

    const num = Number(token.replace(/,/g, ''))
    if (isNaN(num)) throw new Error(`Invalid number: ${token}`)
    return num
  }
}

export function evaluate(expr: string, prevAns: number = 0): EvalResult {
  if (!expr || expr.trim() === '') {
    return { value: 0, error: 'empty' }
  }
  try {
    const parser = new Parser(expr, prevAns)
    const val = parser.parse()
    if (!isFinite(val) || isNaN(val)) {
      return { value: 0, error: 'Invalid result' }
    }
    return { value: val }
  } catch (err: any) {
    return { value: 0, error: err.message || 'Error' }
  }
}

export function formatResult(value: number): string {
  if (value === 0) return '0'
  const rounded = Math.round(value * 1e8) / 1e8 // precision
  const parts = rounded.toString().split('.')
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return parts.join('.')
}
