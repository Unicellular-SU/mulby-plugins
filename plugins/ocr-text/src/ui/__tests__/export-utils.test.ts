import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  latexToSvg,
  markdownTableToExcelHtml,
  markdownTableToTsv,
  normalizeLatex,
  parseMarkdownTable,
} from '../exportUtils.ts'

const table = `
| 姓名 | 分数 |
| --- | ---: |
| Alice | 98 |
| Bob | 87 |
`

describe('OCR export utilities', () => {
  it('parses markdown tables into headers and rows', () => {
    assert.deepEqual(parseMarkdownTable(table), {
      headers: ['姓名', '分数'],
      rows: [
        ['Alice', '98'],
        ['Bob', '87'],
      ],
    })
  })

  it('converts markdown tables to TSV for Excel clipboard paste', () => {
    assert.equal(markdownTableToTsv(table), '姓名\t分数\nAlice\t98\nBob\t87')
  })

  it('converts markdown tables to Excel-compatible HTML', () => {
    const html = markdownTableToExcelHtml(table)

    assert.match(html, /<table border="1">/)
    assert.match(html, /<th>姓名<\/th>/)
    assert.match(html, /<td>98<\/td>/)
  })

  it('normalizes LaTeX delimiters before image export', () => {
    assert.equal(normalizeLatex(' $$ E = mc^2 $$ '), 'E = mc^2')
    assert.equal(normalizeLatex('$a+b$'), 'a+b')
  })

  it('exports LaTeX as escaped SVG text', () => {
    const svg = latexToSvg('$$ x < y & y > z $$')

    assert.match(svg, /^<svg /)
    assert.match(svg, /x &lt; y &amp; y &gt; z/)
  })
})
