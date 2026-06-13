/// <reference path="./types/mulby.d.ts" />
declare const mulby: any

const SWIFT_OCR_SOURCE = `
import Vision
import AppKit

let imagePath = CommandLine.arguments[1]
guard let data = try? Data(contentsOf: URL(fileURLWithPath: imagePath)),
      let image = NSImage(data: data),
      let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
    fputs("ERROR: Cannot load image", stderr)
    exit(1)
}

let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.recognitionLanguages = ["zh-Hans", "zh-Hant", "en", "ja", "ko", "fr", "de", "es", "pt", "it"]
request.usesLanguageCorrection = true

let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
try handler.perform([request])

guard let observations = request.results else { exit(0) }
for observation in observations {
    if let topCandidate = observation.topCandidates(1).first {
        print(topCandidate.string)
    }
}
`

let cachedBinaryPath: string | null = null

function base64ToUint8Array(base64: string): Uint8Array {
  const binaryString = atob(base64)
  const bytes = new Uint8Array(binaryString.length)
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i)
  }
  return bytes
}

export function onLoad() { console.log('[ocr-text] 插件已加载') }
export function onUnload() { console.log('[ocr-text] 插件已卸载') }
export function onEnable() { console.log('[ocr-text] 插件已启用') }
export function onDisable() { console.log('[ocr-text] 插件已禁用') }

export async function run(_context: BackendPluginContext) {
  await mulby.window.setAlwaysOnTop?.(false)
}

export const rpc = {
  async nativeOcr(imageBase64: string, mimeType: string) {
    try {
      const platform = await getPlatform()
      const tmpDir = await mulby.system.getPath('temp')
      const ext = mimeType.includes('jpeg') || mimeType.includes('jpg') ? 'jpg' : 'png'
      const imagePath = `${tmpDir}/mulby_ocr_${Date.now()}.${ext}`

      const raw = base64ToUint8Array(imageBase64)
      await mulby.filesystem.writeFile(imagePath, raw)

      let text = ''

      if (platform === 'darwin') {
        text = await macOSOcr(imagePath, tmpDir)
      } else if (platform === 'win32') {
        text = await windowsOcr(imagePath)
      } else {
        await cleanup(imagePath)
        return { success: false, text: '', error: 'Linux 暂不支持原生 OCR，请切换到 AI 模式', platform }
      }

      await cleanup(imagePath)
      return { success: true, text: text.trim(), platform }
    } catch (error: any) {
      return { success: false, text: '', error: error?.message || '原生 OCR 识别失败', platform: 'unknown' }
    }
  },

  async getPlatformInfo() {
    const platform = await getPlatform()
    return { platform }
  },
}

async function getPlatform(): Promise<string> {
  const info = await mulby.system.getSystemInfo()
  return info?.platform || 'unknown'
}

async function ensureCompiledBinary(tmpDir: string): Promise<string> {
  if (cachedBinaryPath) {
    const exists = await mulby.filesystem.exists(cachedBinaryPath)
    if (exists) return cachedBinaryPath
  }

  const binaryPath = `${tmpDir}/mulby_ocr_bin`
  const exists = await mulby.filesystem.exists(binaryPath)
  if (exists) {
    cachedBinaryPath = binaryPath
    return binaryPath
  }

  const srcPath = `${tmpDir}/mulby_ocr_src_${Date.now()}.swift`
  await mulby.filesystem.writeFile(srcPath, SWIFT_OCR_SOURCE, 'utf-8')

  try {
    const result = await mulby.shell.runCommand({
      command: 'swiftc',
      args: ['-O', srcPath, '-o', binaryPath],
      timeoutMs: 60000,
    })

    await cleanup(srcPath)

    if (result.exitCode !== 0) {
      throw new Error(result.stderr || 'Swift 编译失败')
    }

    cachedBinaryPath = binaryPath
    return binaryPath
  } catch (error) {
    await cleanup(srcPath)
    throw error
  }
}

async function macOSOcr(imagePath: string, tmpDir: string): Promise<string> {
  try {
    const binaryPath = await ensureCompiledBinary(tmpDir)

    const result = await mulby.shell.runCommand({
      command: binaryPath,
      args: [imagePath],
      timeoutMs: 15000,
    })

    if (result.exitCode !== 0) {
      throw new Error(result.stderr || 'OCR 执行失败')
    }

    return result.stdout || ''
  } catch {
    return await macOSOcrFallback(imagePath, tmpDir)
  }
}

