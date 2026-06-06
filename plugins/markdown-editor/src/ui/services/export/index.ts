import { buildExportHtml, replaceExtension } from './html'
import type { ExportDocument, ExportSource, ExportFilesystem } from './types'

export function createExportDocument(source: ExportSource): ExportDocument {
  return {
    ...source,
    fullHtml: buildExportHtml(source)
  }
}

export async function exportHtmlFile(
  document: ExportDocument,
  path: string,
  filesystem: ExportFilesystem
) {
  await filesystem.writeFile(path, document.fullHtml, 'utf-8')
}

export { replaceExtension }
export { exportPdfFile } from './pdf'
export { exportDocxFile } from './docx'
export type {
  ExportDocument,
  ExportFilesystem,
  ExportFormat,
  ExportImage,
  ExportImageResolver,
  ExportImageType,
  ExportSource
} from './types'
