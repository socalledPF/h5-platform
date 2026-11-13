import type { BridgeResult } from './types'

/** 统一错误码，与 docs/bridge-protocol.md 的错误码表一一对应。 */
export const CODE = {
  OK: 0,
  NOT_FOUND: 1001,
  BAD_PARAMS: 1002,
  CANCELED: 1003,
  DENIED: 1004,
  TIMEOUT: -1,
  NOT_IN_APP: -2,
} as const

/** 错误码类型；允许原生新增码值，未识别的码原样透出。 */
export type BridgeCode = (typeof CODE)[keyof typeof CODE] | number

/** Bridge 调用失败；method 供监控按方法名聚合。 */
export class BridgeError extends Error {
  readonly code: number
  readonly method: string

  constructor(code: number, msg: string, method: string) {
    super(msg || `bridge call failed: ${method} (${code})`)
    this.name = 'BridgeError'
    this.code = code
    this.method = method
  }
}

/** Bridge 失败上报钩子签名。 */
export type BridgeErrorReporter = (method: string, code: number, msg: string) => void

let errorReporter: BridgeErrorReporter | null = null

/**
 * 注入 Bridge 失败上报（由 @h5/monitor / @h5/core 调用）。
 * bridge 自身不依赖监控包；传 null 可撤销上报。
 */
export function setBridgeErrorReporter(fn: BridgeErrorReporter | null): void {
  errorReporter = fn
}

/** 非 0 且非用户取消的结果统一上报（设计文档 11.2）；上报钩子异常不影响主流程。 */
export function reportBridgeError(method: string, code: number, msg: string): void {
  if (code === CODE.OK || code === CODE.CANCELED || errorReporter === null) return
  try {
    errorReporter(method, code, msg)
  } catch {
    // 上报钩子自身异常不得影响 Bridge 调用
  }
}

/** 校验原生回调载荷；非法载荷按参数错误处理，避免静默吞掉。 */
export function normalizeBridgeResult(value: unknown): BridgeResult<unknown> {
  if (typeof value === 'object' && value !== null && typeof readCode(value) === 'number') {
    const result = value as { code: number; data?: unknown; msg?: unknown }
    return {
      code: result.code,
      data: result.data,
      msg: typeof result.msg === 'string' ? result.msg : undefined,
    }
  }
  return { code: CODE.BAD_PARAMS, data: undefined, msg: 'invalid bridge result' }
}

function readCode(value: object): unknown {
  return (value as { code?: unknown }).code
}
