import type { CompressSettings, OutputFormat } from '../../pipeline/types'

const FT: { v: OutputFormat|'original'; l: string }[] = [
  { v: 'original', l: '保持原格式' },
  { v: 'jpeg', l: 'JPEG' },
  { v: 'png', l: 'PNG' },
  { v: 'webp', l: 'WebP' },
]

interface Props {
  settings: CompressSettings; loaded: boolean
  onUpdate: (p: Partial<CompressSettings>) => void; onPickOutputDir: () => void
}

export default function SettingsPanel({ settings, loaded, onUpdate, onPickOutputDir }: Props) {
  const s = (k: string) => `var(--${k})`

  if (!loaded) return (
    <div style={{padding:'12px 16px',borderTop:`1px solid ${s('border')}`,fontSize:12,color:s('text-tertiary')}}>加载中…</div>
  )

  const lbl: React.CSSProperties = { fontSize:11, fontWeight:500, color:s('text-secondary'), marginBottom:4, display:'block' }

  return (
    <div style={{padding:'12px 16px',borderTop:`1px solid ${s('border')}`,overflowY:'auto',flexShrink:0,display:'flex',flexDirection:'column',gap:12}}>

      {/* Quality */}
      <div>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:2}}>
          <label style={lbl}>质量</label>
          <span style={{fontSize:12,fontWeight:600,color:s('accent')}}>{settings.quality}</span>
        </div>
        <input type="range" min={1} max={100} value={settings.quality}
               onChange={e=>onUpdate({quality:Number(e.target.value)})}
               style={{width:'100%'}}/>
      </div>

      {/* Format */}
      <div>
        <label style={lbl}>格式</label>
        <select className="select" value={settings.format}
                onChange={e=>onUpdate({format:e.target.value as OutputFormat|'original'})}>
          {FT.map(f=><option key={f.v} value={f.v}>{f.l}</option>)}
        </select>
      </div>

      {/* Resize */}
      <div>
        <label style={lbl}>尺寸限制（可选）</label>
        <div style={{display:'flex',alignItems:'center',gap:6}}>
          <input className="input" type="number" placeholder="宽"
                 value={settings.maxWidth??''}
                 onChange={e=>onUpdate({maxWidth:e.target.value?Number(e.target.value):undefined})}/>
          <span style={{fontSize:12,color:s('text-tertiary')}}>×</span>
          <input className="input" type="number" placeholder="高"
                 value={settings.maxHeight??''}
                 onChange={e=>onUpdate({maxHeight:e.target.value?Number(e.target.value):undefined})}/>
        </div>
      </div>

      {/* Suffix */}
      <div>
        <label style={lbl}>文件名后缀</label>
        <input className="input" type="text" value={settings.suffix}
               onChange={e=>onUpdate({suffix:e.target.value||'_compressed'})}/>
      </div>

      {/* Output Mode */}
      <div>
        <label style={lbl}>输出位置</label>
        <div style={{display:'flex',flexDirection:'column',gap:4}}>
          {(['overwrite','sameDir','otherDir'] as const).map(mode=>{
            const labels = { overwrite: '覆盖原文件', sameDir: '同目录（加后缀）', otherDir: '自定义目录' }
            const active = settings.outputMode === mode
            return (
              <label key={mode} style={{display:'flex',alignItems:'center',gap:6,fontSize:12,color:s('text'),cursor:'pointer',padding:'3px 0'}}>
                <input type="radio" name="om" checked={active} onChange={()=>onUpdate({outputMode:mode})}
                       style={{accentColor:`var(--accent)`}}/>
                {labels[mode]}
              </label>
            )
          })}
        </div>
        {settings.outputMode==='otherDir'&&(
          <button onClick={onPickOutputDir} className="input"
                  style={{marginTop:6,textAlign:'left',cursor:'pointer',color:settings.outputDir?s('text'):s('text-tertiary')}}>
            {settings.outputDir||'点击选择目录…'}
          </button>
        )}
      </div>
    </div>
  )
}