async function macOSOcrFallback(imagePath: string, tmpDir: string): Promise<string> {
  const scriptPath = `${tmpDir}/mulby_ocr_fb_${Date.now()}.swift`
  await mulby.filesystem.writeFile(scriptPath, SWIFT_OCR_SOURCE, 'utf-8')

  try {
    const result = await mulby.shell.runCommand({
      command: 'swift',
      args: [scriptPath, imagePath],
      timeoutMs: 30000,
    })

    await cleanup(scriptPath)

    if (result.exitCode !== 0) {
      throw new Error(result.stderr || 'macOS OCR 执行失败')
    }

    return result.stdout || ''
  } catch (error) {
    await cleanup(scriptPath)
    throw error
  }
}

async function windowsOcr(imagePath: string): Promise<string> {
  // WinRT 的 StorageFile.GetFileFromPathAsync 只接受反斜杠分隔的绝对路径。
  // 后端用 `${tmpDir}/mulby_ocr_...` 拼接路径，在 Windows 上会得到
  // `C:\...\Temp/mulby_ocr_x.png` 这种正/反斜杠混用的路径，正斜杠会让
  // GetFileFromPathAsync 抛 "One or more errors occurred."，必须先归一化为反斜杠。
  const winPath = imagePath.replace(/\//g, '\\')
  // 识别结果写入独立的 UTF-8 文件后由 Node 侧读取，避免 PowerShell 控制台
  // 默认使用系统 ANSI/OEM 代码页输出、而宿主按 UTF-8 解码 stdout 造成中文乱码。
  const outPath = `${winPath}.ocr.txt`
  const psImagePath = winPath.replace(/'/g, "''")
  const psOutPath = outPath.replace(/'/g, "''")

  // 关键修复：Await 必须显式传入 IAsyncOperation 的结果类型并调用
  // MakeGenericMethod(resultType)。原实现用 $WinRTTask.GetType().GetGenericArguments()
  // 自动推导，但 WinRT 投影对象在 PowerShell 中是 __ComObject，反射返回 0 个泛型参数，
  // 导致 MakeGenericMethod 抛 "0 generic arguments" 而每次识别都失败。
  const psScript = `
$ErrorActionPreference = 'Stop'
$imagePath = '${psImagePath}'
$outPath = '${psOutPath}'
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  [Windows.Media.Ocr.OcrEngine,Windows.Foundation,ContentType=WindowsRuntime] | Out-Null
  [Windows.Graphics.Imaging.BitmapDecoder,Windows.Foundation,ContentType=WindowsRuntime] | Out-Null
  [Windows.Storage.StorageFile,Windows.Foundation,ContentType=WindowsRuntime] | Out-Null
  $asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' })[0]
  function Await($WinRtTask, $ResultType) {
    $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
    $netTask = $asTask.Invoke($null, @($WinRtTask))
    $netTask.Wait(-1) | Out-Null
    $netTask.Result
  }
  $ocr = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
  if ($null -eq $ocr) { throw 'NO_OCR_LANGUAGE' }
  $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($imagePath)) ([Windows.Storage.StorageFile])
  $stream = Await ($file.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
  $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
  $bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
  $result = Await ($ocr.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
  [System.IO.File]::WriteAllText($outPath, $result.Text, (New-Object System.Text.UTF8Encoding($false)))
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}
  `.trim()

  try {
    const result = await mulby.shell.runCommand({
      command: 'powershell',
      args: ['-NoProfile', '-NonInteractive', '-Command', psScript],
      timeoutMs: 30000,
      shell: false,
    })

    if (result.exitCode !== 0) {
      const stderr = (result.stderr || '').trim()
      if (stderr.includes('NO_OCR_LANGUAGE')) {
        throw new Error('未检测到 OCR 语言包：请在 Windows 设置 → 时间和语言 → 语言和区域中，为当前语言安装“光学字符识别 (OCR)”可选功能，或切换到 AI 模式。')
      }
      throw new Error(stderr || 'Windows OCR 执行失败')
    }

    const text = await mulby.filesystem.readFile(outPath, 'utf-8')
    return typeof text === 'string' ? text : ''
  } finally {
    await cleanup(outPath)
  }
}

async function cleanup(path: string) {
  try { await mulby.filesystem.unlink(path) } catch {}
}

export const host = {}
const plugin = { onLoad, onUnload, onEnable, onDisable, run, rpc, host }
export default plugin
