import { useState, useEffect, useCallback } from 'react'
import { useMulby } from './hooks/useMulby'
import FileList from './components/FileList'
import SettingsPanel from './components/SettingsPanel'
import ProgressBar from './components/ProgressBar'
import type { CompressSettings, StagedItem } from '../pipeline/types'

const PLUGIN_ID = 'batch-image-compress'
const IMG_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif', '.tiff', '.bmp', '.svg', '.ico']

const DEFAULT_SETTINGS: CompressSettings = {
  format: 'original', quality: 80, suffix: '_compressed', outputMode: 'sameDir',
}

function fmt(n: number): string {
  if (n === 0) return '0 B'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(2)} MB`
}

function isImage(p: string) { return IMG_EXTS.includes(p.toLowerCase().slice(p.lastIndexOf('.'))) }

function parseDroppedPathText(raw: string): string[] {
  if (!raw) return []
  return raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean).filter(l => !l.startsWith('#'))
    .map(line => {
      if (line.startsWith('file://')) {
        try {
          let p = decodeURIComponent(line.replace(/^file:\/\//, ''))
          // Windows: /C:/... → C:/...
          if (p.startsWith('/') && p.match(/^\/[a-zA-Z]:\//)) p = p.substring(1)
          return p
        } catch { return line.replace(/^file:\/\//, '') }
      }
      return line
    })
}

function collectPaths(e: DragEvent): string[] {
  const dt = e.dataTransfer
  if (!dt) return []
  const candidates = new Set<string>()

  // Channel 1: File.path
  for (let i = 0; i < (dt.files?.length || 0); i++) {
    const file = dt.files[i] as File & { path?: string }
    if (file.path) candidates.add(file.path)
  }

  // Channel 2: text/uri-list
  parseDroppedPathText(dt.getData('text/uri-list')).forEach(p => candidates.add(p))

  // Channel 3: text/plain
  parseDroppedPathText(dt.getData('text/plain')).forEach(p => candidates.add(p))

  return [...candidates].filter(Boolean).filter(isImage)
}

export default function App() {
  const m = useMulby(PLUGIN_ID)
  const [files, setFiles] = useState<string[]>([])
  const [settings, setSettings] = useState(DEFAULT_SETTINGS)
  const [staged, setStaged] = useState<StagedItem[]>([])
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState({ current: 0, total: 0 })
  const [errors, setErrors] = useState<{ file: string; message: string }[]>([])
  const [dragOver, setDragOver] = useState(false)
  const [theme, setTheme] = useState<'light'|'dark'>('light')
  const [loaded, setLoaded] = useState(false)

  // Theme
  useEffect(() => {
    const p = new URLSearchParams(location.search).get('theme')
    if (p === 'dark' || p === 'light') setTheme(p)
    window.mulby?.theme?.getActual().then((t: string) => { if (t === 'dark'||t === 'light') setTheme(t) }).catch(()=>{})
    window.mulby?.onThemeChange?.((t: string) => { if (t === 'dark'||t === 'light') setTheme(t) })
  }, [])
  useEffect(() => { document.documentElement.classList.toggle('dark', theme === 'dark') }, [theme])

  // Init
  useEffect(() => {
    (async () => {
      try { const r = await m.host.call('loadSettings'); if (r?.data) setSettings(s=>({...s,...r.data})) } catch {}
      setLoaded(true)
    })()
    window.mulby?.onPluginInit?.((d: any) => {
      const paths = (d?.attachments??[]).map((a:any)=>a.path).filter((p:any)=>typeof p==='string'&&p&&isImage(p))
      if (paths.length) setFiles(p=>[...new Set([...p,...paths])])
    });
    (async () => {
      try { const r = await m.host.call('getPendingInit'); const p = (r?.data?.paths??[]) as string[]
        if (p.length) setFiles(prev=>[...new Set([...prev,...p])]) } catch {}
    })()
  }, [])

  // DnD
  useEffect(() => {
    const onDE=(e:DragEvent)=>{e.preventDefault();setDragOver(true)}
    const onDO=(e:DragEvent)=>{e.preventDefault()}
    const onDL=(e:DragEvent)=>{e.preventDefault();if(!e.relatedTarget||(e.relatedTarget as Node).nodeName==='HTML')setDragOver(false)}
    const onDr=async (e:DragEvent)=>{
      e.preventDefault(); setDragOver(false)

      // 1. Sync-collect all paths BEFORE any await
      let filePaths = collectPaths(e)

      // 2. Snapshot FileList before async boundary clears dataTransfer
      const staticFiles = Array.from(e.dataTransfer?.files || []) as File[]

      // 3. Try host API as fallback channel
      const pluginApi = window.mulby?.plugin
      if (pluginApi && staticFiles.length > 0) {
        try {
          const resolved = await pluginApi.resolveDroppedFilePaths(staticFiles as any)
          if (resolved && Array.isArray(resolved)) {
            filePaths = [...new Set([...filePaths, ...resolved])]
          }
        } catch {}
      }

      filePaths = filePaths.filter(isImage)
      if (filePaths.length) setFiles(prev => [...new Set([...prev, ...filePaths])])
    }
    window.addEventListener('dragenter',onDE); window.addEventListener('dragover',onDO)
    window.addEventListener('dragleave',onDL); window.addEventListener('drop',onDr)
    return ()=>{window.removeEventListener('dragenter',onDE); window.removeEventListener('dragover',onDO); window.removeEventListener('dragleave',onDL); window.removeEventListener('drop',onDr)}
  }, [])

  const update = useCallback((p:Partial<CompressSettings>)=>{
    setSettings(s=>{const n={...s,...p};m.host.call('saveSettings',n).catch(()=>{});return n})
  },[m])

  const pickFiles = useCallback(async ()=>{
    try { const r = await m.dialog.showOpenDialog({title:'选择图片',filters:[{name:'图片',extensions:['jpg','jpeg','png','webp','gif','avif','bmp','svg','ico']}],properties:['openFile','multiSelections']})
      if (r?.length) setFiles(p=>[...new Set([...p,...r])]) } catch {}
  },[m])

  const pickDir = useCallback(async ()=>{
    try { const r = await m.dialog.showOpenDialog({title:'选择输出目录',properties:['openDirectory']})
      if (r?.length) update({outputDir:r[0],outputMode:'otherDir'}) } catch {}
  },[m,update])

  const remove = useCallback((p:string)=>{setFiles(f=>f.filter(x=>x!==p))},[])

  const compress = useCallback(async()=>{
    if(!files.length||busy)return;setBusy(true);setErrors([]);setProgress({current:0,total:files.length});setStaged([])
    const as:StagedItem[]=[];const ae:{file:string;message:string}[]=[]
    for(let i=0;i<files.length;i+=4){const c=files.slice(i,i+4)
      try{const r=await m.host.call('compress',{files:c,settings});const d=r?.data as any
        if(d?.staged)as.push(...d.staged);if(d?.errors)ae.push(...d.errors)}
      catch(e:any){c.forEach(f=>ae.push({file:f,message:e?.message??String(e)}))}
      setProgress({current:Math.min(i+4,files.length),total:files.length});setStaged([...as]);setErrors([...ae])
    }
    setBusy(false)
  },[files,settings,busy,m])

  const commit = useCallback(async()=>{
    if(!staged.length)return;setBusy(true)
    try{const r=await m.host.call('commit',{mode:settings.outputMode,otherDir:settings.outputDir,suffix:settings.suffix,items:staged})
      const d=r?.data as any;const w=(d?.written??[])as string[];const e=(d?.errors??[])as {file:string;message:string}[]
      if(w.length)m.notification.show(`已保存 ${w.length} 个文件`,'success')
      if(e.length)e.forEach(x=>m.notification.show(`${x.file}`,'error'))
      const ws=new Set(staged.filter(s=>w.some(wx=>wx.includes)).map(s=>s.sourcePath))
      setStaged([]);setFiles(p=>p.filter(f=>!ws.has(f)));setErrors([])
    }catch(e:any){m.notification.show(`保存失败: ${e?.message??String(e)}`,'error')}
    setBusy(false)
  },[staged,settings,m])

  const discard = useCallback(async()=>{
    if(!staged.length)return
    try{await m.host.call('discard',{items:staged})}catch{}
    setStaged([]);setErrors([])
  },[staged,m])

  const tb=staged.reduce((s,i)=>s+i.beforeSize,0)
  const ta=staged.reduce((s,i)=>s+i.afterSize,0)
  const sp=tb>0?Math.round((1-ta/tb)*100):0

  const s = (k: string) => `var(--${k})`

  return (
    <div style={{display:'flex',flexDirection:'column',height:'100vh',background:s('bg'),color:s('text'),overflow:'hidden'}}>

      {/* HEADER */}
      <header style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'12px 20px',borderBottom:`1px solid ${s('border')}`,background:s('bg-elevated'),flexShrink:0}}>
        <div style={{display:'flex',alignItems:'center',gap:10}}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={s('accent')} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/>
          </svg>
          <div>
            <h1 style={{fontSize:14,fontWeight:600,color:s('text'),lineHeight:1.2}}>批量图片压缩</h1>
            <span style={{fontSize:11,color:s('text-tertiary')}}>本地 · 快速 · 隐私安全</span>
          </div>
          {files.length>0&&(
            <span style={{fontSize:11,fontWeight:500,color:s('accent'),background:s('accent-soft'),padding:'2px 8px',borderRadius:99}}>
              {files.length} 个文件
            </span>
          )}
        </div>
        {staged.length>0&&(
          <div style={{display:'flex',alignItems:'center',gap:12,fontSize:13}}>
            <span style={{color:s('text-secondary')}}>{fmt(tb)}</span>
            <span style={{color:s('text-tertiary')}}>→</span>
            <span style={{color:ta<tb?s('success'):s('text'),fontWeight:500}}>{fmt(ta)}</span>
            <span style={{fontSize:11,fontWeight:600,padding:'2px 8px',borderRadius:99,
              color:sp>0?s('success'):s('warning'),
              background:sp>0?s('success-soft'):s('warning-soft')}}>
              {sp>0?`${sp}%`:'—'}
            </span>
          </div>
        )}
      </header>

      {/* MAIN */}
      <div style={{flex:1,display:'flex',overflow:'hidden'}}>
        {/* Left: File list — fills space, each row shows inline compression */}
        <div style={{flex:1,display:'flex',flexDirection:'column',background:s('bg-elevated'),minWidth:0}}>
          <FileList files={files} staged={staged} dragOver={dragOver}
            onPickFiles={pickFiles} onRemoveFile={remove}/>
          <ProgressBar busy={busy} current={progress.current} total={progress.total}
            stagedCount={staged.length} errors={errors} savingPercent={sp}
            totalBefore={tb} totalAfter={ta}/>
        </div>

        {/* Right sidebar: Settings only */}
        <div style={{width:250,flexShrink:0,display:'flex',flexDirection:'column',borderLeft:`1px solid ${s('border')}`,background:s('bg-elevated')}}>
          <SettingsPanel settings={settings} loaded={loaded} onUpdate={update} onPickOutputDir={pickDir}/>
        </div>
      </div>

      {/* FOOTER */}
      <footer style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'10px 20px',borderTop:`1px solid ${s('border')}`,background:s('bg-elevated'),flexShrink:0}}>
        <div>{errors.length>0&&<span style={{fontSize:12,color:s('danger')}}>{errors.length} 个错误</span>}</div>
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          {staged.length>0&&(<>
            <button onClick={discard} disabled={busy} className="btn btn-secondary">放弃</button>
            <button onClick={commit} disabled={busy} className="btn btn-primary">保存</button>
          </>)}
          <button onClick={compress} disabled={!files.length||busy} className="btn btn-primary">
            {busy?'压缩中…':'压缩'}
          </button>
        </div>
      </footer>
    </div>
  )
}
