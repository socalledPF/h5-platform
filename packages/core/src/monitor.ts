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

/** 性能上报；未注入时静默。 */
function monitorPerf(stage: string, durationMs: number): void {
  try {
    adapter?.reportPerf?.(stage, durationMs)
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

/** 模块求值时刻 ≈ JS 执行开始（相对导航起点）。 */
const JS_START_MS = now()
let firstScreenApiAt: number | null = null
let firstScreenMarked = false

function now(): number {
  try {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
      return performance.now()
    }
  } catch {
    // 退化到 Date.now
  }
  return Date.now()
}

/** 首个接口返回时刻；只有第一次有效。 */
export function markFirstScreenApi(): void {
  if (firstScreenApiAt === null) firstScreenApiAt = now()
}

/**
 * 首屏渲染完成（业务在首屏数据渲染后调用）：
 * 记录 HTML 到达 / JS 开始 / 首屏接口返回 / 渲染完成四个阶段并上报，
 * 同时把首屏标记交给注入的监控实现（Sentry / 打点）。
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
  for (const [stage, duration] of firstScreenStages()) monitorPerf(stage, duration)
}

/** 各阶段耗时（毫秒）；拿不到的值直接跳过，不上报 0。 */
export function firstScreenStages(): [string, number][] {
  const stages: [string, number][] = []
  const htmlReady = readHtmlReadyMs()
  if (htmlReady !== null) stages.push(['html-ready', htmlReady])
  stages.push(['js-start', round(JS_START_MS)])
  if (firstScreenApiAt !== null)
    stages.push(['first-screen-api', round(firstScreenApiAt - JS_START_MS)])
  stages.push(['render-done', round(now() - JS_START_MS)])
  return stages
}

/** HTML 到达时刻：优先用 PerformanceNavigationTiming，退化到 performance.timing。 */
function readHtmlReadyMs(): number | null {
  try {
    if (typeof performance === 'undefined') return null
    const entries = performance.getEntriesByType?.('navigation')
    const navigation = entries?.[0] as PerformanceNavigationTiming | undefined
    if (navigation !== undefined && typeof navigation.responseEnd === 'number') {
      return round(navigation.responseEnd)
    }
    const timing = (performance as Performance & { timing?: PerformanceTiming }).timing
    if (timing !== undefined && timing.navigationStart > 0) {
      return round(timing.responseEnd - timing.navigationStart)
    }
  } catch {
    // 老容器可能没有 performance 条目
  }
  return null
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

function round(value: number): number {
  return Math.max(0, Math.round(value))
}

/** 仅供测试：重置首屏打点与错误缓冲。 */
export function resetMonitorState(): void {
  adapter = undefined
  recentErrors.length = 0
  firstScreenApiAt = null
  firstScreenMarked = false
}
