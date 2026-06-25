const fmt = (n: number): string => {
  if (n === 0) return '0 B'; if (n < 1024) return `${n} B`
  if (n < 1024*1024) return `${(n/1024).toFixed(1)} KB`; return `${(n/(1024*1024)).toFixed(2)} MB`
}

interface Props {
  busy: boolean; current: number; total: number; stagedCount: number
  errors: { file: string; message: string }[]
  savingPercent: number; totalBefore: number; totalAfter: number
}

export default function ProgressBar({ busy, current, total, stagedCount, errors, savingPercent, totalBefore, totalAfter }: Props) {
  const sv = (k: string) => `var(--${k})`
  if (!busy && !stagedCount && !errors.length) return null

  const pct = total>0 ? Math.round(current/total*100) : 0

  return (
    <div style={{padding:'10px 16px 14px',flexShrink:0}}>
      {/* bar */}
      {(busy||stagedCount>0) && (
        <div style={{marginBottom:8}}>
          {busy && (
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:4,fontSize:11}}>
              <span style={{color:sv('text-secondary')}}>压缩中 {current}/{total}</span>
              <span style={{color:sv('accent'),fontWeight:500}}>{pct}%</span>
            </div>
          )}
          <div style={{width:'100%',height:4,borderRadius:99,background:sv('border'),overflow:'hidden'}}>
            <div style={{height:'100%',borderRadius:99,transition:'width .4s ease',
              background:busy?`var(--accent)`:sv('success'),
              width:`${busy?pct:100}%`}}/>
          </div>
        </div>
      )}

      {/* summary */}
      {!busy && stagedCount>0 && (
        <div style={{display:'flex',alignItems:'center',gap:10,fontSize:11,
          padding:'6px 10px',borderRadius:`var(--radius)`,background:sv('accent-soft')}}>
          <span style={{color:sv('text-secondary')}}>{stagedCount} 个完成</span>
          <span style={{color:sv('text-tertiary')}}>{fmt(totalBefore)} → {fmt(totalAfter)}</span>
          <span style={{fontWeight:600,color:savingPercent>0?sv('success'):sv('warning')}}>
            {savingPercent>0?`节省 ${fmt(totalBefore-totalAfter)} (${savingPercent}%)`:'未减小'}
          </span>
        </div>
      )}

      {/* errors */}
      {errors.length>0 && (
        <div style={{marginTop:6,maxHeight:80,overflowY:'auto',padding:'6px 8px',borderRadius:`var(--radius)`,background:sv('danger-soft'),fontSize:11}}>
          {errors.map((e,i)=>(
            <div key={i} style={{color:sv('danger'),overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',lineHeight:1.6}} title={e.message}>
              {fn(e.file)}: {e.message}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function fn(p: string) { return p.split(/[/\\]/).pop()??p }
