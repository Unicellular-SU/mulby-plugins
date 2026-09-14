import { useEffect, useRef, useState } from 'react'
import { useMulby } from './useMulby'
import './styles.css'

const extOK = (p: string) => /\.(jpe?g|png|webp|bmp)$/i.test(p)
type WmPosition = 'tl' | 'tr' | 'bl' | 'br' | 'center'
type Settings = { text:string; opacity:number; angle:number; size:number; color:string; wm:string; wmScale:number; wmPosition:WmPosition; wmTile:boolean }

function drawWatermark(canvas: HTMLCanvasElement, image: HTMLImageElement, s: Settings): Promise<void> {
  canvas.width = image.naturalWidth || image.width; canvas.height = image.naturalHeight || image.height
  const ctx = canvas.getContext('2d'); if (!ctx) return Promise.resolve()
  ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
  const drawText = () => {
    if (!s.text.trim()) return
    ctx.globalAlpha = s.opacity / 100; ctx.fillStyle = s.color; ctx.font = `600 ${s.size}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    const gap = s.size * 6; const rad = s.angle * Math.PI / 180
    for (let y = -canvas.height; y < canvas.height * 2; y += gap) for (let x = -canvas.width; x < canvas.width * 2; x += gap) { ctx.save(); ctx.translate(x, y); ctx.rotate(rad); ctx.fillText(s.text, 0, 0); ctx.restore() }
    ctx.globalAlpha = 1
  }
  if (!s.wm) { drawText(); return Promise.resolve() }
  return new Promise(resolve => {
    const logo = new Image(); const finish = () => { drawText(); resolve() }
    logo.onload = () => {
      const w = Math.max(48, Math.round(canvas.width * s.wmScale / 100)); const h = Math.max(32, Math.round(w * logo.naturalHeight / Math.max(1, logo.naturalWidth)));
      ctx.globalAlpha = s.opacity / 100
      if (s.wmTile) for (let y = -h; y < canvas.height + h; y += h + 36) for (let x = -w; x < canvas.width + w; x += w + 36) ctx.drawImage(logo, x, y, w, h)
      else { const p: Record<WmPosition, {x:number;y:number}> = { tl:{x:24,y:24}, tr:{x:canvas.width-w-24,y:24}, bl:{x:24,y:canvas.height-h-24}, br:{x:canvas.width-w-24,y:canvas.height-h-24}, center:{x:(canvas.width-w)/2,y:(canvas.height-h)/2} }; const pos = p[s.wmPosition]; ctx.drawImage(logo, pos.x, pos.y, w, h) }
      finish()
    }; logo.onerror = finish; logo.src = s.wm
  })
}

export default function App() {
  const m = useMulby('secure-watermark'); const canvasRef = useRef<HTMLCanvasElement>(null)
  const [files, setFiles] = useState<string[]>([]); const [text, setText] = useState('仅供办理业务使用'); const [opacity, setOpacity] = useState(35); const [angle, setAngle] = useState(-25); const [size, setSize] = useState(28); const [color, setColor] = useState('#2457d6'); const [wm, setWm] = useState(''); const [wmScale, setWmScale] = useState(24); const [wmPosition, setWmPosition] = useState<WmPosition>('br'); const [wmTile, setWmTile] = useState(false); const [previewUrl, setPreviewUrl] = useState(''); const [previewName, setPreviewName] = useState(''); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState('')
  const settings: Settings = { text, opacity, angle, size, color, wm, wmScale, wmPosition, wmTile }

  useEffect(() => { m.host.call('getPendingInit').then((r:any) => setFiles((r?.data?.paths || []).filter(extOK))); window.mulby?.onPluginInit?.((d:any) => setFiles((d.attachments || []).map((a:any) => a.path).filter((p:any) => typeof p === 'string' && extOK(p)))) }, [])
  useEffect(() => { let cancelled = false; const load = async () => { const file = files[0]; if (!file) { setPreviewUrl(''); setPreviewName(''); return }; const r:any = await m.host.call('previewFile', file); if (!cancelled && r?.data?.data) { setPreviewUrl(`data:${r.data.mimeType};base64,${r.data.data}`); setPreviewName(file.split(/[\\/]/).pop() || file) } }; void load().catch(() => { if (!cancelled) setPreviewUrl('') }); return () => { cancelled = true } }, [files])
  useEffect(() => { if (!previewUrl || !canvasRef.current) return; const image = new Image(); image.onload = () => { void drawWatermark(canvasRef.current!, image, settings) }; image.src = previewUrl }, [previewUrl, text, opacity, angle, size, color, wm, wmScale, wmPosition, wmTile])

  const addWm = (e:any) => { const file = e.target.files?.[0]; if (!file) return; const reader = new FileReader(); reader.onload = () => setWm(reader.result as string); reader.readAsDataURL(file) }
  const add = async (e:any) => { const picked = Array.from(e.target.files || []) as Array<File & {path?:string}>; const direct = picked.map(f => f.path || '').filter(Boolean); let resolved:string[] = []; try { const fn = (window.mulby?.plugin as any)?.resolveDroppedFilePaths; if (fn) resolved = await fn(picked) } catch { /* optional */ }; setFiles(prev => [...new Set([...prev, ...direct, ...resolved].filter(extOK))]) }
  async function process() { if (!files.length || (!text.trim() && !wm)) return; setBusy(true); setMsg('处理中…'); let ok = 0; for (const file of files) { try { const r:any = await m.host.call('previewFile', file); if (!r?.data?.data) continue; const image = new Image(); image.src = `data:${r.data.mimeType};base64,${r.data.data}`; await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('load')) }); const canvas = document.createElement('canvas'); await drawWatermark(canvas, image, settings); await new Promise(resolve => setTimeout(resolve, 0)); const ext = (file.match(/\.[^.]+$/)?.[0] || '.jpg').toLowerCase(); const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg'; const base64 = canvas.toDataURL(mime, .92).split(',')[1]; const output = file.replace(/(\.[^.]+)?$/, `_watermarked${mime === 'image/jpeg' ? '.jpg' : ext}`); const wr:any = await m.host.call('writeFile', output, base64); if (wr?.data?.ok) ok++ } catch { /* continue */ } }; setBusy(false); setMsg(`已完成 ${ok}/${files.length} 张，文件名追加 _watermarked`) }

  return <main><header><div className="badge">盾</div><div><h1>证件安全水印</h1><p>批量添加可追溯的限制使用标识，文件只在本机处理</p></div></header><section className="drop"><input type="file" multiple accept="image/*" onChange={add}/><strong>拖入身份证、营业执照图片</strong><span>或点击选择文件（支持 JPG、PNG、WebP、BMP）</span></section><div className="grid"><section className="card"><h2>水印设置</h2><label>水印文字<input value={text} onChange={e => setText(e.target.value)} /></label><label>颜色 <input type="color" value={color} onChange={e => setColor(e.target.value)}/></label><label>透明度 <b>{opacity}%</b><input type="range" min="10" max="80" value={opacity} onChange={e => setOpacity(+e.target.value)}/></label><label>字号 <b>{size}px</b><input type="range" min="16" max="64" value={size} onChange={e => setSize(+e.target.value)}/></label><label>倾斜角度 <b>{angle}°</b><input type="range" min="-60" max="0" value={angle} onChange={e => setAngle(+e.target.value)}/></label><label>图片水印素材 <input type="file" accept="image/*" onChange={addWm}/>{wm && <small> 已选择</small>}</label>{wm && <><label>图片水印大小 <b>{wmScale}%</b><input type="range" min="8" max="60" value={wmScale} onChange={e => setWmScale(+e.target.value)}/></label><label>图片水印位置 <select value={wmPosition} onChange={e => setWmPosition(e.target.value as WmPosition)}><option value="br">右下角</option><option value="bl">左下角</option><option value="tr">右上角</option><option value="tl">左上角</option><option value="center">居中</option></select></label><label className="check"><input type="checkbox" checked={wmTile} onChange={e => setWmTile(e.target.checked)}/> 平铺图片水印</label></>}<div className="presets"><button onClick={() => setText('仅供办理业务使用')}>办理业务</button><button onClick={() => setText('仅供XXX公司入职使用')}>入职专用</button><button onClick={() => setText('仅供贷款审核使用')}>贷款审核</button><button onClick={() => setText('仅供报税/年审使用')}>营业执照</button></div></section><section className="card"><h2>实时预览 <small>{previewName || '先添加一张图片'}</small></h2><div className="preview">{previewUrl ? <canvas ref={canvasRef}/> : <div className="empty">添加图片后在这里预览水印效果</div>}</div><p className="hint">调整设置后预览会自动更新，批量导出会处理全部图片。</p><h2>待处理图片 <small>{files.length} 张</small></h2>{files.length ? <ul>{files.map((f, i) => <li key={f}><span>▧</span>{f.split(/[\\/]/).pop()}<button onClick={() => setFiles(x => x.filter((_, j) => j !== i))}>移除</button></li>)}</ul> : <div className="empty compact">尚未添加图片</div>}<button className="primary" disabled={busy || !files.length} onClick={process}>{busy ? '正在处理…' : '批量添加水印并导出'}</button>{msg && <p className="msg">{msg}</p>}</section></div></main>
}
