import { publicApiCatalog } from './api-catalog'

export interface LocalizedText {
  en: string
  zh: string
}

export interface MethodInputDetail {
  name: string
  type: string
  required: boolean
  description: LocalizedText
}

export interface MethodDetail {
  method: string
  moduleCode: string
  contexts: Array<'renderer' | 'backend' | 'manifest'>
  signature: string
  summary: LocalizedText
  inputs: MethodInputDetail[]
  returns: LocalizedText
  notes?: LocalizedText[]
}

type MethodDetailOverride = Partial<Omit<MethodDetail, 'method' | 'moduleCode' | 'contexts'>>

const noParameters: MethodInputDetail[] = [
  {
    name: 'none',
    type: '-',
    required: false,
    description: {
      en: 'No input parameters.',
      zh: '无输入参数。'
    }
  }
]

const callbackInput: MethodInputDetail = {
  name: 'callback',
  type: 'function',
  required: true,
  description: {
    en: 'Handler invoked by Mulby when this event or subscription produces data.',
    zh: '当该事件或订阅产生数据时由 Mulby 调用的处理函数。'
  }
}

function parameter(name: string, type: string, en: string, zh: string, required = true): MethodInputDetail {
  return {
    name,
    type,
    required,
    description: { en, zh }
  }
}

function inferInputs(method: string): MethodInputDetail[] {
  const action = method.split('.').pop() ?? method

  if (/^(getAll|getVoices|getVersion|getMode|getState|getBounds|getOpacity|stats|fetch)$/.test(action)) {
    return noParameters
  }

  if (/^(on|subscribe)/.test(action) || method.includes('.on')) {
    return [callbackInput]
  }

  if (/^get/.test(action)) {
    return [
      parameter('query', 'string | object', 'Identifier or filter used to read the requested resource, when required.', '读取目标资源所需的标识符或过滤条件；某些 get 方法不需要该参数。', false)
    ]
  }

  if (/^(read|list|is|has|can|describe|validate|search)/.test(action)) {
    return [
      parameter('criteria', 'string | object', 'Optional key, path, expression, or filter used by this read operation.', '该读取操作使用的可选键名、路径、表达式或过滤条件。', false)
    ]
  }

  if (/^(set|write|put|append|register|run|request|open|show|create|update|bind|send|schedule|start|stop|copy|move|remove|delete|clear|toggle|install|enable|disable|uninstall|pause|resume|cancel|focus|type|click|press|goto|download|evaluate|generate|edit|upload|speak|encrypt|decrypt)/.test(action)) {
    return [
      parameter('input', 'method-specific', 'The value or options object required by this Mulby API method.', '该 Mulby API 方法所需的值或选项对象。')
    ]
  }

  return [
    parameter('input', 'method-specific', 'Method-specific input. See the runnable examples in this module for the common payload shape.', '方法专属输入。常见载荷结构请参考本模块中的可运行示例。', false)
  ]
}

function inferReturns(method: string): LocalizedText {
  const action = method.split('.').pop() ?? method

  if (/^(set|write|put|append|register|unregister|remove|delete|clear|update|bind|unbind|enable|disable|install|uninstall|pause|resume|cancel|start|stop|open|show|hide|focus|close|destroy|reload|center|speak)$/.test(action)) {
    return {
      en: 'Promise<void> or Promise<{ success: boolean; ... }>. Mutating calls usually resolve after Mulby accepts or completes the action.',
      zh: 'Promise<void> 或 Promise<{ success: boolean; ... }>。变更类调用通常在 Mulby 接受或完成操作后 resolve。'
    }
  }

  if (/^(on|subscribe)/.test(action) || method.includes('.on')) {
    return {
      en: 'Unsubscribe function or subscription acknowledgement, depending on the API surface.',
      zh: '根据 API 表面返回取消订阅函数或订阅确认结果。'
    }
  }

  if (/^(get|read|list|search|is|has|can|stats|fetch|describe|validate)/.test(action)) {
    return {
      en: 'Promise with the requested data, status object, boolean, or list. See the runnable example output for the concrete host shape.',
      zh: '返回包含请求数据、状态对象、布尔值或列表的 Promise。具体宿主结构可查看配套可运行示例输出。'
    }
  }

  return {
    en: 'Returns a Promise or value defined by the Mulby host API. The paired runnable example shows the observed result shape in the current host.',
    zh: '返回 Mulby 宿主 API 定义的 Promise 或同步值。本模块配套的可运行示例会展示当前宿主中的实际结果结构。'
  }
}

