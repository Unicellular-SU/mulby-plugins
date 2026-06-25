import type { StagedItem } from '../../pipeline/types'

const fn = (p: string) => p.split(/[/\\]/).pop() ?? p
const fmt = (n: number): string => {
  if (n === 0) return '0 B'
  if (n < 1024) return `${n} B`
  if (n < 1024*1024) return `${(n/1024).toFixed(1)} KB`
  return `${(n/(1024*1024)).toFixed(2)} MB`
}

interface Props {
  files: string[]; staged: StagedItem[]
  dragOver: boolean
  onPickFiles: () => void; onRemoveFile: (p: string) => void
}

export default function FileList({ files, staged, dragOver, onPickFiles, onRemoveFile }: Props) {
  const map = new Map(staged.map(s => [s.sourcePath, s]))
  const sv = (k: string) => `var(--${k})`

  if (!files.length) {
    return (
      <div style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center',padding:24}}>
        <div className={`${dragOver?'drop-zone-active':''}`}
             style={{width:'100%',height:'100%',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',
               borderRadius:`var(--radius-lg)`,border:`2px dashed ${dragOver?sv('accent'):sv('border')}`,
               background:dragOver?sv('accent-soft'):'transparent',transition:'all .2s ease',gap:12}}>
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none"
               stroke={dragOver?sv('accent'):sv('text-tertiary')} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"/>
          </svg>
          <div style={{textAlign:'center'}}>
            <p style={{fontSize:13,fontWeight:500,color:sv('text')}}>拖放图片到此处</p>
            <p style={{fontSize:11,color:sv('text-tertiary'),marginTop:2}}>支持 JPG · PNG · WebP · GIF · SVG</p>
          </div>
          <button onClick={onPickFiles} className="btn btn-primary" style={{marginTop:4}}>选择图片</button>
        </div>
      </div>
    )
  }

  return (
    <div style={{flex:1,display:'flex',flexDirection:'column',minHeight:0}}>
      {/* toolbar */}
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'8px 16px',borderBottom:`1px solid ${sv('border')}`,fontSize:12}}>
        <span style={{fontWeight:500,color:sv('text-secondary')}}>{files.length} 个文件</span>
        <button onClick={onPickFiles} style={{fontSize:12,fontWeight:500,color:sv('accent'),background:'none',border:'none',cursor:'pointer'}}>添加</button>
      </div>
      {/* list */}
      <ul style={{flex:1,overflowY:'auto',listStyle:'none'}}>
        {files.map(fp => {
          const item = map.get(fp)
          const pct = item ? Math.round((1-item.afterSize/item.beforeSize)*100) : 0
          return (
            <li key={fp}
                style={{cursor:'default',borderBottom:`1px solid ${sv('border')}`,transition:'background .1s ease'}}>

              {/* Main row */}
              <div style={{display:'flex',alignItems:'center',gap:8,padding:'8px 16px'}}>
                <div style={{width:32,height:32,flexShrink:0,borderRadius:6,background:sv('bg'),display:'flex',alignItems:'center',justifyContent:'center',overflow:'hidden'}}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={sv('text-tertiary')} strokeWidth="1.5">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>
                  </svg>
                </div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:12,fontWeight:500,color:sv('text'),overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={fp}>{fn(fp)}</div>
                  <div style={{fontSize:11,color:sv('text-tertiary'),marginTop:1}}>
                    {item ? `${fmt(item.beforeSize)} → ${fmt(item.afterSize)}` : fmt(0)}
                    {item?.keptOriginal ? ' · 已最优' : ''}
                  </div>
                </div>
                <button onClick={e=>{e.stopPropagation();onRemoveFile(fp)}}
                        style={{flexShrink:0,width:22,height:22,display:'flex',alignItems:'center',justifyContent:'center',background:'none',border:'none',borderRadius:4,cursor:'pointer',color:sv('text-tertiary'),fontSize:15,lineHeight:1}}
                        onMouseEnter={e=>{e.currentTarget.style.background=sv('danger-soft');e.currentTarget.style.color=sv('danger')}}
                        onMouseLeave={e=>{e.currentTarget.style.background='none';e.currentTarget.style.color=sv('text-tertiary')}}>
                  ×
                </button>
              </div>

              {/* Inline compression bar — only when compressed */}
              {item && (
                <div style={{padding:'0 16px 8px',display:'flex',alignItems:'center',gap:8}}>
                  {/* compact bar */}
                  <div style={{flex:1,height:6,borderRadius:99,background:sv('border'),overflow:'hidden',display:'flex'}}>
                    {/* after portion (colored) */}
                    <div style={{height:'100%',borderRadius:99,
                      background:item.afterSize<item.beforeSize?sv('success'):sv('warning'),
                      width:`${item.afterSize/Math.max(item.beforeSize,1)*100}%`,
                      transition:'width .4s ease'}}/>
                    {/* saved portion (lighter accent) */}
                    {item.afterSize < item.beforeSize && (
                      <div style={{height:'100%',
                        background:sv('success-soft'),
                        flex:1}}/>
                    )}
                  </div>
                  {/* badge */}
                  <span style={{fontSize:11,fontWeight:600,flexShrink:0,padding:'1px 6px',borderRadius:4,minWidth:36,textAlign:'center',
                    color:pct>0?sv('success'):sv('warning'),
                    background:pct>0?sv('success-soft'):sv('warning-soft')}}>
                    {pct>0?`${pct}%`:'—'}
                  </span>
                  {/* dimensions */}
                  <span style={{fontSize:10,color:sv('text-tertiary'),flexShrink:0,textAlign:'right',minWidth:52}}>
                    {item.afterWidth}×{item.afterHeight}
                  </span>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
