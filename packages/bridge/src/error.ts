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

/**
 * 不上报的错误码（模块私有）。
 *
 * 只对外暴露判定函数 `isReportableBridgeFailure()`，不导出这个集合本身：
 * 集合是可变引用，一旦被外部改写，两侧口径会以最难查的方式漂移。
 */
const UNREPORTED_CODES: ReadonlySet<number> = new Set([CODE.OK, CODE.CANCELED, CODE.NOT_IN_APP])

/**
 * 该错误码是否计入 §11.2 客户端兼容性指标——bridge 与 @h5/monitor 共用的**唯一口径**。
 *
 * monitor 侧必须 import 本函数做过滤决策，禁止各自维护一份排除集（两份真值迟早漂移）。
 * 纯函数：无副作用、不触发上报、不依赖通道状态，只回答「这个码算不算客户端问题」。
 *
 * - `0` 成功、`1003` 用户取消：都不是失败；
 * - `-2` 不在 App 内：属「运行环境事实」——未配 mock 的浏览器、未注入桥的 WebView
 *   每次启动都会产生，不是客户端兼容性问题，计入指标只会灌噪声；
 * - `1001`（方法不存在）必须计入：那是「App 版本过旧」的真信号；
 * - 未识别的原生新码一律计入：宁可多报，不可漏掉真信号。
 */
export function isReportableBridgeFailure(code: number): boolean {
  return !UNREPORTED_CODES.has(code)
}

/** 可上报的失败统一上报（设计文档 11.2，口径见 isReportableBridgeFailure）；上报钩子异常不影响主流程。 */
export function reportBridgeError(method: string, code: number, msg: string): void {
  if (!isReportableBridgeFailure(code) || errorReporter === null) return
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
