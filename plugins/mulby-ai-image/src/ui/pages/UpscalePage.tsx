import { useState } from 'react'
import { Maximize, Download, Upload, Image as ImageIcon, Loader2 } from 'lucide-react'
import { useMulby } from '../hooks/useMulby'
import { convertToSupportedBuffer } from '../utils/image'

export default function UpscalePage({ selectedModel }: { selectedModel: string }) {
  const [isGenerating, setIsGenerating] = useState(false)
  const [resultImage, setResultImage] = useState<string | null>(null)
  const [sourceImage, setSourceImage] = useState<string | null>(null)
  const [attachmentId, setAttachmentId] = useState<string | null>(null)
  const mulby = useMulby('mulby-ai-image')
  const ai = mulby?.ai

  const handleFileChange = async (e: any) => {
    const file = e.target.files?.[0]
    if (!file) return
    const url = URL.createObjectURL(file)
    setSourceImage(url)
    
    try {
      const { buffer, mimeType } = await convertToSupportedBuffer(file)
      const result = await ai.attachments.upload({
        buffer,
        mimeType,
        purpose: 'vision'
      })
      setAttachmentId(result.attachmentId)
    } catch (err: any) {
      mulby?.notification?.show(`上传失败: ${err.message}`, 'error')
    }
  }

  const handleGenerate = async () => {
    if (!ai || !attachmentId) return
    setIsGenerating(true)
    setResultImage(null)
    
    try {
      const result = await ai.images.edit({
        model: selectedModel,
        imageAttachmentId: attachmentId,
        prompt: "Upscale this image to a much higher resolution, enhance the details, make it sharp and high-quality."
      })
      
      if (result && result.images && result.images[0]) {
        setResultImage(`data:image/png;base64,${result.images[0]}`)
        
        const historyRecord = {
          id: crypto.randomUUID(),
          type: 'upscale',
          prompt: '无损放大',
          model: selectedModel,
          createdAt: Date.now()
        }
        
        if (mulby.storage?.attachment) {
           const res = await fetch(`data:image/png;base64,${result.images[0]}`)
           const blob = await res.blob()
           const arrayBuffer = await blob.arrayBuffer()
           await mulby.storage.attachment.put(historyRecord.id, arrayBuffer, 'image/png')
        }
        
        const existingHistory = ((await mulby.storage?.get('image-history')) as any[]) || []
        await mulby.storage?.set('image-history', [historyRecord, ...existingHistory].slice(0, 100))
      }
    } catch (err: any) {
      mulby?.notification?.show(`处理失败: ${err.message}`, 'error')
    } finally {
      setIsGenerating(false)
    }
  }

  const handleDownload = () => {
    if (!resultImage) return
    const a = document.createElement('a')
    a.href = resultImage
    a.download = `upscale-${Date.now()}.png`
    a.click()
  }

  return (
    <div className="h-full flex flex-col p-8 gap-6 overflow-y-auto">
      <div className="glass-panel p-6 rounded-2xl flex flex-col gap-4 shrink-0">
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <Maximize className="text-indigo-600 dark:text-indigo-400" />
          无损放大
        </h2>
        
        <div className="flex flex-col gap-4">
          <div className="w-full h-32 bg-white/60 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800 border-dashed rounded-xl flex items-center justify-center relative overflow-hidden shrink-0 group">
            {sourceImage ? (
              <>
                <img src={sourceImage} className="w-full h-full object-contain" />
                <div className="absolute inset-0 bg-white/50 dark:bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                   <span className="text-slate-800 dark:text-white text-sm">更换图片</span>
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center gap-2 text-slate-500">
                <Upload size={24} />
                <span className="text-sm">点击上传需要放大的图片</span>
              </div>
            )}
            <input type="file" accept="image/*" onChange={handleFileChange} className="absolute inset-0 opacity-0 cursor-pointer" />
          </div>
          <div className="flex justify-end mt-2">
            <button 
              onClick={handleGenerate}
              disabled={isGenerating || !attachmentId || !selectedModel}
              className="btn-primary px-8 py-2.5 shadow-md"
            >
              {isGenerating ? <Loader2 className="animate-spin" /> : <Maximize size={18} />}
              {isGenerating ? '处理中...' : '开始放大'}
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 glass-panel rounded-2xl p-6 flex flex-col min-h-[400px]">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-medium text-slate-800 dark:text-slate-300">处理结果</h3>
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
              <p className="animate-pulse">AI 正在增强画质中...</p>
            </div>
          ) : resultImage ? (
            <img src={resultImage} alt="Generated" className="max-w-full max-h-full object-contain" />
          ) : (
            <div className="flex flex-col items-center gap-3 text-slate-400 dark:text-slate-600">
              <ImageIcon size={48} strokeWidth={1} />
              <p>上传图片自动无损放大</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
