import type { MonitorAdapter } from '@h5/core'
import { captureError, reportBridgeError } from './error'
import { initMonitor } from './init'
import { markFirstScreen, reportPerf } from './perf'
import { trackEvent } from './track'

/**
 * 把监控能力包成 core 的 `MonitorAdapter`（设计文档 4、11.2）。
 *
 * core 不能依赖 @h5/monitor，因此由业务注入：
 * ```ts
 * createH5App(App, { appId: 'member', router, monitor: toMonitorAdapter() })
 * ```
 */
export function toMonitorAdapter(): MonitorAdapter {
  return {
    init: (options) => {
      initMonitor({ appId: options.appId, env: options.env })
    },
    captureError,
    reportBridgeError,
    trackEvent,
    markFirstScreen,
    reportPerf,
  }
}
