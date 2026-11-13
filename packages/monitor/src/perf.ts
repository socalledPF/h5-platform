import { track as bridgeTrack } from '@h5/bridge'
import { commonFields, isEnabled, perfSampleRate, record, shouldSample } from './state'

/** 模块求值时刻 ≈ JS 开始执行（相对导航起点）。 */
const JS_START_MS = nowMs()
let firstScreenApiAt: number | null = null
let firstScreenReported = false

/**
 * 上报性能阶段耗时（设计文档 10.1、11.2）：按 sampleRate 采样（默认 15%）。
 *
 * 未命中采样时只留在本地记录里（便于排查），不上报；
 * 上报通道复用 App 的埋点 SDK（`track.event('perf', …)`），因为仓库内没有独立的性能上报域名。
 */
export function reportPerf(stage: string, durationMs: number): void {
  if (!isEnabled()) return
  if (typeof stage !== 'string' || stage === '') return
  emitPerf(stage, normalizeDuration(durationMs), shouldSample(perfSampleRate()))
}

/**
 * 首屏完成打点（设计文档 10.1）：
 * 记录 HTML 到达 / JS 开始 / 首屏接口返回 / 渲染完成，并逐阶段上报。
 * 一批阶段共用一个采样结果，避免首屏数据被拆成半份。
 */
export function markFirstScreen(): void {
  if (!isEnabled() || firstScreenReported) return
  firstScreenReported = true
  markPerformance('h5:first-screen')
  const sampled = shouldSample(perfSampleRate())
  for (const [stage, duration] of firstScreenStages()) emitPerf(stage, duration, sampled)
}

/** 首次首屏接口返回时刻（由 core 的请求层触发）。 */
export function markFirstScreenApi(): void {
  if (firstScreenApiAt === null) firstScreenApiAt = nowMs()
}

/** 首屏各阶段耗时；取不到的阶段直接跳过，不上报 0。 */
export function firstScreenStages(): [string, number][] {
  const stages: [string, number][] = []
  const htmlReady = readHtmlReadyMs()
  if (htmlReady !== null) stages.push(['html-ready', htmlReady])
  stages.push(['js-start', round(JS_START_MS)])
  if (firstScreenApiAt !== null) {
    stages.push(['first-screen-api', round(firstScreenApiAt - JS_START_MS)])
  }
  stages.push(['render-done', round(nowMs() - JS_START_MS)])
  return stages
}

function emitPerf(stage: string, durationMs: number, sampled: boolean): void {
  const payload: Record<string, unknown> = { ...commonFields(), stage, durationMs }
  record('perf', stage, payload, sampled)
  if (!sampled) return
  void bridgeTrack.event('perf', payload).catch(() => undefined)
}

function normalizeDuration(durationMs: number): number {
  return Number.isFinite(durationMs) ? Math.max(0, Math.round(durationMs)) : 0
}

function nowMs(): number {
  try {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
      return performance.now()
    }
  } catch {
    // 退化到 Date.now
  }
  return Date.now()
}

function readHtmlReadyMs(): number | null {
  try {
    if (typeof performance === 'undefined') return null
    const entries = performance.getEntriesByType?.('navigation')
    const navigation = entries?.[0] as PerformanceNavigationTiming | undefined
    if (navigation !== undefined && typeof navigation.responseEnd === 'number') {
      return round(navigation.responseEnd)
    }
  } catch {
    // 老容器不支持 navigation timing
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

/** 仅供测试：重置首屏打点状态。 */
export function resetPerf(): void {
  firstScreenApiAt = null
  firstScreenReported = false
}
