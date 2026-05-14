import React, { useEffect, useRef, useState } from 'react'
import { useMulby } from '../../hooks/useMulby'

export const ImageEditor: React.FC = () => {
    const { window: win } = useMulby()
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const [isDrawing, setIsDrawing] = useState(false)
    const [lastPos, setLastPos] = useState({ x: 0, y: 0 })
    const [imageLoaded, setImageLoaded] = useState(false)

    useEffect(() => {
        const channel = new BroadcastChannel('mulby-image-editor')

        channel.onmessage = (event) => {
            const { type, data } = event.data
            if (type === 'INIT_IMAGE') {
                const img = new Image()
                img.onload = () => {
                    const canvas = canvasRef.current
                    if (canvas) {
                        canvas.width = img.width
                        canvas.height = img.height

                        win.setSize(
                            Math.min(img.width + 40, screen.availWidth * 0.9),
                            Math.min(img.height + 100, screen.availHeight * 0.9)
                        )

                        const ctx = canvas.getContext('2d')
                        if (ctx) {
                            ctx.drawImage(img, 0, 0)
                            ctx.lineCap = 'round'
                            ctx.lineJoin = 'round'
                            ctx.strokeStyle = '#ff0000'
                            ctx.lineWidth = 5
                        }
                        setImageLoaded(true)
                    }
                }
                img.src = data
            }
        }

        // 通知主窗口已就绪
        setTimeout(() => channel.postMessage({ type: 'READY' }), 200)

        return () => channel.close()
    }, [win])

    const startDrawing = (e: React.MouseEvent) => {
        if (!canvasRef.current || !imageLoaded) return
        const rect = canvasRef.current.getBoundingClientRect()
        setIsDrawing(true)
        setLastPos({
            x: e.clientX - rect.left,
            y: e.clientY - rect.top
        })
    }

    const draw = (e: React.MouseEvent) => {
        if (!isDrawing || !canvasRef.current) return
        const ctx = canvasRef.current.getContext('2d')
        if (!ctx) return

        const rect = canvasRef.current.getBoundingClientRect()
        const x = e.clientX - rect.left
        const y = e.clientY - rect.top

        ctx.beginPath()
        ctx.moveTo(lastPos.x, lastPos.y)
        ctx.lineTo(x, y)
        ctx.stroke()

        setLastPos({ x, y })
    }

    const stopDrawing = () => {
        setIsDrawing(false)
    }

    const handleSave = async () => {
        if (!canvasRef.current) return

        // 获取 base64 发回主窗口
        const dataUrl = canvasRef.current.toDataURL('image/png')
        const channel = new BroadcastChannel('mulby-image-editor')
        channel.postMessage({ type: 'SAVE_IMAGE', data: dataUrl })
        channel.close()

        // 关闭窗口
        if (win?.close) {
            win.close()
        }
    }

    return (
        <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#222', color: '#fff' }}>
            <div style={{ padding: '10px', display: 'flex', gap: '10px', background: '#333' }}>
                <span style={{ alignSelf: 'center', fontSize: '14px', flex: 1 }}>图片编辑器 (画笔红色)</span>
                <button onClick={handleSave} style={{
                    padding: '6px 16px',
                    borderRadius: '4px',
                    border: 'none',
                    background: '#007AFF',
                    color: 'white',
                    cursor: 'pointer'
                }}>
                    确认并在主窗口使用
                </button>
            </div>
            <div style={{ flex: 1, overflow: 'auto', padding: '20px', display: 'flex', justifyContent: 'center' }}>
                <canvas
                    ref={canvasRef}
                    onMouseDown={startDrawing}
                    onMouseMove={draw}
                    onMouseUp={stopDrawing}
                    onMouseLeave={stopDrawing}
                    style={{ background: 'transparent', boxShadow: '0 0 20px rgba(0,0,0,0.5)' }}
                />
            </div>
        </div>
    )
}
