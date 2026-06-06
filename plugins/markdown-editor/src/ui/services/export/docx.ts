import {
  Document,
  ExternalHyperlink,
  HeadingLevel,
  ImageRun,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type IImageOptions,
  type ParagraphChild
} from 'docx'
import type { ExportDocument, ExportFilesystem, ExportImage, ExportImageResolver } from './types'

interface InlineMarks {
  bold?: boolean
  italics?: boolean
  code?: boolean
}

const TABLE_HEADER_FILL = 'F3F4F6'

function normalizeInlineText(value: string) {
  return value.replace(/\s+/g, ' ')
}

function getHeadingLevel(tagName: string) {
  switch (tagName) {
    case 'h1':
      return HeadingLevel.HEADING_1
    case 'h2':
      return HeadingLevel.HEADING_2
    case 'h3':
      return HeadingLevel.HEADING_3
    case 'h4':
      return HeadingLevel.HEADING_4
    case 'h5':
      return HeadingLevel.HEADING_5
    default:
      return HeadingLevel.HEADING_6
  }
}

function toArrayBuffer(value: ArrayBuffer | Uint8Array) {
  if (value instanceof ArrayBuffer) {
    return value
  }

  return value.slice().buffer
}

function getPlainText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return normalizeInlineText(node.textContent ?? '')
  }

  if (!(node instanceof HTMLElement)) {
    return ''
  }

  if (node.tagName.toLowerCase() === 'input' && node.getAttribute('type') === 'checkbox') {
    return node.hasAttribute('checked') ? '[x] ' : '[ ] '
  }

  if (node.tagName.toLowerCase() === 'img') {
    return `[图片: ${node.getAttribute('alt') || node.getAttribute('src') || '未命名图片'}]`
  }

  return Array.from(node.childNodes)
    .map((child) => getPlainText(child))
    .join('')
}

function buildCodeParagraphs(code: string) {
  const lines = code.replace(/\n$/, '').split('\n')
  const runs: TextRun[] = []

  lines.forEach((line, index) => {
    runs.push(new TextRun({
      text: line || ' ',
      font: 'Consolas',
      size: 20,
      break: index === 0 ? 0 : 1
    }))
  })

  return [new Paragraph({ children: runs })]
}

/**
 * Builds the DOM-walking conversion functions, closing over the pre-resolved
 * image map so synchronous building can look up embedded picture bytes. Mutual
 * recursion across inline/block/list/table builders relies on hoisting.
 */
