import { useEffect, useState } from 'react'
import { useMulby } from './hooks/useMulby'
import { CodeEditor } from './components/CodeEditor'
import { detectFormat, toJSON, fromJSON, formatJSON, compressJSON, type DataFormat } from './utils/formatConverter'
import {
  Sparkles,
  Minimize2,
  TreePine,
  FileText,
  FileCode,
  Copy,
  Trash2,
  Check,
  X,
  AlertCircle,
  FileJson
} from 'lucide-react'

interface PluginInitData {
  pluginName: string
  featureCode: string
  input: string
  mode?: string
  route?: string
}

type ViewMode = 'tree' | 'yaml' | 'xml'

interface JsonError {
  message: string
  line?: number
  column?: number
}

// 树形节点组件
function TreeNode({ data, path = 'root' }: { data: any; path?: string }) {
  const [collapsed, setCollapsed] = useState(false)

  if (data === null) {
    return <span className="json-null">null</span>
  }

  if (typeof data === 'boolean') {
    return <span className="json-boolean">{data.toString()}</span>
  }

  if (typeof data === 'number') {
    return <span className="json-number">{data}</span>
  }

  if (typeof data === 'string') {
    return <span className="json-string">"{data}"</span>
  }

  if (Array.isArray(data)) {
    if (data.length === 0) {
      return <span className="json-bracket">[]</span>
    }

    return (
      <div className="tree-node">
        <span className="tree-toggle" onClick={() => setCollapsed(!collapsed)}>
          {collapsed ? '▶' : '▼'}
        </span>
        <span className="json-bracket">[</span>
        <span className="json-meta"> {data.length} items</span>
        {!collapsed && (
          <div className="tree-children">
            {data.map((item, index) => (
              <div key={index} className="tree-item">
                <span className="json-key">{index}:</span>
                <TreeNode data={item} path={`${path}[${index}]`} />
              </div>
            ))}
          </div>
        )}
        <span className="json-bracket">]</span>
      </div>
    )
  }

  if (typeof data === 'object') {
    const keys = Object.keys(data)
    if (keys.length === 0) {
      return <span className="json-bracket">{'{}'}</span>
    }

    return (
      <div className="tree-node">
        <span className="tree-toggle" onClick={() => setCollapsed(!collapsed)}>
          {collapsed ? '▶' : '▼'}
        </span>
        <span className="json-bracket">{'{'}</span>
        <span className="json-meta"> {keys.length} keys</span>
        {!collapsed && (
          <div className="tree-children">
            {keys.map((key) => (
              <div key={key} className="tree-item">
                <span className="json-key">"{key}":</span>
                <TreeNode data={data[key]} path={`${path}.${key}`} />
              </div>
            ))}
          </div>
        )}
        <span className="json-bracket">{'}'}</span>
      </div>
    )
  }

  return <span>{String(data)}</span>
}

