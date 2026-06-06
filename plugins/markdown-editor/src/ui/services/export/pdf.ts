import { exportNeedsRenderWait } from './enhance'
import type { ExportDocument } from './types'

interface InBrowserBuilder {
  goto: (url: string, headers?: Record<string, string>, timeout?: number) => InBrowserBuilder
  viewport: (width: number, height: number) => InBrowserBuilder
  css: (cssText: string) => InBrowserBuilder
  pdf: (options?: Record<string, unknown>, savePath?: string) => InBrowserBuilder
  wait: (msOrSelectorOrFunc: number | string | Function, ...params: unknown[]) => InBrowserBuilder
  run: (idOrOptions?: number | Record<string, unknown>, options?: Record<string, unknown>) => Promise<unknown[]>
}

interface InBrowserApi {
  goto: InBrowserBuilder['goto']
  viewport: InBrowserBuilder['viewport']
  css: InBrowserBuilder['css']
  pdf: InBrowserBuilder['pdf']
  wait: InBrowserBuilder['wait']
  run: InBrowserBuilder['run']
}

function toDataUrl(html: string) {
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
}

export async function exportPdfFile(document: ExportDocument, path: string) {
  const inbrowser = (window.mulby?.inbrowser as InBrowserApi | undefined)

  if (!inbrowser) {
    throw new Error('当前环境不支持 PDF 导出')
  }

  // Math/mermaid render asynchronously via injected CDN scripts; give them time.
  const renderWaitMs = exportNeedsRenderWait(document.fullHtml) ? 1800 : 250

  await inbrowser
    .goto(toDataUrl(document.fullHtml))
    .viewport(1280, 1800)
    .wait(renderWaitMs)
    .pdf({
      printBackground: true,
      preferCSSPageSize: true,
      marginsType: 0,
      pageSize: 'A4'
    }, path)
    .run({
      show: false,
      width: 1280,
      height: 1800,
      backgroundColor: '#ffffff'
    })
}
