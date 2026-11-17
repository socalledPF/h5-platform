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
/**
 * 白屏检测：**可选能力，默认不启用**。`@h5/core` 的 `createH5App` 已内联一份等价检测，
 * 走 `createH5App` 挂载时它已经在跑；业务**不要同时启用两者**，否则同一次白屏会被上报
 * 两次、且两份 `recentErrors` 上下文互不一致。详见 `whitescreen.ts` 的说明。
 */
export { startWhiteScreenCheck } from './whitescreen'

export type { MonitorAdapterConfig } from './adapter'
export type { MonitorOptions, UidSource } from './state'