function createDocxBuilder(images: Map<string, ExportImage>) {
  function imageChild(element: HTMLElement): ParagraphChild {
    const src = element.getAttribute('src') ?? ''
    const alt = element.getAttribute('alt') ?? ''
    const resolved = src ? images.get(src) : undefined
    if (resolved) {
      return new ImageRun({
        data: toArrayBuffer(resolved.data),
        type: resolved.type,
        transformation: { width: resolved.width, height: resolved.height }
      } as IImageOptions)
    }
    return new TextRun({ text: `[图片: ${alt || src || '未命名图片'}]`, italics: true })
  }

  function buildInlineChildren(node: Node, marks: InlineMarks = {}): ParagraphChild[] {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = normalizeInlineText(node.textContent ?? '')
      if (!text.trim()) {
        return []
      }

      return [new TextRun({
        text,
        bold: marks.bold,
        italics: marks.italics,
        font: marks.code ? 'Consolas' : undefined,
        size: marks.code ? 20 : undefined
      })]
    }

    if (!(node instanceof HTMLElement)) {
      return []
    }

    const tagName = node.tagName.toLowerCase()

    if (tagName === 'br') {
      return [new TextRun({ text: '', break: 1 })]
    }

    if (tagName === 'strong' || tagName === 'b') {
      return Array.from(node.childNodes).flatMap((child) => buildInlineChildren(child, { ...marks, bold: true }))
    }

    if (tagName === 'em' || tagName === 'i') {
      return Array.from(node.childNodes).flatMap((child) => buildInlineChildren(child, { ...marks, italics: true }))
    }

    if (tagName === 'code') {
      return Array.from(node.childNodes).flatMap((child) => buildInlineChildren(child, { ...marks, code: true }))
    }

    if (tagName === 'a') {
      const href = node.getAttribute('href')
      const text = getPlainText(node).trim() || href || '链接'
      const linkRun = new TextRun({
        text,
        bold: marks.bold,
        italics: marks.italics,
        style: 'Hyperlink'
      })

      if (href) {
        return [new ExternalHyperlink({ link: href, children: [linkRun] })]
      }

      return [linkRun]
    }

    if (tagName === 'input' && node.getAttribute('type') === 'checkbox') {
      return [new TextRun({ text: node.hasAttribute('checked') ? '[x] ' : '[ ] ' })]
    }

    if (tagName === 'img') {
      return [imageChild(node)]
    }

    return Array.from(node.childNodes).flatMap((child) => buildInlineChildren(child, marks))
  }

  function paragraphFromInlineElement(element: HTMLElement): Paragraph[] {
    const children = buildInlineChildren(element)
    if (children.length === 0) {
      return []
    }

    return [new Paragraph({ children })]
  }

  function buildListParagraphs(list: HTMLElement, depth = 0): Paragraph[] {
    const ordered = list.tagName.toLowerCase() === 'ol'
    const items = Array.from(list.children).filter((child): child is HTMLLIElement => child instanceof HTMLLIElement)
    const paragraphs: Paragraph[] = []

    items.forEach((item, index) => {
      const prefix = ordered ? `${index + 1}. ` : '• '
      const inlineChildren = Array.from(item.childNodes)
        .filter((child) => !(child instanceof HTMLElement && (child.tagName.toLowerCase() === 'ul' || child.tagName.toLowerCase() === 'ol')))
        .flatMap((child) => buildInlineChildren(child))

      if (inlineChildren.length > 0) {
        paragraphs.push(new Paragraph({
          indent: { left: 360 * depth },
          children: [new TextRun({ text: prefix }), ...inlineChildren]
        }))
      }

      Array.from(item.children)
        .filter((child): child is HTMLElement => child instanceof HTMLElement && (child.tagName.toLowerCase() === 'ul' || child.tagName.toLowerCase() === 'ol'))
        .forEach((nestedList) => {
          paragraphs.push(...buildListParagraphs(nestedList, depth + 1))
        })
    })

    return paragraphs
  }

  function buildTableCell(cell: HTMLElement, header: boolean): TableCell {
    const inline = buildInlineChildren(cell, header ? { bold: true } : {})
    return new TableCell({
      shading: header ? { fill: TABLE_HEADER_FILL } : undefined,
      children: [new Paragraph({ children: inline.length > 0 ? inline : [new TextRun({ text: '' })] })]
    })
  }

  function buildTable(table: HTMLTableElement): Table | null {
    const rows = Array.from(table.querySelectorAll('tr'))
    const tableRows: TableRow[] = []

    rows.forEach((row) => {
      const cells = Array.from(row.querySelectorAll('th, td')).filter(
        (cell): cell is HTMLElement => cell instanceof HTMLElement
      )
      if (cells.length === 0) {
        return
      }
      const isHeaderRow = cells.every((cell) => cell.tagName.toLowerCase() === 'th')
      tableRows.push(new TableRow({
        tableHeader: isHeaderRow,
        children: cells.map((cell) => buildTableCell(cell, cell.tagName.toLowerCase() === 'th'))
      }))
    })

    if (tableRows.length === 0) {
      return null
    }

    return new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: tableRows
    })
  }

  function buildBlock(element: HTMLElement): Array<Paragraph | Table> {
    const tagName = element.tagName.toLowerCase()

    if (/^h[1-6]$/.test(tagName)) {
      const children = buildInlineChildren(element)
      if (children.length === 0) {
        return []
      }

      return [new Paragraph({
        heading: getHeadingLevel(tagName),
        children
      })]
    }

    if (tagName === 'p') {
      return paragraphFromInlineElement(element)
    }

    if (tagName === 'blockquote') {
      const text = getPlainText(element).trim()
      if (!text) {
        return []
      }

      return [new Paragraph({
        indent: { left: 420 },
        children: [new TextRun({ text, italics: true })]
      })]
    }

    if (tagName === 'pre') {
      const codeElement = element.querySelector('code')
      const code = (codeElement?.textContent ?? element.textContent ?? '').replace(/\r\n/g, '\n')
      return buildCodeParagraphs(code)
    }

    if (tagName === 'ul' || tagName === 'ol') {
      return buildListParagraphs(element)
    }

    if (tagName === 'table') {
      const table = buildTable(element as HTMLTableElement)
      return table ? [table] : []
    }

    if (tagName === 'hr') {
      return [new Paragraph({ children: [new TextRun({ text: '──────────────' })] })]
    }

    if (tagName === 'img') {
      return [new Paragraph({ children: [imageChild(element)] })]
    }

    const childElements = Array.from(element.children).filter((child): child is HTMLElement => child instanceof HTMLElement)
    if (childElements.length > 0) {
      return childElements.flatMap((child) => buildBlock(child))
    }

    return paragraphFromInlineElement(element)
  }

  return { buildBlock }
}

/** Decodes and display-sizes every unique `<img>` in the document up front. */
async function resolveDocumentImages(
  htmlDocument: globalThis.Document,
  resolveImage?: ExportImageResolver
): Promise<Map<string, ExportImage>> {
  const images = new Map<string, ExportImage>()
  if (!resolveImage) {
    return images
  }

  const sources = Array.from(
    new Set(
      Array.from(htmlDocument.querySelectorAll('img'))
        .map((img) => img.getAttribute('src') ?? '')
        .filter((src) => src.length > 0)
    )
  )

  await Promise.all(sources.map(async (src) => {
    try {
      const resolved = await resolveImage(src)
      if (resolved && resolved.data.length > 0) {
        images.set(src, resolved)
      }
    } catch {
      // Leave unresolved images as text placeholders; never fail the whole export.
    }
  }))

  return images
}

export async function exportDocxFile(
  document: ExportDocument,
  path: string,
  filesystem: ExportFilesystem,
  resolveImage?: ExportImageResolver
) {
  const parser = new DOMParser()
  const htmlDocument = parser.parseFromString(document.fullHtml, 'text/html')

  const images = await resolveDocumentImages(htmlDocument, resolveImage)
  const { buildBlock } = createDocxBuilder(images)

  const bodyChildren = Array.from(htmlDocument.body.children)
    .filter((child): child is HTMLElement => child instanceof HTMLElement)
    .flatMap((child) => buildBlock(child))

  const doc = new Document({
    sections: [
      {
        children: bodyChildren.length > 0
          ? bodyChildren
          : [new Paragraph({ children: [new TextRun(document.markdown || ' ')] })]
      }
    ]
  })

  const buffer = await Packer.toBuffer(doc)
  await filesystem.writeFile(path, toArrayBuffer(buffer as Uint8Array | ArrayBuffer))
}
