/**
 * @h5/monitor —— 错误 / 性能 / 埋点上报（设计文档 11）。
 *
 * 可被 core 注入使用（`toMonitorAdapter()`），也可独立调用。
 * Sentry 只在配置 dsn 且非 dev 环境时动态加载。
 */

export { toMonitorAdapter } from './adapter'
export { captureError, installVueErrorHandlers, reportBridgeError } from './error'
export { initMonitor } from './init'
export { markFirstScreen, reportPerf } from './perf'
export { trackEvent, trackPageView } from './track'
export { startWhiteScreenCheck } from './whitescreen'

export type { MonitorAdapterConfig } from './adapter'
export type { MonitorOptions } from './state'