export default function App() {
  const [input, setInput] = useState('')
  const [parsedData, setParsedData] = useState<any>(null)
  const [error, setError] = useState<JsonError | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode | null>(null)
  const [filterExpr, setFilterExpr] = useState('')
  const [filteredData, setFilteredData] = useState<any>(null)
  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  const [inputFormat, setInputFormat] = useState<DataFormat>('json')
  const { clipboard, notification } = useMulby('json_editor')

  useEffect(() => {
    // 获取初始主题
    const params = new URLSearchParams(window.location.search)
    const initialTheme = (params.get('theme') as 'light' | 'dark') || 'light'
    setTheme(initialTheme)
    document.documentElement.classList.toggle('dark', initialTheme === 'dark')

    // 监听主题变化
    window.mulby?.onThemeChange?.((newTheme: 'light' | 'dark') => {
      setTheme(newTheme)
      document.documentElement.classList.toggle('dark', newTheme === 'dark')
    })

    // 接收插件初始化数据
    window.mulby?.onPluginInit?.((data: PluginInitData) => {
      if (data.input) {
        handleInputData(data.input)
      }
    })
  }, [])

  // 处理输入数据（自动检测格式并转换）
  const handleInputData = (inputData: string) => {
    console.log('原始输入数据:', inputData)
    console.log('输入数据长度:', inputData.length)
    console.log('包含换行符:', inputData.includes('\n'))

    const format = detectFormat(inputData)
    console.log('检测到的格式:', format)
    setInputFormat(format)

    if (format === 'json') {
      // JSON 格式：尝试格式化
      try {
        const jsonObj = JSON.parse(inputData)
        const formatted = JSON.stringify(jsonObj, null, 2)
        setInput(formatted)
      } catch (e) {
        // 如果解析失败，直接使用原始输入
        setInput(inputData)
      }
    } else if (format === 'yaml' || format === 'xml') {
      console.log('开始转换', format, '数据')
      try {
        const jsonObj = toJSON(inputData, format)
        console.log('转换后的对象:', jsonObj)
        const jsonStr = JSON.stringify(jsonObj, null, 2)
        console.log('格式化后的 JSON:', jsonStr)
        setInput(jsonStr)
        notification.show(`已从 ${format.toUpperCase()} 转换为 JSON`)
      } catch (e: any) {
        console.error('转换失败:', e)
        setInput(inputData)
        notification.show(`${format.toUpperCase()} 解析失败: ${e.message}`, 'error')
      }
    } else {
      console.log('未知格式，直接使用原始输入')
      setInput(inputData)
    }
  }

  // 解析和校验 JSON
  useEffect(() => {
    if (!input.trim()) {
      setParsedData(null)
      setError(null)
      setFilteredData(null)
      return
    }

    try {
      const parsed = JSON.parse(input)
      setParsedData(parsed)
      setError(null)
      setFilteredData(parsed)
    } catch (e: any) {
      setParsedData(null)
      setFilteredData(null)

      // 尝试提取错误位置
      const match = e.message.match(/position (\d+)/)
      if (match) {
        const position = parseInt(match[1])
        const lines = input.substring(0, position).split('\n')
        setError({
          message: e.message,
          line: lines.length,
          column: lines[lines.length - 1].length + 1
        })
      } else {
        setError({ message: e.message })
      }
    }
  }, [input])

  // 应用过滤表达式
  useEffect(() => {
    if (!parsedData || !filterExpr.trim()) {
      setFilteredData(parsedData)
      return
    }

    try {
      const func = new Function('data', `
        try {
          return ${filterExpr};
        } catch (e) {
          throw new Error('过滤表达式错误: ' + e.message);
        }
      `)
      const result = func(parsedData)
      setFilteredData(result)
    } catch (e: any) {
      notification.show('过滤表达式错误: ' + e.message, 'error')
      setFilteredData(parsedData)
    }
  }, [filterExpr, parsedData, notification])

  // 格式化 JSON
  const handleFormat = () => {
    if (!parsedData) {
      notification.show('请先输入有效的 JSON', 'warning')
      return
    }
    try {
      const formatted = formatJSON(input)
      setInput(formatted)
      notification.show('已格式化')
    } catch (e: any) {
      notification.show('格式化失败: ' + e.message, 'error')
    }
  }

  // 压缩 JSON
  const handleCompress = () => {
    if (!parsedData) {
      notification.show('请先输入有效的 JSON', 'warning')
      return
    }
    try {
      const compressed = compressJSON(input)
      setInput(compressed)
      notification.show('已压缩')
    } catch (e: any) {
      notification.show('压缩失败: ' + e.message, 'error')
    }
  }

  // 复制到剪贴板
  const handleCopy = async () => {
    let content = ''

    if (viewMode === null) {
      content = input
    } else if (viewMode === 'yaml') {
      content = getYamlOutput()
    } else if (viewMode === 'xml') {
      content = getXmlOutput()
    } else {
      content = input
    }

    await clipboard.writeText(content)
    notification.show('已复制到剪贴板')
  }

  // 复制 YAML
  const handleCopyYaml = async () => {
    if (!filteredData) {
      notification.show('请先输入有效的 JSON', 'warning')
      return
    }
    try {
      const yamlContent = fromJSON(filteredData, 'yaml')
      await clipboard.writeText(yamlContent)
      notification.show('已复制 YAML 到剪贴板')
    } catch (e: any) {
      notification.show('转换失败: ' + e.message, 'error')
    }
  }

  // 复制 XML
  const handleCopyXml = async () => {
    if (!filteredData) {
      notification.show('请先输入有效的 JSON', 'warning')
      return
    }
    try {
      const xmlContent = fromJSON(filteredData, 'xml')
      await clipboard.writeText(xmlContent)
      notification.show('已复制 XML 到剪贴板')
    } catch (e: any) {
      notification.show('转换失败: ' + e.message, 'error')
    }
  }

  // 清空
  const handleClear = () => {
    setInput('')
    setFilterExpr('')
    setViewMode(null)
  }

  // 获取 YAML 输出
  const getYamlOutput = () => {
    if (!filteredData) return ''
    try {
      return fromJSON(filteredData, 'yaml')
    } catch (e: any) {
      return '转换失败: ' + e.message
    }
  }

  // 获取 XML 输出
  const getXmlOutput = () => {
    if (!filteredData) return ''
    try {
      return fromJSON(filteredData, 'xml')
    } catch (e: any) {
      return '转换失败: ' + e.message
    }
  }

  // 渲染右侧视图
  const renderRightPanel = () => {
    if (error) {
      return (
        <div className="error-panel">
          <AlertCircle className="error-icon" size={48} />
          <div className="error-title">JSON 语法错误</div>
          <div className="error-message">{error.message}</div>
          {error.line && (
            <div className="error-location">
              位置: 第 {error.line} 行，第 {error.column} 列
            </div>
          )}
        </div>
      )
    }

    if (!filteredData) {
      return (
        <div className="empty-panel">
          <FileJson className="empty-icon" size={48} />
          <div className="empty-text">在左侧输入 JSON 数据</div>
          <div className="empty-hint">支持 JSON、YAML、XML 格式</div>
        </div>
      )
    }

    if (viewMode === null) {
      return null
    }

    switch (viewMode) {
      case 'tree':
        return (
          <div className="tree-view">
            <TreeNode data={filteredData} />
          </div>
        )

      case 'yaml':
        return (
          <pre className="json-output">
            {getYamlOutput()}
          </pre>
        )

      case 'xml':
        return (
          <pre className="json-output">
            {getXmlOutput()}
          </pre>
        )

      default:
        return null
    }
  }

  return (
    <div className="app">

      <div className="main-content">
        {/* 左侧编辑器 */}
        <div className="left-panel">
          <div className="panel-header">
            <span>JSON 编辑器</span>
            {parsedData && (
              <span className="status-badge success">
                <Check size={14} /> 有效
              </span>
            )}
            {error && (
              <span className="status-badge error">
                <X size={14} /> 错误
              </span>
            )}
          </div>
          <div className="editor-wrapper">
            <CodeEditor
              value={input}
              onChange={setInput}
              theme={theme}
            />
          </div>
        </div>

        {/* 右侧视图（仅在选择视图模式时显示） */}
        {viewMode !== null && (
          <div className="right-panel">
            <div className="panel-header">
              <div className="view-tabs">
                <button
                  className={`tab ${viewMode === 'tree' ? 'active' : ''}`}
                  onClick={() => setViewMode('tree')}
                >
                  树形视图
                </button>
                <button
                  className={`tab ${viewMode === 'yaml' ? 'active' : ''}`}
                  onClick={() => setViewMode('yaml')}
                >
                  YAML
                </button>
                <button
                  className={`tab ${viewMode === 'xml' ? 'active' : ''}`}
                  onClick={() => setViewMode('xml')}
                >
                  XML
                </button>
              </div>
              <button className="btn-close-view" onClick={() => setViewMode(null)}>
                <X size={16} />
              </button>
            </div>
            <div className="output-wrapper">
              {renderRightPanel()}
            </div>
          </div>
        )}
      </div>

      {/* 底部工具栏 */}
      <div className="bottom-toolbar">
        <div className="toolbar-section">
          <button className="btn-tool" onClick={handleFormat} disabled={!parsedData}>
            <Sparkles size={16} /> 格式化
          </button>
          <button className="btn-tool" onClick={handleCompress} disabled={!parsedData}>
            <Minimize2 size={16} /> 压缩
          </button>
          <button className="btn-tool" onClick={() => setViewMode('tree')} disabled={!parsedData}>
            <TreePine size={16} /> 树形视图
          </button>
          <button className="btn-tool" onClick={() => setViewMode('yaml')} disabled={!parsedData}>
            <FileText size={16} /> 转 YAML
          </button>
          <button className="btn-tool" onClick={() => setViewMode('xml')} disabled={!parsedData}>
            <FileCode size={16} /> 转 XML
          </button>
          <button className="btn-tool" onClick={handleCopy}>
            <Copy size={16} /> 复制 JSON
          </button>
          <button className="btn-tool" onClick={handleCopyYaml} disabled={!parsedData}>
            <Copy size={16} /> 复制 YAML
          </button>
          <button className="btn-tool" onClick={handleCopyXml} disabled={!parsedData}>
            <Copy size={16} /> 复制 XML
          </button>
          <button className="btn-tool" onClick={handleClear}>
            <Trash2 size={16} /> 清空
          </button>
        </div>

        <div className="filter-section">
          <label className="filter-label">JavaScript 过滤:</label>
          <input
            type="text"
            className="filter-input"
            value={filterExpr}
            onChange={(e) => setFilterExpr(e.target.value)}
            placeholder="例如: data.filter(x => x.age > 18) 或 data.users"
            disabled={!parsedData}
          />
          {filterExpr && (
            <button
              className="btn-clear-filter"
              onClick={() => setFilterExpr('')}
              title="清除过滤"
            >
              ✕
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
