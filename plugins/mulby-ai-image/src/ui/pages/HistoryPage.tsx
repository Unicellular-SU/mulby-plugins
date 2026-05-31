import { useState, useEffect } from 'react'
import { Trash2, Download, Image as ImageIcon } from 'lucide-react'
import { useMulby } from '../hooks/useMulby'

function HistoryImage({ id, mulby }: { id: string, mulby: any }) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let url = '';
    if (mulby?.storage?.attachment) {
      mulby.storage.attachment.get(id).then((data: any) => {
        if (!active || !data) return;
        const blob = new Blob([data as any], { type: 'image/png' });
        url = URL.createObjectURL(blob);
        setSrc(url);
      }).catch(console.error);
    }
    return () => { 
      active = false; 
      if (url) URL.revokeObjectURL(url);
    };
  }, [id, mulby]);

  if (!src) return <span className="text-slate-400 dark:text-slate-600 text-sm text-center px-4 break-words">加载中...</span>;
  return <img src={src} className="w-full h-full object-cover" />;
}

export default function HistoryPage() {
  const [history, setHistory] = useState<any[]>([])
  const mulby = useMulby('mulby-ai-image')

  const loadHistory = async () => {
    if (mulby?.storage) {
      const hist = await mulby.storage.get('image-history')
      if (hist) setHistory(hist as any[])
    }
  }

  useEffect(() => {
    loadHistory()
  }, [])

  const handleDelete = async (id: string) => {
    if (!mulby?.storage) return
    const newHistory = history.filter(h => h.id !== id)
    await mulby.storage.set('image-history', newHistory)
    setHistory(newHistory)
    if (mulby.storage.attachment) {
      await mulby.storage.attachment.remove(id).catch(console.error)
    }
  }

  const handleDownload = async (id: string) => {
    if (!mulby?.storage?.attachment) return
    try {
      const data = await mulby.storage.attachment.get(id)
      if (data) {
        const blob = new Blob([data as any], { type: 'image/png' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `history-${id}.png`
        a.click()
        URL.revokeObjectURL(url)
      }
    } catch (e) {
      console.error(e)
    }
  }

  return (
    <div className="h-full flex flex-col p-8 gap-6 overflow-y-auto">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-semibold">历史记录</h2>
      </div>

      {history.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-slate-500">
          <ImageIcon size={48} className="mb-4 opacity-50" />
          <p>暂无历史记录</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {history.map((item) => (
            <div key={item.id} className="glass-panel rounded-xl overflow-hidden flex flex-col group">
              <div className="aspect-square bg-white/50 dark:bg-slate-900/50 checkerboard-bg relative flex items-center justify-center">
                <HistoryImage id={item.id} mulby={mulby} />
              </div>
              <div className="p-4 flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="px-2 py-1 bg-indigo-500/10 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300 text-xs rounded-md">
                    {item.type === 'generate' ? '生图' : item.type === 'edit' ? '修图' : item.type === 'remove-bg' ? '去背景' : item.type === 'upscale' ? '放大' : item.type}
                  </span>
                  <span className="text-xs text-slate-500">
                    {new Date(item.createdAt).toLocaleDateString()}
                  </span>
                </div>
                <p className="text-sm text-slate-800 dark:text-slate-300 line-clamp-2" title={item.prompt}>
                  {item.prompt || '无描述'}
                </p>
                <div className="flex items-center gap-2 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button 
                    onClick={() => handleDownload(item.id)}
                    className="flex-1 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg text-sm flex items-center justify-center gap-1 transition-colors"
                  >
                    <Download size={14} /> 下载
                  </button>
                  <button 
                    onClick={() => handleDelete(item.id)}
                    className="p-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg transition-colors"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
