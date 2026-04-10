import React, { useState, useRef, useEffect } from 'react'
import { QRCodeCanvas } from 'qrcode.react'
import { useMulby } from '../hooks/useMulby'

export const QRCodeGenerator: React.FC<{ initialValue?: string }> = ({ initialValue = '' }) => {
    const [text, setText] = useState(initialValue)
    const { clipboard, notification } = useMulby()
    const canvasRef = useRef<HTMLCanvasElement>(null)

    useEffect(() => {
        if (initialValue) setText(initialValue)
    }, [initialValue])

    const handleCopy = async () => {
        // 获取 canvas 元素 (qrcode.react渲染的是canvas)
        // QRCodeCanvas 实际上会渲染一个 canvas，我们需要获取它
        // canvasRef 直接绑定不到 QRCodeCanvas 内部的 canvas，需用 ref 获取 wrapper 或者直接 querySelector
        // 实际上 QRCodeCanvas 转发 ref 到 canvas，所以可以直接用 (v4+)

        // 注意: qrcode.react v3/v4 的 canvas ref 行为
        // 如果 ref 是 null，尝试直接查找
        const canvas = document.querySelector('canvas') as HTMLCanvasElement
        if (!canvas) {
            notification.show('生成二维码失败', 'error')
            return
        }

        try {
            const dataUrl = canvas.toDataURL('image/png')
            // mulby API 通常接受 DataURL
            await clipboard.writeImage(dataUrl)
            notification.show('二维码已复制到剪贴板', 'success')
        } catch (e) {
            console.error(e)
            notification.show('复制失败', 'error')
        }
    }

    const handleDownload = () => {
        const canvas = document.querySelector('canvas') as HTMLCanvasElement
        if (!canvas) return
        const link = document.createElement('a')
        link.download = 'qrcode.png'
        link.href = canvas.toDataURL('image/png')
        link.click()
    }

    return (
        <div className="full-height flex-col" style={{ gap: '16px' }}>
            <div className="section-card">
                <textarea
                    className="input-area"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder="请输入文字生成二维码..."
                    rows={4}
                />
            </div>

            {text && (
                <div className="section-card center-content flex-1">
                    <div className="qr-preview">
                        <QRCodeCanvas
                            value={text}
                            size={200}
                            level={'H'}
                            includeMargin={true}
                        // ref={canvasRef} // QRCodeCanvas ref handling needs verification, manual selection is safer for now if types mismatch
                        />
                    </div>
                    <div className="actions-row mt-4">
                        <button className="btn-primary" onClick={handleCopy}>
                            复制图片
                        </button>
                        <button className="btn-secondary" onClick={handleDownload}>
                            保存图片
                        </button>
                    </div>
                </div>
            )}
        </div>
    )
}
