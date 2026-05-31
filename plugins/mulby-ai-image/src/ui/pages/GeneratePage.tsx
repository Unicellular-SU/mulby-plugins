import { useState } from 'react'
import { Sparkles, Download, Image as ImageIcon, Loader2 } from 'lucide-react'
import { useMulby } from '../hooks/useMulby'

export default function GeneratePage({ selectedModel }: { selectedModel: string }) {
  const [prompt, setPrompt] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [resultImage, setResultImage] = useState<string | null>(null)

  const mulby = useMulby('mulby-ai-image')
  const ai = mulby?.ai

  const handleGenerate = async () => {
    if (!prompt.trim() || !ai) return
    setIsGenerating(true)
    setResultImage(null)
    
    try {
      const result = await ai.images.generate({
        model: selectedModel,
        prompt: prompt
      })
      
      // result should contain base64 image data
      if (result && result.images && result.images[0]) {
        setResultImage(`data:image/png;base64,${result.images[0]}`)
        
        // Save to history using Mulby Storage API
        const historyRecord = {
          id: crypto.randomUUID(),
          type: 'generate',
          prompt,
          model: selectedModel,
          createdAt: Date.now()
        }
        
        // Save attachment
        if (mulby.storage?.attachment) {
           // convert base64 to buffer
           const res = await fetch(`data:image/png;base64,${result.images[0]}`)
           const blob = await res.blob()
           const arrayBuffer = await blob.arrayBuffer()
           await mulby.storage.attachment.put(historyRecord.id, arrayBuffer, 'image/png')
        }
        
        // Save metadata
        const existingHistory = ((await mulby.storage?.get('image-history')) as any[]) || []
        await mulby.storage?.set('image-history', [historyRecord, ...existingHistory].slice(0, 100))
      }
    } catch (err: any) {
      mulby?.notification?.show(`生成失败: ${err.message}`, 'error')
    } finally {
      setIsGenerating(false)
    }
  }

  const handleDownload = () => {
    if (!resultImage) return
    const a = document.createElement('a')
    a.href = resultImage
    a.download = `ai-image-${Date.now()}.png`
    a.click()
  }

  return (
    <div className="h-full flex flex-col p-8 gap-6 overflow-y-auto">
      <div className="glass-panel p-6 rounded-2xl flex flex-col gap-4 shrink-0">
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <Sparkles className="text-indigo-600 dark:text-indigo-400" />
          文字生图
        </h2>
        
        <div className="flex flex-col gap-4">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="描述你想要生成的画面，越详细越好..."
            className="w-full h-32 bg-white/60 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800 rounded-xl p-4 text-slate-800 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 resize-none transition-all"
          />
          <div className="flex justify-end mt-2">
            <button 
              onClick={handleGenerate}
              disabled={isGenerating || !prompt.trim() || !selectedModel}
              className="btn-primary px-8 py-2.5 shadow-md"
            >
              {isGenerating ? <Loader2 className="animate-spin" /> : <Sparkles size={18} />}
              {isGenerating ? '生成中...' : '立即生成'}
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 glass-panel rounded-2xl p-6 flex flex-col min-h-[400px]">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-medium text-slate-800 dark:text-slate-300">生成结果</h3>
          {resultImage && (
            <button onClick={handleDownload} className="btn-secondary py-1.5 px-4 text-sm">
              <Download size={16} /> 下载
            </button>
          )}
        </div>
        
        <div className="flex-1 rounded-xl bg-white/60 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800/50 checkerboard-bg flex items-center justify-center overflow-hidden relative">
          {isGenerating ? (
            <div className="flex flex-col items-center gap-4 text-indigo-600 dark:text-indigo-400">
              <Loader2 size={40} className="animate-spin" />
              <p className="animate-pulse">AI 正在作画中...</p>
            </div>
          ) : resultImage ? (
            <img src={resultImage} alt="Generated" className="max-w-full max-h-full object-contain" />
          ) : (
            <div className="flex flex-col items-center gap-3 text-slate-400 dark:text-slate-600">
              <ImageIcon size={48} strokeWidth={1} />
              <p>在上方输入描述开始生成</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
