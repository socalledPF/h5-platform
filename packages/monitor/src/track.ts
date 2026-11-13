import { track as bridgeTrack } from '@h5/bridge'
import { commonFields, isEnabled, record } from './state'

/**
 * 埋点（设计文档 11.3）：优先走 App 的埋点 SDK（`track.event`），
 * 保证与原生埋点在同一用户会话、口径一致；不在 App 内时由 bridge mock 兜底。
 * 埋点不做采样。
 */
export function trackEvent(name: string, params?: Record<string, unknown>): void {
  if (!isEnabled() || typeof name !== 'string' || name === '') return
  const payload: Record<string, unknown> = { ...commonFields(), ...(params ?? {}) }
  record('track', name, payload, true)
  void bridgeTrack.event(name, payload).catch(() => undefined)
}

/** 页面曝光（router.afterEach / usePageShow 使用）。 */
export function trackPageView(path: string): void {
  trackEvent('page_view', { path })
}
