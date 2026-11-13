import { device as bridgeDevice, on } from '@h5/bridge'
import { installGlobalErrorHandlers } from './error'
import { initSentry } from './sentry'
import { configure, type MonitorOptions, setNetwork } from './state'

/** 是否已初始化，避免重复订阅原生事件。 */
let initialized = false
let unsubscribeNetwork: (() => void) | null = null

/**
 * 初始化监控（设计文档 11.2）：
 * 记录公共字段来源、订阅网络变化、按需懒加载 Sentry。
 *
 * 没有 dsn 时**仍然记录**（本地缓冲 + 埋点），只是不往 Sentry 发送；
 * `enabled: false` 才会整体静默。
 */
export function initMonitor(options: MonitorOptions): void {
  configure(options)
  if (!initialized) {
    initialized = true
    subscribeNetwork()
    // 窗口级错误不依赖业务是否调用 installVueErrorHandlers（设计文档 11.2）
    installGlobalErrorHandlers()
  }
  refreshNetwork()
  void initSentry({
    dsn: options.dsn ?? '',
    environment: resolveEnvironment(options),
    release: `${options.appId}@${options.env.appVersion || '0.0.0'}`,
  })
}

function resolveEnvironment(options: MonitorOptions): string {
  if (options.env.isProd) return 'prod'
  if (options.env.isPre) return 'pre'
  if (options.env.isTest) return 'test'
  return 'dev'
}

/** 原生 network.change 推送更新公共字段里的网络类型。 */
function subscribeNetwork(): void {
  try {
    unsubscribeNetwork = on('network.change', (info) => {
      setNetwork(typeof info?.type === 'string' ? info.type : 'unknown')
    })
  } catch {
    unsubscribeNetwork = null
  }
}

/** 启动时拉一次网络类型；失败按 unknown 处理。 */
function refreshNetwork(): void {
  void bridgeDevice
    .getNetwork()
    .then((info) => {
      setNetwork(typeof info.type === 'string' ? info.type : 'unknown')
    })
    .catch(() => undefined)
}

/** 仅供测试：解除原生事件订阅。 */
export function resetMonitorRuntime(): void {
  unsubscribeNetwork?.()
  unsubscribeNetwork = null
  initialized = false
}
