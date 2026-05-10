import { useState } from 'react'
import { BookOpen, ChevronLeft, ChevronRight, Code2, Database, ListChecks } from 'lucide-react'
import { CodeBlock } from './CodeBlock'

export interface ApiReferenceItem {
    name: string
    description: string
}

export interface ApiReferenceGroup {
    title: string
    items: ApiReferenceItem[]
}

export interface ApiExample {
    title: string
    code: string
}

interface ApiReferencePanelProps {
    apiGroups: ApiReferenceGroup[]
    examples: ApiExample[]
    rawData: unknown
    defaultCollapsed?: boolean
}

function stringifyRawData(rawData: unknown) {
    try {
        return JSON.stringify(rawData, null, 2)
    } catch {
        return String(rawData)
    }
}

export function ApiReferencePanel({
    apiGroups,
    examples,
    rawData,
    defaultCollapsed = false,
}: ApiReferencePanelProps) {
    const [collapsed, setCollapsed] = useState(defaultCollapsed)

    return (
        <aside className={`api-reference-panel ${collapsed ? 'is-collapsed' : ''}`}>
            <button
                className="api-panel-toggle"
                type="button"
                onClick={() => setCollapsed(value => !value)}
                aria-label={collapsed ? '展开 API 面板' : '折叠 API 面板'}
            >
                {collapsed ? (
                    <ChevronLeft aria-hidden="true" size={16} strokeWidth={2} />
                ) : (
                    <ChevronRight aria-hidden="true" size={16} strokeWidth={2} />
                )}
                <span>{collapsed ? 'API' : '收起'}</span>
            </button>

            {!collapsed && (
                <div className="api-panel-body">
                    <section className="api-panel-section">
                        <h3 className="api-panel-heading">
                            <ListChecks className="section-icon" aria-hidden="true" size={16} strokeWidth={2} />
                            <span>页面 API</span>
                        </h3>
                        <div className="api-group-list">
                            {apiGroups.map(group => (
                                <div className="api-group" key={group.title}>
                                    <div className="api-group-title">{group.title}</div>
                                    <div className="api-item-list">
                                        {group.items.map(item => (
                                            <div className="api-item" key={`${group.title}-${item.name}`}>
                                                <code>{item.name}</code>
                                                <span>{item.description}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </section>

                    <section className="api-panel-section">
                        <h3 className="api-panel-heading">
                            <Code2 className="section-icon" aria-hidden="true" size={16} strokeWidth={2} />
                            <span>API 示例</span>
                        </h3>
                        <div className="api-example-list">
                            {examples.map(example => (
                                <div className="api-example" key={example.title}>
                                    <div className="api-example-title">
                                        <BookOpen aria-hidden="true" size={14} strokeWidth={2} />
                                        <span>{example.title}</span>
                                    </div>
                                    <CodeBlock>{example.code}</CodeBlock>
                                </div>
                            ))}
                        </div>
                    </section>

                    <section className="api-panel-section">
                        <h3 className="api-panel-heading">
                            <Database className="section-icon" aria-hidden="true" size={16} strokeWidth={2} />
                            <span>原始数据</span>
                        </h3>
                        <CodeBlock>{stringifyRawData(rawData)}</CodeBlock>
                    </section>
                </div>
            )}
        </aside>
    )
}
