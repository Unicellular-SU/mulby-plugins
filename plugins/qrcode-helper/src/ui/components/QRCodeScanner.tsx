import React, { useState, useEffect, useCallback, useRef } from 'react'
import jsQR from 'jsqr'
import { useMulby } from '../hooks/useMulby'

interface InputAttachment {
    id: string
    name: string
    size: number
    kind: 'file' | 'image'
    mime?: string
    ext?: string
    path?: string
    dataUrl?: string
}

interface QRCodeScannerProps {
    initialAttachment?: InputAttachment | null
}

export const QRCodeScanner: React.FC<QRCodeScannerProps> = ({ initialAttachment }) => {
    const [result, setResult] = useState('')
    const [error, setError] = useState('')
    const { clipboard, notification, filesystem } = useMulby()
    const lastAttachmentId = useRef<string | null>(null)

    const scanImage = useCallback((imageData: ImageData) => {
        const code = jsQR(imageData.data, imageData.width, imageData.height)
        if (code) {
            setResult(code.data)
            setError('')
            notification.show('识别成功', 'success')
        } else {
            setError('未能识别二维码')
            notification.show('未发现二维码', 'warning')
        }
    }, [notification])

    const processFile = useCallback((file: File) => {
        if (!file.type.startsWith('image/')) {
            setError('请提供图片文件')
            return
        }

        const reader = new FileReader()
        reader.onload = (e) => {
            const img = new Image()
            img.onload = () => {
                const canvas = document.createElement('canvas')
                const context = canvas.getContext('2d')
                if (!context) return

                canvas.width = img.width
                canvas.height = img.height
                context.drawImage(img, 0, 0)
                const imageData = context.getImageData(0, 0, canvas.width, canvas.height)
                scanImage(imageData)
            }
            img.src = e.target?.result as string
        }
        reader.readAsDataURL(file)
    }, [scanImage])

    const processDataUrl = useCallback((dataUrl: string) => {
        const img = new Image()
        img.onload = () => {
            const canvas = document.createElement('canvas')
            const context = canvas.getContext('2d')
            if (!context) return

            canvas.width = img.width
            canvas.height = img.height
            context.drawImage(img, 0, 0)
            const imageData = context.getImageData(0, 0, canvas.width, canvas.height)
            scanImage(imageData)
        }
        img.src = dataUrl
    }, [scanImage])

    useEffect(() => {
        const loadAttachment = async () => {
            if (!initialAttachment || initialAttachment.kind !== 'image') return
            if (lastAttachmentId.current === initialAttachment.id) return
            lastAttachmentId.current = initialAttachment.id

            if (initialAttachment.dataUrl) {
                processDataUrl(initialAttachment.dataUrl)
                return
            }

            if (initialAttachment.path) {
                const base64 = await filesystem.readFile(initialAttachment.path, 'base64')
                if (typeof base64 !== 'string' || base64.length === 0) {
                    setError('无法读取图片内容')
                    return
                }
                const mime = initialAttachment.mime || 'image/png'
                processDataUrl(`data:${mime};base64,${base64}`)
            }
        }

        void loadAttachment()
    }, [initialAttachment, filesystem, processDataUrl])

    // 监听粘贴事件
    useEffect(() => {
        const handlePaste = (e: ClipboardEvent) => {
            const items = e.clipboardData?.items
            if (!items) return

            for (let i = 0; i < items.length; i++) {
                if (items[i].type.indexOf('image') !== -1) {
                    const blob = items[i].getAsFile()
                    if (blob) processFile(blob)
                    return
                }
            }
        }

        window.addEventListener('paste', handlePaste)
        return () => window.removeEventListener('paste', handlePaste)
    }, [processFile])

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            processFile(e.dataTransfer.files[0])
            e.dataTransfer.clearData()
        }
    }

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
    }

    const handleCopyResult = async () => {
        if (!result) return
        await clipboard.writeText(result)
        notification.show('结果已复制', 'success')
    }

    return (
        <div className="full-height flex-col">
            {!result ? (
                <div
                    className="drop-zone flex-1 center-content"
                    onDrop={handleDrop}
                    onDragOver={handleDragOver}
                >
                    <div className="placeholder-text">
                        <p>点击粘贴或拖拽图片到此处</p>
                        <p className="sub-text">支持 Ctrl+V 粘贴二维码图片</p>
                    </div>
                    {error && <p className="error-text mt-2">{error}</p>}
                </div>
            ) : (
                <div className="result-container flex-1 flex-col">
                    <div className="section-card flex-1">
                        <label>识别结果</label>
                        <textarea
                            className="result-area"
                            value={result}
                            readOnly
                        />
                    </div>
                    <div className="actions-row mt-4">
                        <button className="btn-primary" onClick={handleCopyResult}>复制文本</button>
                        <button className="btn-secondary" onClick={() => { setResult(''); setError('') }}>重新识别</button>
                    </div>
                </div>
            )}
        </div>
    )
}
