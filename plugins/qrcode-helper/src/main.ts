import * as qrcode from 'qrcode'
import Jimp from 'jimp'
import jsqr from 'jsqr'
declare const mulby: any;

interface PluginContext {
  api: {
    clipboard: {
      readText: () => string
      writeText: (text: string) => Promise<void>
      readImage: () => ArrayBuffer | null
      getFormat: () => string
    }
    notification: {
      show: (message: string, type?: string) => void
    }
    features?: {
      getFeatures: (codes?: string[]) => Array<{ code: string }>
      setFeature: (feature: {
        code: string
        explain?: string
        icon?: string
        platform?: string | string[]
        mode?: 'ui' | 'silent' | 'detached'
        route?: string
        mainHide?: boolean
        mainPush?: boolean
        cmds: Array<string | { type: 'keyword' | 'regex'; value?: string; match?: string; explain?: string }>
      }) => void
      removeFeature: (code: string) => boolean
      redirectHotKeySetting: (cmdLabel: string, autocopy?: boolean) => void
      redirectAiModelsSetting: () => void
    }
    tools: {
      register: (name: string, handler: (args: any, ctx?: any) => any) => void
      unregister: (name: string) => void
    }
  }
  input?: string
  featureCode?: string
}

export function onLoad() {
  console.log('[qrcode-helper] 插件已加载')
  if (mulby?.tools) {
    // 生成二维码：文本 -> base64 图片
    mulby.tools.register('generate_qrcode', async (args: any) => {
      if (!args || typeof args.text !== 'string') {
        throw new Error('generate_qrcode failed: invalid text argument')
      }
      const dataUrl = await qrcode.toDataURL(args.text, { margin: 1 })
      return { base64Image: dataUrl }
    })

    // 解码二维码：base64 图片 -> 文本
    mulby.tools.register('decode_qrcode', async (args: any) => {
      if (!args || typeof args.base64Image !== 'string') {
        throw new Error('decode_qrcode failed: invalid base64Image argument')
      }
      // strip data URL prefix if present
      const base64 = args.base64Image.replace(/^data:[^;]+;base64,/, '')
      const buffer = Buffer.from(base64, 'base64')
      const image = await Jimp.read(buffer)
      const { data, width, height } = image.bitmap
      const result = jsqr(new Uint8ClampedArray(data.buffer), width, height)
      if (!result) {
        throw new Error('decode_qrcode failed: no QR code detected in the image')
      }
      return { text: result.data }
    })
  }
}

export function onUnload() {
  console.log('[qrcode-helper] 插件已卸载')
  if (mulby?.tools) {
    mulby.tools.unregister('generate_qrcode')
    mulby.tools.unregister('decode_qrcode')
  }
}

export function onEnable() {
  console.log('[qrcode-helper] 插件已启用')
}

export function onDisable() {
  console.log('[qrcode-helper] 插件已禁用')
}

export async function run(_context: PluginContext) {
  mulby.notification.show('插件已启动')
}

const plugin = { onLoad, onUnload, onEnable, onDisable, run }
export default plugin