function defaultDetail(method: string, moduleCode: string, contexts: MethodDetail['contexts'], moduleSummary: string): MethodDetail {
  const callableName = method.startsWith('manifest.') ? method : `window.mulby.${method}`
  return {
    method,
    moduleCode,
    contexts,
    signature: callableName,
    summary: {
      en: `${method} is part of the ${moduleCode} API. ${moduleSummary}`,
      zh: `${method} 属于 ${moduleCode} 模块的公开方法。可运行示例会展示它在当前宿主中的典型调用方式。`
    },
    inputs: inferInputs(method),
    returns: inferReturns(method)
  }
}

const overrides: Record<string, MethodDetailOverride> = {
  'clipboard.readText': {
    signature: 'window.mulby.clipboard.readText()',
    summary: {
      en: 'Reads plain text from the system clipboard.',
      zh: '从系统剪贴板读取纯文本。'
    },
    inputs: noParameters,
    returns: {
      en: 'Promise<string>. Empty string when the clipboard has no text.',
      zh: 'Promise<string>。剪贴板没有文本时返回空字符串。'
    },
    notes: [
      {
        en: 'Requires manifest.permissions.clipboard.',
        zh: '需要在 manifest.permissions 中声明 clipboard 权限。'
      }
    ]
  },
  'clipboard.writeText': {
    signature: 'window.mulby.clipboard.writeText(text)',
    summary: {
      en: 'Writes plain text into the system clipboard.',
      zh: '向系统剪贴板写入纯文本。'
    },
    inputs: [
      parameter('text', 'string', 'Text to place on the clipboard.', '要写入剪贴板的文本。')
    ],
    returns: {
      en: 'Promise<void> or Promise<boolean>, depending on host context.',
      zh: '根据宿主上下文返回 Promise<void> 或 Promise<boolean>。'
    }
  },
  'clipboard.readImage': {
    signature: 'window.mulby.clipboard.readImage()',
    summary: {
      en: 'Reads image data from the system clipboard as PNG-compatible binary data.',
      zh: '从系统剪贴板读取图片，返回 PNG 兼容的二进制数据。'
    },
    inputs: noParameters,
    returns: {
      en: 'Promise<Buffer | Uint8Array | null>. Returns null when no image is available.',
      zh: 'Promise<Buffer | Uint8Array | null>。没有图片时返回 null。'
    }
  },
  'clipboard.writeImage': {
    signature: 'window.mulby.clipboard.writeImage(image)',
    summary: {
      en: 'Writes image data into the system clipboard.',
      zh: '向系统剪贴板写入图片数据。'
    },
    inputs: [
      parameter('image', 'string | Buffer | ArrayBuffer | Uint8Array', 'Image file path, data URL, or binary image data. Backend supports Buffer input.', '图片文件路径、Data URL 或二进制图片数据。后端支持 Buffer 输入。')
    ],
    returns: {
      en: 'Promise<boolean> in renderer context; backend resolves when the write completes.',
      zh: '渲染进程返回 Promise<boolean>；后端在写入完成后 resolve。'
    }
  },
  'clipboard.readFiles': {
    signature: 'window.mulby.clipboard.readFiles()',
    summary: {
      en: 'Reads file references currently stored in the clipboard.',
      zh: '读取当前剪贴板中的文件引用。'
    },
    inputs: noParameters,
    returns: {
      en: 'Promise<Array<{ path, name, size, type?, isDirectory }>>.',
      zh: 'Promise<Array<{ path, name, size, type?, isDirectory }>>。'
    }
  },
  'clipboard.writeFiles': {
    signature: 'window.mulby.clipboard.writeFiles(filePaths)',
    summary: {
      en: 'Writes one or more file paths into the system clipboard.',
      zh: '将一个或多个文件路径写入系统剪贴板。'
    },
    inputs: [
      parameter('filePaths', 'string | string[]', 'Absolute file path or list of file paths to write.', '要写入的绝对文件路径或路径数组。')
    ],
    returns: {
      en: 'Promise<boolean>. True when Mulby accepts the file clipboard payload.',
      zh: 'Promise<boolean>。Mulby 接受文件剪贴板载荷时返回 true。'
    }
  },
  'clipboard.getFormat': {
    signature: 'window.mulby.clipboard.getFormat()',
    summary: {
      en: 'Detects the current clipboard content format.',
      zh: '检测当前剪贴板内容格式。'
    },
    inputs: noParameters,
    returns: {
      en: "Promise<'text' | 'image' | 'files' | 'html' | 'empty'> in renderer context.",
      zh: "渲染进程返回 Promise<'text' | 'image' | 'files' | 'html' | 'empty'>。"
    }
  }
}

export const methodDetails: Record<string, MethodDetail> = Object.fromEntries(
  publicApiCatalog.flatMap((entry) =>
    entry.methods.map((method) => {
      const base = defaultDetail(method, entry.code, entry.contexts, entry.summary)
      return [method, { ...base, ...overrides[method], method, moduleCode: entry.code, contexts: entry.contexts }]
    })
  )
)
