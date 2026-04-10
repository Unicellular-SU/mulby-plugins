import { useEffect, useState } from 'react'
import { FileText, Image, Folder, Star, Trash2, Copy, Search, X, File, ChevronRight, RefreshCw } from 'lucide-react'
import { useMulby } from './hooks/useMulby'

interface ClipboardHistoryItem {
  id: string
  type: 'text' | 'image' | 'files'
  content: string
  plainText?: string
  files?: string[]
  filePath?: string  // 图片文件的原始路径
  timestamp: number
  size: number
  favorite: boolean
  tags?: string[]
}

interface Stats {
  total: number
  text: number
  image: number
  files: number
  favorite: number
}

export default function App() {
  const [items, setItems] = useState<ClipboardHistoryItem[]>([])
  const [filteredItems, setFilteredItems] = useState<ClipboardHistoryItem[]>([])
  const [selectedItem, setSelectedItem] = useState<ClipboardHistoryItem | null>(null)
  const [loading, setLoading] = useState(true)
  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  const [searchText, setSearchText] = useState('')
  const [filterType, setFilterType] = useState<'all' | 'text' | 'image' | 'files' | 'favorite'>('all')
  const [stats, setStats] = useState<Stats | null>(null)
  const { host, notification, window: win } = useMulby('clipboard-history')

  // 加载历史记录
  const loadHistory = async () => {
    setLoading(true)
    try {
      const result = await host.call('queryHistory', {
        limit: 100
      })
      const data = result.data || []
      setItems(data)
      // 默认选中第一条
      if (data.length > 0 && !selectedItem) {
        setSelectedItem(data[0])
      }
    } catch (err: any) {
      notification.show(`加载失败: ${err.message}`, 'error')
    } finally {
      setLoading(false)
    }
  }

  // 加载统计信息
  const loadStats = async () => {
    try {
      const result = await host.call('getStats')
      setStats(result.data)
    } catch (err) {
      console.error('加载统计失败:', err)
    }
  }

  // 初始化
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const initialTheme = (params.get('theme') as 'light' | 'dark') || 'light'
    setTheme(initialTheme)
    document.documentElement.classList.toggle('dark', initialTheme === 'dark')

    window.mulby?.onThemeChange?.((newTheme: 'light' | 'dark') => {
      setTheme(newTheme)
      document.documentElement.classList.toggle('dark', newTheme === 'dark')
    })

    loadHistory()
    loadStats()
  }, [])

  // 过滤和搜索
  useEffect(() => {
    let filtered = items

    if (filterType === 'favorite') {
      filtered = filtered.filter(item => item.favorite)
    } else if (filterType !== 'all') {
      filtered = filtered.filter(item => item.type === filterType)
    }

    if (searchText.trim()) {
      const search = searchText.toLowerCase()
      filtered = filtered.filter(item => {
        if (item.type === 'text') {
          return item.content.toLowerCase().includes(search)
        } else if (item.type === 'files' && item.files) {
          return item.files.some(f => f.toLowerCase().includes(search))
        }
        return false
      })
    }

    setFilteredItems(filtered)

    // 如果当前选中的项不在过滤结果中，选中第一条
    if (selectedItem && !filtered.find(item => item.id === selectedItem.id)) {
      setSelectedItem(filtered[0] || null)
    }
  }, [items, filterType, searchText])

  // 复制到剪贴板
  const handleCopy = async (id: string) => {
    try {
      await host.call('copyToClipboard', id)
      win.hide()
    } catch (err: any) {
      notification.show(`复制失败: ${err.message}`, 'error')
    }
  }

  // 切换收藏
  const handleToggleFavorite = async (id: string) => {
    try {
      await host.call('toggleFavorite', id)
      setItems(items.map(item =>
        item.id === id ? { ...item, favorite: !item.favorite } : item
      ))
      if (selectedItem?.id === id) {
        setSelectedItem({ ...selectedItem, favorite: !selectedItem.favorite })
      }
      loadStats()
    } catch (err: any) {
      notification.show(`操作失败: ${err.message}`, 'error')
    }
  }

  // 删除记录
  const handleDelete = async (id: string) => {
    try {
      await host.call('deleteItem', id)
      setItems(items.filter(item => item.id !== id))
      if (selectedItem?.id === id) {
        const remaining = items.filter(item => item.id !== id)
        setSelectedItem(remaining[0] || null)
      }
      loadStats()
    } catch (err: any) {
      notification.show(`删除失败: ${err.message}`, 'error')
    }
  }

  // 清空历史
  const handleClearAll = async () => {
    if (!confirm('确定要清空所有历史记录吗？（收藏的记录会保留）')) {
      return
    }

    try {
      await host.call('clearHistory')
      await loadHistory()
      await loadStats()
    } catch (err: any) {
      notification.show(`清空失败: ${err.message}`, 'error')
    }
  }

  // 格式化时间
  const formatTime = (timestamp: number) => {
    const now = Date.now()
    const diff = now - timestamp
    const seconds = Math.floor(diff / 1000)
    const minutes = Math.floor(seconds / 60)
    const hours = Math.floor(minutes / 60)
    const days = Math.floor(hours / 24)

    if (days > 0) return `${days}天前`
    if (hours > 0) return `${hours}小时前`
    if (minutes > 0) return `${minutes}分钟前`
    return '刚刚'
  }

  // 格式化大小
  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  }

  // 渲染图标
  const renderIcon = (type: string) => {
    switch (type) {
      case 'text':
        return <FileText size={16} />
      case 'image':
        return <Image size={16} />
      case 'files':
        return <Folder size={16} />
      default:
        return <FileText size={16} />
    }
  }

  // 获取文件扩展名
  const getFileExtension = (filename: string) => {
    const parts = filename.split('.')
    return parts.length > 1 ? parts[parts.length - 1].toUpperCase() : 'FILE'
  }

  // 渲染左侧列表项
  const renderListItem = (item: ClipboardHistoryItem) => {
    const isSelected = selectedItem?.id === item.id

    let preview = ''
    let showImagePreview = false

    if (item.type === 'text') {
      preview = item.content.substring(0, 50).replace(/\n/g, ' ')
    } else if (item.type === 'files' && item.files && item.files.length > 0) {
      preview = item.files[0].split('/').pop() || ''
      if (item.files.length > 1) {
        preview += ` +${item.files.length - 1}`
      }
    } else if (item.type === 'image') {
      preview = '图片'
      showImagePreview = true
    }

    return (
      <div
        key={item.id}
        className={`list-item ${isSelected ? 'selected' : ''}`}
        onClick={() => setSelectedItem(item)}
      >
        {showImagePreview ? (
          <div className="list-item-image-preview">
            <img src={item.content} alt="preview" />
          </div>
        ) : (
          <div className="list-item-icon">{renderIcon(item.type)}</div>
        )}
        <div className="list-item-content">
          <div className="list-item-preview">{preview}</div>
          <div className="list-item-meta">
            <span>{formatTime(item.timestamp)}</span>
            <span>{formatSize(item.size)}</span>
          </div>
        </div>
        {item.favorite && <Star size={14} className="list-item-star" />}
        <ChevronRight size={16} className="list-item-arrow" />
      </div>
    )
  }

  // 渲染右侧详情
  const renderDetail = () => {
    if (!selectedItem) {
      return (
        <div className="detail-empty">
          <p>选择一条记录查看详情</p>
        </div>
      )
    }

    return (
      <div className="detail">
        {/* 详情头部 */}
        <div className="detail-header">
          <div className="detail-type">
            {renderIcon(selectedItem.type)}
            <span>{selectedItem.type === 'text' ? '文本' : selectedItem.type === 'image' ? '图片' : '文件'}</span>
          </div>
          <div className="detail-actions">
            <button
              className={`btn-icon ${selectedItem.favorite ? 'active' : ''}`}
              onClick={() => handleToggleFavorite(selectedItem.id)}
              title={selectedItem.favorite ? '取消收藏' : '收藏'}
            >
              <Star size={18} />
            </button>
            <button
              className="btn-icon btn-copy"
              onClick={() => handleCopy(selectedItem.id)}
              title="复制"
            >
              <Copy size={18} />
            </button>
            <button
              className="btn-icon btn-delete"
              onClick={() => handleDelete(selectedItem.id)}
              title="删除"
            >
              <Trash2 size={18} />
            </button>
          </div>
        </div>

        {/* 详情内容 */}
        <div className="detail-content">
          {selectedItem.type === 'text' && (
            <div className="detail-text">
              <pre>{selectedItem.content}</pre>
            </div>
          )}

          {selectedItem.type === 'image' && (
            <div className="detail-image">
              <img
                src={selectedItem.filePath ? `file://${selectedItem.filePath}` : selectedItem.content}
                alt="clipboard"
              />
            </div>
          )}

          {selectedItem.type === 'files' && selectedItem.files && (
            <div className="detail-files">
              {selectedItem.files.map((file, idx) => {
                const filename = file.split('/').pop() || file
                const ext = getFileExtension(filename)

                return (
                  <div key={idx} className="file-card">
                    <div className="file-icon">
                      <File size={24} />
                      <span className="file-ext">{ext}</span>
                    </div>
                    <div className="file-info">
                      <div className="file-name" title={filename}>{filename}</div>
                      <div className="file-path" title={file}>{file}</div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* 详情底部 */}
        <div className="detail-footer">
          <div className="detail-meta">
            <span>时间：{new Date(selectedItem.timestamp).toLocaleString('zh-CN')}</span>
            <span>大小：{formatSize(selectedItem.size)}</span>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="app">
      {/* 头部 */}
      <div className="header">
        <div className="header-title">
          <h1>剪贴板历史</h1>
          {stats && (
            <div className="stats">
              <span>共 {stats.total} 条</span>
            </div>
          )}
        </div>
        <div className="header-actions">
          <button className="btn-refresh" onClick={() => { loadHistory(); loadStats(); }} title="刷新">
            <RefreshCw size={16} />
          </button>
          <button className="btn-clear" onClick={handleClearAll}>
            <Trash2 size={16} />
            清空
          </button>
        </div>
      </div>

      {/* 工具栏 */}
      <div className="toolbar">
        <div className="search-box">
          <Search size={16} />
          <input
            type="text"
            placeholder="搜索..."
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
          />
          {searchText && (
            <button className="btn-clear-search" onClick={() => setSearchText('')}>
              <X size={14} />
            </button>
          )}
        </div>
        <div className="filter-buttons">
          <button
            className={filterType === 'all' ? 'active' : ''}
            onClick={() => setFilterType('all')}
          >
            全部
          </button>
          <button
            className={filterType === 'text' ? 'active' : ''}
            onClick={() => setFilterType('text')}
          >
            文本
          </button>
          <button
            className={filterType === 'image' ? 'active' : ''}
            onClick={() => setFilterType('image')}
          >
            图片
          </button>
          <button
            className={filterType === 'files' ? 'active' : ''}
            onClick={() => setFilterType('files')}
          >
            文件
          </button>
          <button
            className={filterType === 'favorite' ? 'active' : ''}
            onClick={() => setFilterType('favorite')}
          >
            <Star size={14} />
            收藏
          </button>
        </div>
      </div>

      {/* 主内容区 */}
      <div className="main-content">
        {/* 左侧列表 */}
        <div className="sidebar">
          {loading ? (
            <div className="loading">加载中...</div>
          ) : filteredItems.length === 0 ? (
            <div className="empty">
              {searchText || filterType !== 'all' ? '没有找到匹配的记录' : '暂无历史记录'}
            </div>
          ) : (
            <div className="list">
              {filteredItems.map(renderListItem)}
            </div>
          )}
        </div>

        {/* 右侧详情 */}
        <div className="detail-panel">
          {renderDetail()}
        </div>
      </div>
    </div>
  )
}
