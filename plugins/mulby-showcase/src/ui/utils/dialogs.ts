type ShowcaseDialog = Pick<MulbyDialog, 'showMessageBox'>

export async function confirmDialog(
  dialog: ShowcaseDialog,
  options: {
    title: string
    message: string
    detail?: string
    confirmLabel?: string
    cancelLabel?: string
    type?: 'question' | 'warning' | 'error' | 'info'
  }
) {
  const result = await dialog.showMessageBox({
    type: options.type || 'warning',
    title: options.title,
    message: options.message,
    detail: options.detail,
    buttons: [options.cancelLabel || '取消', options.confirmLabel || '确认'],
    defaultId: 0,
    cancelId: 0,
  })

  return result.response === 1
}

export async function showErrorDialog(
  dialog: ShowcaseDialog,
  options: {
    title: string
    message: string
    detail?: string
    buttonLabel?: string
  }
) {
  return dialog.showMessageBox({
    type: 'error',
    title: options.title,
    message: options.message,
    detail: options.detail,
    buttons: [options.buttonLabel || '知道了'],
    defaultId: 0,
    cancelId: 0,
  })
}
