import { useEffect, useState } from 'react'
import { useMulby } from './hooks/useMulby'
import { 
  FaLocationDot, 
  FaMagnifyingGlass, 
  FaCopy, 
  FaSun, 
  FaMoon, 
  FaChevronDown, 
  FaChevronRight,
  FaExclamationTriangle
} from 'react-icons/fa6'

interface IpInfo {
  ip: string
  city?: string
  region?: string
  country?: string
  country_code?: string
  latitude?: number
  longitude?: number
  org?: string
  postal?: string
  timezone?: string
  asn?: string
  hostname?: string
  anycast?: boolean
  [key: string]: any
}

interface LocalIpInfo {
  publicIp?: string
  publicIpInfo?: IpInfo
  localIps?: string[]
}

interface PluginInitData {
  pluginName: string
  featureCode: string
  input: string
  mode?: string
  route?: string
}

export default function App() {
  const { http, clipboard, notification } = useMulby('ip_look')
  const [localIpInfo, setLocalIpInfo] = useState<LocalIpInfo>({})
  const [queryIp, setQueryIp] = useState('')
  const [queryResult, setQueryResult] = useState<IpInfo | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [localTheme, setLocalTheme] = useState<'light' | 'dark'>('light')
  const [logs, setLogs] = useState<string[]>([])
  const ipRegex = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/
  const [showLocalIp, setShowLocalIp] = useState(false)

  // 初始化主题和插件数据
  useEffect(() => {
    // 获取宿主当前主题
    const currentTheme = window.mulby?.theme?.get() || 'light'
    setLocalTheme(currentTheme)
    document.documentElement.classList.toggle('dark', currentTheme === 'dark')
    
    // 监听宿主主题变化
    window.mulby?.onThemeChange?.((newTheme: 'light' | 'dark') => {
      setLocalTheme(newTheme)
      document.documentElement.classList.toggle('dark', newTheme === 'dark')
    })

    // 接收插件初始化数据（仅填充输入框，不自动查询）
    window.mulby?.onPluginInit?.((data: PluginInitData) => {
      if (data.input) {
        const input = data.input.trim()
        // 只有输入是IP地址时才填充到搜索框
        if (ipRegex.test(input)) {
          setQueryIp(input)
        }
        // 不自动查询，只填充输入框
      }
    })
  }, [])



  // 切换本地主题（仅影响插件）
  const toggleLocalTheme = () => {
    const newTheme = localTheme === 'light' ? 'dark' : 'light'
    setLocalTheme(newTheme)
    document.documentElement.classList.toggle('dark', newTheme === 'dark')
  }

  // 切换本机IP信息显示
  const handleToggleLocalIp = () => {
    const newShow = !showLocalIp
    setShowLocalIp(newShow)
    if (newShow && !localIpInfo.publicIp) {
      fetchLocalIpInfo()
    }
  }

  // 获取本机IP信息
  const fetchLocalIpInfo = async () => {
    try {
      setLoading(true)
      setError(null)

      let publicIp = null
      let lastError = null
      
      // 尝试所有公网IP查询API
      for (const apiUrl of publicIpApis) {
        console.log(`尝试获取公网IP: ${apiUrl}`)
        try {
          const response = await fetchWithFallback(apiUrl)
          console.log('公网IP API响应:', response)
          
          // 不同API返回不同格式的数据
          if (apiUrl.includes('ipify.org')) {
            publicIp = response.ip
          } else if (apiUrl.includes('icanhazip.com')) {
            publicIp = response.ip || response.data
          } else if (apiUrl.includes('ipinfo.io/ip')) {
            // ipinfo.io/ip 返回纯文本IP
            publicIp = response.trim ? response.trim() : response
          } else if (apiUrl.includes('ifconfig.me')) {
            publicIp = response.ip
          } else {
            // 默认尝试获取ip字段
            publicIp = response.ip || response.query || response.IPv4
          }
          
          if (publicIp && typeof publicIp === 'string' && ipRegex.test(publicIp)) {
            console.log(`成功获取公网IP: ${publicIp}`)
            break
          } else {
            console.warn(`无效的IP响应格式:`, response)
            publicIp = null
          }
        } catch (err) {
          console.warn(`API ${apiUrl} 失败:`, err)
          lastError = err
          continue
        }
      }
      
      if (!publicIp) {
        throw new Error(lastError || '无法获取公网IP地址')
      }
      
      // 获取公网IP的详细信息
      const publicIpInfo = await fetchIpInfo(publicIp)
      
      setLocalIpInfo({
        publicIp,
        publicIpInfo
      })
    } catch (err) {
      console.error('获取本机IP失败:', err)
      setError(err instanceof Error ? err.message : '获取本机IP失败，请检查网络连接')
    } finally {
      setLoading(false)
    }
  }

  // 获取IP信息
  
  // IP查询API列表（按优先级排序）
  const ipQueryApis = [
    {
      name: 'ipapi.co',
      url: (ip: string) => `https://ipapi.co/${ip}/json/`,
      parse: (data: any) => ({
        ip: data.ip,
        city: data.city,
        region: data.region,
        country: data.country_name,
        country_code: data.country_code,
        latitude: data.latitude,
        longitude: data.longitude,
        org: data.org,
        postal: data.postal,
        timezone: data.timezone,
        asn: data.asn,
        hostname: data.hostname,
      })
    },
    {
      name: 'ipinfo.io',
      url: (ip: string) => `https://ipinfo.io/${ip}/json`,
      parse: (data: any) => ({
        ip: data.ip,
        city: data.city,
        region: data.region,
        country: data.country,
        country_code: data.country,
        latitude: data.loc ? parseFloat(data.loc.split(',')[0]) : undefined,
        longitude: data.loc ? parseFloat(data.loc.split(',')[1]) : undefined,
        org: data.org,
        postal: data.postal,
        timezone: data.timezone,
        asn: data.asn,
        hostname: data.hostname,
      })
    },
    {
      name: 'ip-api.com',
      url: (ip: string) => `http://ip-api.com/json/${ip}?fields=66846719`,
      parse: (data: any) => ({
        ip: data.query,
        city: data.city,
        region: data.regionName,
        country: data.country,
        country_code: data.countryCode,
        latitude: data.lat,
        longitude: data.lon,
        org: data.org,
        postal: data.zip,
        timezone: data.timezone,
        asn: data.as,
        hostname: data.reverse,
      })
    },
    {
      name: 'ipwhois',
      url: (ip: string) => `https://ipwho.is/${ip}`,
      parse: (data: any) => ({
        ip: data.ip,
        city: data.city,
        region: data.region,
        country: data.country,
        country_code: data.country_code,
        latitude: data.latitude,
        longitude: data.longitude,
        org: data.connection?.org,
        postal: data.postal,
        timezone: data.timezone?.id,
        asn: data.connection?.asn,
        hostname: data.hostname,
      })
    },
    {
      name: 'geolocation-db',
      url: (ip: string) => `https://geolocation-db.com/json/${ip}`,
      parse: (data: any) => ({
        ip: data.IPv4,
        city: data.city,
        region: data.state,
        country: data.country_name,
        country_code: data.country_code,
        latitude: data.latitude,
        longitude: data.longitude,
        org: undefined,
        postal: undefined,
        timezone: undefined,
        asn: undefined,
        hostname: undefined,
      })
    }
  ]

  // 公网IP查询API列表
  const publicIpApis = [
    'https://api.ipify.org?format=json',
    'https://api64.ipify.org?format=json',
    'https://icanhazip.com/json',
    'https://ipinfo.io/ip',
    'https://ifconfig.me/ip.json'
  ]

  // 标准化IP信息，统一不同API的字段名
  const unusedNormalizeIpInfo = (data: any): IpInfo => {
    console.log('原始API数据:', data)
    
    // 直接映射字段
    const result: IpInfo = {
      ip: data.ip,
      city: data.city,
      region: data.region,
      country: data.country_name || data.country,
      country_code: data.country_code || data.country,
      latitude: data.latitude,
      longitude: data.longitude,
      org: data.org,
      postal: data.postal,
      timezone: data.timezone,
      asn: data.asn,
      hostname: data.hostname,
    }
    
    // 记录每个字段的值
    console.log('字段映射详情:', {
      ip: result.ip,
      city: result.city,
      region: result.region,
      country: result.country,
      country_code: result.country_code,
      latitude: result.latitude,
      longitude: result.longitude,
      org: result.org,
      postal: result.postal,
      timezone: result.timezone,
      asn: result.asn,
      hostname: result.hostname,
    })
    
    return result
  }

  const fetchIpInfo = async (ip: string): Promise<IpInfo> => {
    console.log(`开始查询IP: ${ip}`)
    
    // 尝试所有可用的API，直到成功
    for (const api of ipQueryApis) {
      console.log(`尝试使用 ${api.name} API...`)
      try {
        const url = api.url(ip)
        const data = await fetchWithFallback(url)
        console.log(`${api.name} 返回数据:`, data)
        
        // 使用API特定的解析函数
        const parsed = api.parse(data)
        console.log('解析后数据:', parsed)
        
        // 验证解析后的数据是否有效
        if (!parsed.ip || parsed.ip === 'undefined' || parsed.ip === 'null') {
          console.warn(`${api.name} 返回的IP无效，尝试下一个API`)
          throw new Error('API返回无效IP')
        }
        
        // 确保IP地址正确（如果API返回的IP与查询不一致）
        if (parsed.ip !== ip) {
          console.warn(`${api.name} 返回的IP不一致: ${parsed.ip} !== ${ip}`)
          // 仍然使用返回的IP，但记录警告
        }
        
        // 检查是否有基本有效数据（至少IP有效）
        // 即使地理位置字段为空，也接受结果
        return parsed as IpInfo
      } catch (err) {
        console.warn(`${api.name} 查询失败:`, err)
        // 继续尝试下一个API
        continue
      }
    }
    
    // 所有API都失败
    console.error('所有IP查询API都失败了')
    throw new Error('IP查询服务暂不可用，请稍后重试')
  }

  // 带降级的fetch函数
  const fetchWithFallback = async (url: string): Promise<any> => {
    console.log(`请求URL: ${url}`)
    try {
      // 首先尝试使用 Mulby 的 http API
      if (http && http.get) {
        console.log('使用 Mulby http API')
        const response = await http.get(url)
        console.log('Mulby http API 响应:', response)
        // 确保 data 是对象
        let data = response.data
        if (typeof data === 'string') {
          try {
            data = JSON.parse(data)
          } catch (parseErr) {
            console.warn('解析 JSON 失败:', parseErr)
            // 如果不是JSON，检查是否为HTML错误页面
            if (data.includes('<!DOCTYPE') || data.includes('<html')) {
              console.error('API返回HTML错误页面')
              throw new Error('API返回错误页面，可能被阻止')
            }
            // 否则保留原始字符串
          }
        }
        return data
      }
    } catch (err) {
      console.warn('Mulby http API 失败，尝试原生 fetch:', err)
    }
    
    // 降级到原生 fetch
    console.log('使用原生 fetch')
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json, text/plain, */*',
        'User-Agent': 'Mulby-ip_look/1.0'
      }
    })
    
    if (!response.ok) {
      console.error(`HTTP 错误: ${response.status}`)
      throw new Error(`HTTP ${response.status}`)
    }
    
    // 尝试解析JSON，如果失败则返回文本
    const contentType = response.headers.get('content-type')
    if (contentType && contentType.includes('application/json')) {
      const data = await response.json()
      console.log('原生 fetch 响应数据 (JSON):', data)
      return data
    } else {
      const text = await response.text()
      console.log('原生 fetch 响应数据 (文本):', text)
      // 检查是否为HTML错误页面
      if (text.includes('<!DOCTYPE') || text.includes('<html') || text.includes('Just a moment')) {
        console.error('API返回HTML错误页面')
        throw new Error('API返回错误页面，可能被阻止')
      }
      // 尝试解析可能的JSON字符串
      if (text.trim().startsWith('{') || text.trim().startsWith('[')) {
        try {
          const data = JSON.parse(text)
          console.log('文本解析为JSON:', data)
          return data
        } catch (parseErr) {
          console.warn('文本解析JSON失败:', parseErr)
        }
      }
      return text
    }
  }

  // 查询IP
  const handleQueryIp = async (ip?: string) => {
    const targetIp = ip || queryIp
    if (!targetIp.trim()) {
      setError('请输入IP地址')
      return
    }

    // 简单IP格式验证
    if (!ipRegex.test(targetIp)) {
      setError('IP地址格式不正确')
      return
    }

    try {
      setLoading(true)
      setError(null)
      const result = await fetchIpInfo(targetIp)
      setQueryResult(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : '查询失败')
      setQueryResult(null)
    } finally {
      setLoading(false)
    }
  }

  // 复制到剪贴板
  const handleCopy = (text: string, label?: string) => {
    clipboard.writeText(text)
    notification.show(`${label || '内容'}已复制`, 'success')
  }

  // 渲染IP信息卡片
  const renderIpInfoCard = (title: string, ip: string, info: IpInfo | null, hideTitle?: boolean) => {
    console.log('渲染IP信息卡片', title, ip, info)
    console.log('info 对象:', info)
    console.log('info.country:', info?.country)
    console.log('info.region:', info?.region)
    console.log('info.city:', info?.city)
    const fields = [
      { label: 'IP地址', value: ip, key: 'ip' },
      { label: '国家', value: info?.country, key: 'country' },
      { label: '地区', value: info?.region, key: 'region' },
      { label: '城市', value: info?.city, key: 'city' },
      { label: '运营商', value: info?.org, key: 'org' },
      { label: '时区', value: info?.timezone, key: 'timezone' },
      { label: '经纬度', value: info?.latitude && info?.longitude ? `${info.latitude}, ${info.longitude}` : undefined, key: 'location' },
      { label: '邮政编码', value: info?.postal, key: 'postal' },
      { label: 'ASN', value: info?.asn, key: 'asn' },
      { label: '主机名', value: info?.hostname, key: 'hostname' },
    ].filter(field => field.value !== undefined && field.value !== null && field.value !== '')
    
    console.log('过滤后字段:', fields)

    return (
      <div className="card">
        {!hideTitle && (
          <div className="card-title">
            <span className="card-title-icon">
              {title === '查询结果' ? <FaMagnifyingGlass className="icon" /> : <FaLocationDot className="icon" />}
            </span>
            {title}
          </div>
        )}
        <div className="card-content">
          <div className="ip-grid">
            {fields.map(field => (
              <div className="field" key={field.key}>
                <label>{field.label}</label>
                <div className="field-value">
                  <span className="field-value-text">{String(field.value)}</span>
                  <button
                    className="copy-button"
                    onClick={() => handleCopy(String(field.value), field.label)}
                    title={`复制${field.label}`}
                  >
                    <FaCopy className="icon" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="app">
      <div className="header">
        <h1>IP 查询工具</h1>
        <button 
          className="theme-toggle"
          onClick={toggleLocalTheme}
          title="切换插件主题"
        >
          {localTheme === 'dark' ? <FaMoon className="icon" /> : <FaSun className="icon" />}
        </button>
      </div>

      <div className="container">
        {/* 错误提示 */}
        {error && (
          <div className="error-message">
            {error}
          </div>
        )}

        {/* 本机IP信息（可折叠） */}
        <div className="card">
          <div 
            className="card-title clickable"
            onClick={handleToggleLocalIp}
            style={{ cursor: 'pointer' }}
          >
            <span className="card-title-icon"><FaLocationDot className="icon" /></span>
            本机 IP 信息
            <span style={{ marginLeft: 'auto' }}>
              {showLocalIp ? <FaChevronDown className="icon-sm" /> : <FaChevronRight className="icon-sm" />}
            </span>
          </div>
          {showLocalIp && (
            <div className="card-content">
              {loading && !localIpInfo.publicIp ? (
                <div className="loading">
                  <div className="loading-spinner"></div>
                  加载本机 IP 信息中...
                </div>
              ) : localIpInfo.publicIp ? (
                renderIpInfoCard('', localIpInfo.publicIp, localIpInfo.publicIpInfo, true)
              ) : (
                <div>无法获取本机 IP 信息</div>
              )}
            </div>
          )}
        </div>

        {/* 查询IP卡片 */}
        <div className="card">
          <div className="card-title">
            <span className="card-title-icon"><FaMagnifyingGlass className="icon" /></span>
            IP 查询
          </div>
          <div className="card-content">
            <div className="input-group">
              <input
                type="text"
                value={queryIp}
                onChange={(e) => setQueryIp(e.target.value)}
                placeholder="输入 IP 地址，例如：8.8.8.8"
                onKeyDown={(e) => e.key === 'Enter' && handleQueryIp()}
              />
              <button 
                onClick={() => handleQueryIp()}
                disabled={loading}
              >
                {loading ? '查询中...' : '查询'}
              </button>
            </div>
            
            {queryResult && renderIpInfoCard('查询结果', queryResult.ip || queryIp, queryResult)}
          </div>
        </div>

        {/* 加载状态 */}
        {loading && (
          <div className="loading">
            <div className="loading-spinner"></div>
            加载中...
          </div>
        )}
      </div>

      <div className="footer">
        IP 数据来自多个免费 API 服务
      </div>
    </div>
  )
}