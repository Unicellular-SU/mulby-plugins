import * as yaml from 'js-yaml'
import { XMLParser, XMLBuilder } from 'fast-xml-parser'

export type DataFormat = 'json' | 'yaml' | 'xml' | 'unknown'

// 修复被压缩成单行的 YAML（换行符被替换成空格）
function fixCompressedYaml(input: string): string {
  // 如果已经包含换行符，直接返回
  if (input.includes('\n')) {
    return input
  }

  // YAML 的键值对模式：key: value
  // 在每个顶级键前添加换行符
  let fixed = input

  // 常见的 YAML 顶级键模式
  const topLevelKeys = [
    'name:', 'version:', 'type:', 'scripts:', 'dependencies:', 'devDependencies:',
    'main:', 'module:', 'description:', 'author:', 'license:', 'keywords:',
    'repository:', 'bugs:', 'homepage:', 'engines:', 'peerDependencies:',
    'optionalDependencies:', 'bundledDependencies:', 'config:', 'private:',
    'workspaces:', 'resolutions:', 'overrides:'
  ]

  // 在顶级键前添加换行符
  topLevelKeys.forEach(key => {
    const regex = new RegExp(`\\s+(${key.replace(':', '\\s*:')})`, 'g')
    fixed = fixed.replace(regex, '\n$1')
  })

  // 处理缩进的子键（通常是 scripts、dependencies 等下的内容）
  // 模式：key: value 后面跟着另一个 key:
  fixed = fixed.replace(/:\s+([a-zA-Z_][-a-zA-Z0-9_@/]*)\s*:/g, ':\n  $1:')

  // 清理开头的换行符
  fixed = fixed.trim()

  return fixed
}

// 检测数据格式
export function detectFormat(input: string): DataFormat {
  const trimmed = input.trim()

  if (!trimmed) return 'unknown'

  // 检测 JSON
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      JSON.parse(trimmed)
      return 'json'
    } catch {
      // 可能是格式错误的 JSON
      return 'json'
    }
  }

  // 检测 XML
  if (trimmed.startsWith('<')) {
    return 'xml'
  }

  // 检测 YAML (简单判断：包含冒号且不是 JSON)
  if (trimmed.includes(':') && !trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    return 'yaml'
  }

  return 'unknown'
}

// 转换为 JSON 对象
export function toJSON(input: string, format: DataFormat): any {
  const trimmed = input.trim()

  if (!trimmed) {
    throw new Error('输入为空')
  }

  switch (format) {
    case 'json':
      return JSON.parse(trimmed)

    case 'yaml':
      try {
        // 尝试修复被压缩的 YAML
        const fixedYaml = fixCompressedYaml(trimmed)
        console.log('修复后的 YAML:', fixedYaml)

        const result = yaml.load(fixedYaml)
        if (result === undefined || result === null) {
          throw new Error('YAML 解析结果为空')
        }
        return result
      } catch (e: any) {
        throw new Error(`YAML 解析失败: ${e.message}`)
      }

    case 'xml': {
      const parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: '@_',
        textNodeName: '#text',
        parseAttributeValue: true,
        parseTagValue: true,
        trimValues: true
      })
      return parser.parse(trimmed)
    }

    default:
      throw new Error('未知的数据格式')
  }
}

// 从 JSON 对象转换为指定格式
export function fromJSON(data: any, format: DataFormat): string {
  switch (format) {
    case 'json':
      return JSON.stringify(data, null, 2)

    case 'yaml':
      return yaml.dump(data, { indent: 2, lineWidth: -1 })

    case 'xml': {
      const builder = new XMLBuilder({
        ignoreAttributes: false,
        attributeNamePrefix: '@_',
        textNodeName: '#text',
        format: true,
        indentBy: '  ',
        suppressEmptyNode: true
      })
      return builder.build(data)
    }

    default:
      throw new Error('不支持的输出格式')
  }
}

// 格式化 JSON 字符串
export function formatJSON(jsonString: string): string {
  const obj = JSON.parse(jsonString)
  return JSON.stringify(obj, null, 2)
}

// 压缩 JSON 字符串
export function compressJSON(jsonString: string): string {
  const obj = JSON.parse(jsonString)
  return JSON.stringify(obj)
}
