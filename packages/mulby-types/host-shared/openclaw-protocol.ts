/**
 * OpenClaw Gateway Protocol v3 — Mulby Node 端使用的类型子集
 *
 * 仅覆盖 Mulby 作为 Node 角色所需的帧类型，不包含 Operator/Channel 相关的定义。
 */

// ==================== 基础帧类型 ====================

/** Gateway 请求帧 */
export interface GatewayRequest {
  type: 'req'
  id: string
  method: string
  params?: Record<string, unknown>
}

/** Gateway 响应帧 */
export interface GatewayResponse {
  type: 'res'
  id: string
  ok: boolean
  payload?: Record<string, unknown>
  error?: GatewayError
}

/** Gateway 事件帧 */
export interface GatewayEvent {
  type: 'event'
  event: string
  payload?: Record<string, unknown>
  seq?: number
}

/** Gateway 错误对象 */
export interface GatewayError {
  code: string
  message: string
  details?: Record<string, unknown>
}

/** 所有帧类型的联合 */
export type GatewayFrame = GatewayRequest | GatewayResponse | GatewayEvent

// ==================== Node Connect 参数 ====================

/** Node 连接握手参数 */
export interface NodeConnectParams {
  minProtocol: number
  maxProtocol: number
  client: {
    id: string
    version: string
    platform: string
    mode: 'node'
    deviceFamily?: string
    displayName?: string
  }
  role: 'node'
  scopes: string[]
  caps: string[]
  commands: string[]
  permissions: Record<string, boolean>
  auth: {
    token?: string
    deviceToken?: string
  }
  locale: string
  userAgent: string
  device: {
    id: string
    publicKey: string
    signature: string
    signedAt: number
    nonce: string
  }
}

/** Hello-OK 响应（握手成功） */
export interface HelloOkPayload {
  protocol: number
  auth?: {
    deviceToken?: string
  }
  requiresPairing?: boolean
}

// ==================== Invoke 帧 ====================

/** Invoke 请求（Gateway → Node：命令调用） */
export interface InvokeParams {
  command: string
  params: Record<string, unknown>
}

/** Invoke 响应（Node → Gateway） */
export interface InvokeResult {
  ok: boolean
  data?: unknown
  error?: string
}

// ==================== Exec Approval ====================

/** 执行审批请求事件 */
export interface ExecApprovalRequest {
  id: string
  command: string
  args?: string[]
  cwd?: string
  rawCommand?: string
  agentId?: string
  resolvedPath?: string
  host: 'node'
}

/** 执行审批决策 */
export type ExecApprovalDecision = 'allow-once' | 'allow-always' | 'deny'

// ==================== 连接状态 ====================

/** Node 连接状态 */
export type NodeConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'pairing'
  | 'connected'
  | 'error'

/** 连接状态详情（用于 UI 展示） */
export interface NodeStatusInfo {
  status: NodeConnectionStatus
  gatewayHost?: string
  gatewayPort?: number
  nodeId?: string
  displayName?: string
  connectedAt?: number
  error?: string
  reconnectAttempt?: number
}
