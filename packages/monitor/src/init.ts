import { device as bridgeDevice, on } from '@h5/bridge'
import { installGlobalErrorHandlers } from './error'
import { initSentry } from './sentry'
import { configure, h5Version, type MonitorOptions, setNetwork } from './state'

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
    release: sentryRelease(options.appId),
  })
}

/**
 * Sentry 的 `release` 用 **H5 构建版本**（`appId@__APP_VERSION__`），不用原生 App 版本。
 *
 * - 能部署、能回滚的是 H5 包：`release` 要能对应到“我该回滚到哪个构建”。
 * - 原生版本不可靠且不稳定：`env.appVersion` 在原生 `appInfo` 缺失/超时（800ms）时退回
 *   构建版本，同一份 H5 会因一次超时被分到两个 release 上，Sentry 的 issue 归组随之断裂。
 * - 原生版本并没有丢：它在每条上报的公共字段 `appVersion` 里，随事件进 Sentry 的 extra，
 *   仍可按 App 版本检索；两个字段各司其职，不互相兜底。
 */
function sentryRelease(appId: string): string {
  return `${appId}@${h5Version()}`
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
