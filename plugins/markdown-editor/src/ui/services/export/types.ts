export type ExportFormat = 'markdown' | 'html' | 'pdf' | 'docx'

export interface ExportSource {
  markdown: string
  html: string
  documentName: string
}

export interface ExportDocument extends ExportSource {
  fullHtml: string
}

export interface ExportFilesystem {
  writeFile: (path: string, data: string | ArrayBuffer, encoding?: 'utf-8' | 'base64') => Promise<void>
}

/** Raster image formats that can be embedded directly into a .docx file. */
export type ExportImageType = 'png' | 'jpg' | 'gif' | 'bmp'

/** A decoded, display-sized image ready to embed into an export target. */
export interface ExportImage {
  /** Raw image bytes. */
  data: Uint8Array
  /** Display width in pixels (already fitted to the page width). */
  width: number
  /** Display height in pixels (aspect-ratio preserved). */
  height: number
  /** Image format of `data`. */
  type: ExportImageType
}

/**
 * Resolves an `<img>` element's `src` (as found in the export HTML) into the
 * decoded bytes + display size needed to embed it. Returning `null` leaves the
 * reference as a text placeholder so export never fails on a single bad image.
 */
export type ExportImageResolver = (src: string) => Promise<ExportImage | null>
