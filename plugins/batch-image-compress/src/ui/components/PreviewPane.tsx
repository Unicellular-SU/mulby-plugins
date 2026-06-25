import { useState, useEffect } from 'react'
import type { StagedItem } from '../../pipeline/types'

const fmt = (n: number): string => {
  if (n === 0) return '0 B'
  if (n < 1024) return `${n} B`
  if (n < 1024*1024) return `${(n/1024).toFixed(1)} KB`
  return `${(n/(1024*1024)).toFixed(2)} MB`
}
const fn = (p: string) => p.split(/[/\\]/).pop() ?? p

interface Props {
  selectedPath: string | null; staged: StagedItem[]
  host: { call: (m: string, ...a: unknown[]) => Promise<{ data: any }> }
}

export default function PreviewPane({ selectedPath, staged, host }: Props) {
  const [src, setSrc] = useState<string|null>(null)
  const [out, setOut] = useState<string|null>(null)
  const si = selectedPath ? staged.find(s=>s.sourcePath===selectedPath) : null
  const sv = (k: string) => `var(--${k})`

  useEffect(() => {
    if (!si) { setSrc(null); setOut(null); return }
    let c = false;
    (async () => {
      try {
        const [r1,r2] = await Promise.all([host.call('previewFile',si.sourcePath),host.call('previewFile',si.tempPath)])
        if (c) return
        const d1=r1?.data, d2=r2?.data
        if (d1&&!d1.error) setSrc(`data:${d1.mimeType};base64,${d1.data}`)
        if (d2&&!d2.error) setOut(`data:${d2.mimeType};base64,${d2.data}`)
      } catch {}
    })()
    return () => { c = true }
  }, [selectedPath, si?.tempPath])

  if (!si) {
    return (
      <div style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center',color:sv('text-tertiary'),fontSize:12,textAlign:'center',padding:12}}>
        选择文件后点击压缩<br/>预览效果
      </div>
    )
  }

  const pct = Math.round((1-si.afterSize/si.beforeSize)*100)
  const saved = Math.max(0,si.beforeSize-si.afterSize)

  return (
    <div style={{flex:1,display:'flex',flexDirection:'column',padding:'0 12px 8px',minHeight:0,overflow:'hidden'}}>
      {/* divider */}
      <div style={{borderTop:`1px solid ${sv('border')}`,marginBottom:8}}/>

      {/* label */}
      <div style={{fontSize:11,fontWeight:600,color:sv('text-secondary'),marginBottom:4,display:'flex',alignItems:'center',justifyContent:'space-between'}}>
        <span style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{fn(si.sourcePath)}</span>
      </div>

      {/* before → after stacked */}
      <div style={{display:'flex',flexDirection:'column',gap:6,flex:1,minHeight:0,overflow:'hidden'}}>
        {/* Original */}
        <div style={{flex:1,minHeight:0,display:'flex',flexDirection:'column'}}>
          <div style={{fontSize:10,color:sv('text-tertiary'),marginBottom:2,display:'flex',justifyContent:'space-between'}}>
            <span>原图</span><span>{fmt(si.beforeSize)} · {si.beforeWidth}×{si.beforeHeight}</span>
          </div>
          <div style={{flex:1,borderRadius:6,overflow:'hidden',background:sv('bg'),border:`1px solid ${sv('border')}`,display:'flex',alignItems:'center',justifyContent:'center',minHeight:0}}>
            {src ? <img src={src} style={{maxWidth:'100%',maxHeight:'100%',objectFit:'contain'}}/> : <span style={{fontSize:10,color:sv('text-tertiary')}}>加载中…</span>}
          </div>
        </div>

        {/* Arrow */}
        <div style={{textAlign:'center',fontSize:10,color:sv('text-tertiary'),lineHeight:1}}>↓</div>

        {/* Compressed */}
        <div style={{flex:1,minHeight:0,display:'flex',flexDirection:'column'}}>
          <div style={{fontSize:10,color:sv('text-tertiary'),marginBottom:2,display:'flex',justifyContent:'space-between'}}>
            <span style={{color:pct>0?sv('success'):sv('text-tertiary')}}>压缩后</span>
            <span>{fmt(si.afterSize)} · {si.afterWidth}×{si.afterHeight}</span>
          </div>
          <div style={{flex:1,borderRadius:6,overflow:'hidden',background:sv('bg'),border:`1px solid ${pct>0?sv('success'):sv('border')}`,display:'flex',alignItems:'center',justifyContent:'center',minHeight:0}}>
            {out ? <img src={out} style={{maxWidth:'100%',maxHeight:'100%',objectFit:'contain'}}/> : <span style={{fontSize:10,color:sv('text-tertiary')}}>加载中…</span>}
          </div>
        </div>
      </div>

      {/* stats */}
      <div style={{display:'flex',alignItems:'center',gap:8,marginTop:6,fontSize:10}}>
        <span style={{color:sv('text-tertiary')}}>压缩率 <b style={{color:pct>0?sv('success'):sv('warning'),fontWeight:600}}>{pct>0?pct:0}%</b></span>
        <span style={{color:sv('text-tertiary')}}>节省 <b style={{color:sv('text'),fontWeight:500}}>{fmt(saved)}</b></span>
        <span style={{color:sv('text-tertiary'),textTransform:'uppercase'}}>{si.format}</span>
      </div>
    </div>
  )
}
