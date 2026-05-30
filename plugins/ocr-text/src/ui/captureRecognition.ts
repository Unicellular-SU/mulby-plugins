type CaptureMulbyApi = {
  window: {
    hide: (isRestorePreWindow?: boolean) => void
    show: () => void
  }
  plugin: {
    run: (
      pluginId: string,
      featureCode: string,
      input?: string,
      launchStart?: number
    ) => Promise<{ success: boolean; error?: string }>
  }
}

const OCR_PLUGIN_ID = 'ocr-text'
const OCR_CAPTURE_FEATURE = 'ocr'

export async function requestCaptureRecognition(
  mulby: CaptureMulbyApi
): Promise<{ success: boolean; error?: string }> {
  mulby.window.hide(true)

  try {
    const result = await mulby.plugin.run(OCR_PLUGIN_ID, OCR_CAPTURE_FEATURE)
    if (!result.success) {
      mulby.window.show()
    }
    return result
  } catch (error) {
    mulby.window.show()
    throw error
  }
}
