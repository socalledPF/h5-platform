import type { MonitorAdapter } from '@h5/core'
import { captureError, reportBridgeError } from './error'
import { initMonitor } from './init'
import { markFirstScreen, markFirstScreenApi, reportPerf } from './perf'
import { markSessionEnd } from './state'
import { trackEvent } from './track'

/** 业务侧静态配置：core 的 init 只传 appId / env，其余上报参数必须在这里给出。 */
export interface MonitorAdapterConfig {
  /** Sentry DSN；缺省时不加载 Sentry。 */
  dsn?: string
  /** 性能采样率（0–1）。 */
  sampleRate?: number
  /** false 时全部上报静默。 */
  enabled?: boolean
}

/**
 * 把监控能力包成 core 的 `MonitorAdapter`（设计文档 4、11.2）。
 *
 * core 不能依赖 @h5/monitor，因此由业务注入：
 * ```ts
 * createH5App(App, { appId: 'member', router, monitor: toMonitorAdapter() })
 * // 需要 Sentry 时把构建期变量一起传进来
 * createH5App(App, { appId: 'member', router,
 *   monitor: toMonitorAdapter({ dsn: import.meta.env.VITE_SENTRY_DSN }) })
 * ```
 *
 * `config` 为闭包内的静态配置，init 时与 core 传入的 appId / env 合并；
 * 不传参数时行为与不带参数调用完全一致。
 */
export function toMonitorAdapter(config: MonitorAdapterConfig = {}): MonitorAdapter {
  return {
    init: (options) => {
      initMonitor({
        appId: options.appId,
        env: options.env,
        dsn: config.dsn,
        sampleRate: config.sampleRate,
        enabled: config.enabled,
      })
    },
    captureError,
    reportBridgeError,
    trackEvent,
    // 首屏阶段的属主是本包（perf.ts）：core 只触发一次 markFirstScreen 与首屏接口时刻，
    // 阶段拆分、顺序与采样都在这里一次性完成，避免一屏落地两套阶段。
    markFirstScreen,
    markFirstScreenApi,
    reportPerf,
    // 登录态转为“无会话”时 core 调用（401 刷新不调用）：丢弃本登录区间的假名，避免换账号串号。
    markSessionEnd,
  }
}
