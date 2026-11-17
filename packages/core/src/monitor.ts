import type { MonitorAdapter } from './types'

/**
 * core 侧的监控注入点（设计文档 11.2）。
 *
 * 层序是 bridge <- core <- (ui | hooks | monitor)，core 不能 import @h5/monitor，
 * 因此这里只声明接口，由业务把 `toMonitorAdapter()` 传进 createH5App。
 */
let adapter: MonitorAdapter | undefined

/** 注入监控实现；传 undefined 撤销（用于测试与多实例场景）。 */
export function setMonitorAdapter(next: MonitorAdapter | undefined): void {
  adapter = next
}

/** 当前注入的监控实现（可能为 undefined）。 */
export function getMonitorAdapter(): MonitorAdapter | undefined {
  return adapter
}

/** 最近错误的环形缓冲：白屏上报要能带上它（设计文档 11.2）。 */
const MAX_RECENT_ERRORS = 10
const recentErrors: string[] = []

export function rememberError(error: unknown): void {
  recentErrors.push(toMessage(error))
  if (recentErrors.length > MAX_RECENT_ERRORS) recentErrors.shift()
}

export function recentErrorMessages(): string[] {
  return [...recentErrors]
}

/** 上报异常；未注入监控实现时静默，绝不影响主流程。 */
export function monitorError(error: unknown, context?: Record<string, unknown>): void {
  rememberError(error)
  try {
    adapter?.captureError?.(error, context)
  } catch {
    // 上报实现自身异常不得影响业务
  }
}

/** 埋点上报；未注入时静默。 */
export function monitorTrack(name: string, params?: Record<string, unknown>): void {
  try {
    adapter?.trackEvent?.(name, params)
  } catch {
    // 同上
  }
}

function toMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

/* -------------------------------- 首屏打点（设计文档 10.1） -------------------------------- */

/**
 * 首屏阶段的**唯一属主**是 @h5/monitor：`markFirstScreen` 一次性产出整套阶段，
 * 整批阶段共用同一个采样结果。core 只负责触发（外加一个本地 performance 标记），
 * 不再自己拆阶段、也不再逐阶段 `reportPerf`——否则一屏会落地两套阶段、两套采样口径，
 * §10.1 的 P50/P90 无法对齐。
 */
let firstScreenMarked = false

/** 首屏接口返回时刻：交给监控实现记账（`markFirstScreen` 时一并产出该阶段）。 */
export function markFirstScreenApi(): void {
  try {
    adapter?.markFirstScreenApi?.()
  } catch {
    // 上报实现自身异常不得影响业务
  }
}

/**
 * 首屏渲染完成（业务在首屏数据渲染后调用）：
 * 打一个本地 performance 标记便于排查，并把整批阶段的打点交给监控实现（只调一次）。
 */
export function markFirstScreen(): void {
  if (firstScreenMarked) return
  firstScreenMarked = true
  markPerformance('h5:first-screen')
  try {
    adapter?.markFirstScreen?.()
  } catch {
    // 同上
  }
}

function markPerformance(name: string): void {
  try {
    if (typeof performance !== 'undefined' && typeof performance.mark === 'function') {
      performance.mark(name)
    }
  } catch {
    // 忽略
  }
}

/** 仅供测试：重置首屏打点与错误缓冲。 */
export function resetMonitorState(): void {
  adapter = undefined
  recentErrors.length = 0
  firstScreenMarked = false
}
