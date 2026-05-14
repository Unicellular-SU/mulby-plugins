import { useState } from 'react'
import { Bug, FileText, Image, Inbox, Paperclip, PackageOpen } from 'lucide-react'
import { PageHeader, Card, Button, CodeBlock } from '../../components'

interface Attachment {
    id: string
    name: string
    size: number
    kind: 'file' | 'image'
    mime?: string
    ext?: string
    path?: string
    dataUrl?: string
}

interface Props {
    attachments?: Attachment[]
}

export function AttachmentsModule({ attachments = [] }: Props) {
    const [list, setList] = useState<Attachment[]>(attachments)

    const formatSize = (bytes: number) => {
        if (bytes < 1024) return `${bytes} B`
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
        return `${(bytes / 1024 / 1024).toFixed(1)} MB`
    }

    const handleClear = () => {
        setList([])
    }

    return (
        <div className="main-content">
            <PageHeader
                title="附件展示"
                icon={Paperclip}
                description="展示从搜索框传递的附件数据"
                actions={
                    list.length > 0 && <Button variant="secondary" onClick={handleClear}>清空列表</Button>
                }
            />

            <div className="page-content">
                <Card title="接收到的附件" icon={PackageOpen}>
                    {list.length === 0 ? (
                        <div className="empty-state">
                            <Inbox className="empty-icon" aria-hidden="true" size={32} strokeWidth={1.8} />
                            <div>没有接收到附件</div>
                            <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginTop: '8px' }}>
                                试着拖拽文件到搜索框，然后输入 "attachments"
                            </div>
                        </div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            {list.map((item, index) => (
                                <div
                                    key={item.id || index}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        padding: '12px',
                                        borderRadius: '8px',
                                        background: 'var(--bg-tertiary)',
                                        gap: '12px'
                                    }}
                                >
                                    <div style={{ color: 'var(--text-secondary)' }}>
                                        {item.kind === 'image' ? (
                                            <Image className="inline-icon" aria-hidden="true" size={24} />
                                        ) : (
                                            <FileText className="inline-icon" aria-hidden="true" size={24} />
                                        )}
                                    </div>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ fontWeight: 500, marginBottom: '4px', truncate: true } as any}>
                                            {item.name}
                                        </div>
                                        <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', display: 'flex', gap: '8px' }}>
                                            <span>{formatSize(item.size)}</span>
                                            {item.mime && <span>{item.mime}</span>}
                                            {item.id && <span>ID: {item.id}</span>}
                                        </div>
                                        {item.path && (
                                            <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '4px', fontFamily: 'monospace' }}>
                                                {item.path}
                                            </div>
                                        )}
                                    </div>
                                    {item.kind === 'image' && (item.dataUrl || item.path) && (
                                        <div style={{
                                            width: '64px',
                                            height: '64px',
                                            borderRadius: '4px',
                                            overflow: 'hidden',
                                            background: '#00000020'
                                        }}>
                                            <img items-center
                                                src={item.dataUrl || `file://${item.path}`}
                                                alt={item.name}
                                                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                            />
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </Card>

                {list.length > 0 && (
                    <Card title="原始数据 (Debug)" icon={Bug}>
                        <CodeBlock>
                            {JSON.stringify(list, null, 2)}
                        </CodeBlock>
                    </Card>
                )}
            </div>
        </div>
    )
}
