import React, { useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import { FileItem } from '../../utils'
import { PreviewMeta, FileInfo, PreviewError } from './PreviewChrome'

interface Props {
  file: FileItem
  base64: string
  fileInfo: FileInfo | null
}

const MAX_ROWS = 200
const MAX_COLS = 50

export default function SpreadsheetPreview({ file, base64, fileInfo }: Props) {
  const parsed = useMemo(() => {
    try {
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
      const wb = XLSX.read(bytes, { type: 'array' })
      return { ok: true as const, wb }
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) }
    }
  }, [base64])

  const [active, setActive] = useState(0)

  if (!parsed.ok) return <PreviewError message={parsed.error} />

  const { wb } = parsed
  const sheetName = wb.SheetNames[active] ?? wb.SheetNames[0]
  const ws = wb.Sheets[sheetName]
  const rows = (ws ? XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: '' }) : []) as unknown[][]
  const totalRows = rows.length
  const totalCols = rows.reduce((m, r) => Math.max(m, r.length), 0)
  const shown = rows.slice(0, MAX_ROWS).map((r) => r.slice(0, MAX_COLS))
  const clipped = totalRows > MAX_ROWS || totalCols > MAX_COLS

  return (
    <div className="preview-area flex-1 relative" style={{ alignItems: 'stretch', justifyContent: 'stretch' }}>
      {wb.SheetNames.length > 1 && (
        <div className="preview-toolbar sheet-tabs">
          {wb.SheetNames.map((n, i) => (
            <button
              key={n}
              className={`preview-toggle${i === active ? ' active' : ''}`}
              onClick={() => setActive(i)}
            >
              {n}
            </button>
          ))}
        </div>
      )}
      {clipped && (
        <div className="preview-banner">
          仅显示前 {Math.min(MAX_ROWS, totalRows)} / {totalRows} 行 · {Math.min(MAX_COLS, totalCols)} / {totalCols} 列
        </div>
      )}
      <div className="table-scroll">
        <table className="preview-table">
          <tbody>
            {shown.map((r, ri) => (
              <tr key={ri}>
                <td className="row-head">{ri + 1}</td>
                {Array.from({ length: Math.min(totalCols, MAX_COLS) }).map((_, ci) => {
                  const cell = r[ci]
                  return <td key={ci}>{cell === '' || cell == null ? '' : String(cell)}</td>
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <PreviewMeta file={file} fileInfo={fileInfo} />
    </div>
  )
}
