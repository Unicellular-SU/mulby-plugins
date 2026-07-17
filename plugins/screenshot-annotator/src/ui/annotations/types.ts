// 标注领域类型定义（从 App.tsx 搬移，保持原样）。

export type Tool =
  | 'select'
  | 'line'
  | 'rect'
  | 'ellipse'
  | 'arrow'
  | 'pen'
  | 'highlighter'
  | 'text'
  | 'step'
  | 'mosaic'
  | 'blur'
  | 'crop'
  | 'eraser'

export type Point = {
  x: number
  y: number
}

export type Rect = {
  x: number
  y: number
  width: number
  height: number
}

export type StrokeAnnotation = {
  id: string
  type: 'pen' | 'highlighter'
  points: Point[]
  color: string
  size: number
}

export type ShapeAnnotation = {
  id: string
  type: 'line' | 'rect' | 'ellipse' | 'arrow'
  start: Point
  end: Point
  color: string
  size: number
}

export type TextAnnotation = {
  id: string
  type: 'text'
  point: Point
  text: string
  color: string
  size: number
  boxWidth?: number
}

export type StepAnnotation = {
  id: string
  type: 'step'
  point: Point
  value: string
  color: string
  size: number
}

export type EffectAnnotation = {
  id: string
  type: 'mosaic' | 'blur'
  start: Point
  end: Point
  color: string
  size: number
}

export type Annotation = StrokeAnnotation | ShapeAnnotation | TextAnnotation | StepAnnotation | EffectAnnotation

export type CaptureRegion = {
  x: number
  y: number
  width: number
  height: number
  scaleFactor?: number
}

export type PluginAttachment = {
  id: string
  name: string
  kind: 'file' | 'image'
  path?: string
  dataUrl?: string
  mime?: string
  capture?: {
    type: 'region' | 'fullscreen'
    region?: CaptureRegion
    display?: {
      scaleFactor?: number
    }
  }
}

export type PluginInitData = {
  featureCode: string
  input?: string
  route?: string
  attachments?: PluginAttachment[]
}

export type AppMode = 'annotate' | 'history'

export type LoadedImage = {
  dataUrl: string
  element: HTMLImageElement
  width: number
  height: number
  region?: CaptureRegion
  capture?: PluginAttachment['capture']
  displaySize?: DisplaySize
  scaleFactor: number
}

export type PendingPreview = {
  dataUrl: string
  displayWidth: number
  displayHeight: number
}

export type DisplaySize = {
  width: number
  height: number
}

export type InlineTextEdit = {
  id: string
  point: Point
  text: string
  color: string
  size: number
  boxWidth: number
  insertIndex: number
}

export type InlineStepEdit = {
  id: string
  point: Point
  value: string
  color: string
  size: number
}

export type ResizeHandle =
  | 'resize-n'
  | 'resize-ne'
  | 'resize-e'
  | 'resize-se'
  | 'resize-s'
  | 'resize-sw'
  | 'resize-w'
  | 'resize-nw'

export type EditHandleMode = 'move' | 'line-start' | 'line-end' | 'text-width' | ResizeHandle

export type EditHandle = {
  id: string
  mode: EditHandleMode
}

export type EditDragState = EditHandle & {
  pointerId: number
  startPoint: Point
  snapshot: Annotation
  annotationsSnapshot: Annotation[]
  moved: boolean
}
