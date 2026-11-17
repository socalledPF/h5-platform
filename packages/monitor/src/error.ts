import { isReportableBridgeFailure } from '@h5/bridge'
import type { App } from 'vue'
import { sentryCapture } from './sentry'
import {
  commonFields,
  errorMessage,
  isEnabled,
  pushRecentError,
  record,
  recentErrorText,
} from './state'

let globalHandlersInstalled = false

/**
 * 采集 JS 错误（设计文档 11.2）：错误全量上报（不采样），并带上公共字段。
 * 任何采集异常都不得影响业务。
 */
export function captureError(error: unknown, context?: Record<string, unknown>): void {
  if (!isEnabled()) return
  const message = errorMessage(error)
  pushRecentError(message)
  const payload: Record<string, unknown> = {
    ...commonFields(),
    message,
    stack: error instanceof Error ? (error.stack ?? '') : '',
    ...context,
  }
  record('error', 'js_error', payload, true)
  sentryCapture(error, payload)
}

/**
 * 安装 Vue 与全局错误处理（设计文档 11.2）：
 * `app.config.errorHandler`、`window.onerror`、`unhandledrejection`、
 * 资源加载失败（`error` 事件的捕获阶段）。
 */
export function installVueErrorHandlers(app: App): void {
  app.config.errorHandler = (error: unknown, _instance: unknown, info: string) => {
    captureError(error, { source: 'vue', info })
  }
  installGlobalErrorHandlers()
}

/**
 * 安装 window 级错误监听（`error` 捕获阶段 + `unhandledrejection`）。
 * initMonitor 会先装一次，保证业务不调用 installVueErrorHandlers 也能收到窗口错误；
 * 重复调用是幂等的。
 */
export function installGlobalErrorHandlers(): void {
  if (globalHandlersInstalled || typeof window === 'undefined') return
  globalHandlersInstalled = true
  window.addEventListener('error', handleErrorEvent, true)
  window.addEventListener('unhandledrejection', handleRejectionEvent)
}

function handleErrorEvent(event: Event): void {
  const target = event.target
  // 资源加载失败（img / script / link）在捕获阶段以 Event 形式冒上来，没有 message
  if (target !== null && target !== window && typeof (target as Element).tagName === 'string') {
    const element = target as Element
    captureError(new Error(`资源加载失败: ${element.tagName.toLowerCase()}`), {
      source: 'resource',
      url: readResourceUrl(element),
    })
    return
  }
  const errorEvent = event as ErrorEvent
  captureError(errorEvent.error ?? errorEvent.message ?? 'window error', {
    source: 'window.onerror',
    filename: errorEvent.filename ?? '',
    lineno: errorEvent.lineno ?? 0,
    colno: errorEvent.colno ?? 0,
  })
}

function handleRejectionEvent(event: Event): void {
  const reason = (event as PromiseRejectionEvent).reason
  captureError(reason ?? 'unhandled rejection', { source: 'unhandledrejection' })
}

function readResourceUrl(element: Element): string {
  const source = element as Element & { src?: unknown; href?: unknown }
  if (typeof source.src === 'string') return source.src
  if (typeof source.href === 'string') return source.href
  return ''
}

/** 白屏上报要附带最近的 JS 错误。 */
export function recentErrors(): string {
  return recentErrorText()
}

/** 仅供测试：卸载全局监听。 */
export function resetErrorHandlers(): void {
  if (!globalHandlersInstalled || typeof window === 'undefined') return
  window.removeEventListener('error', handleErrorEvent, true)
  window.removeEventListener('unhandledrejection', handleRejectionEvent)
  globalHandlersInstalled = false
}

/**
 * Bridge 失败上报（设计文档 11.2、12.2）：
 * 成功、用户取消、不在 App 内都不算失败，其余结果统一上报，用于发现客户端兼容问题。
 * 用户取消是正常交互，不该进入告警；不在 App 内是「运行环境」事实（未配 mock 的浏览器 /
 * 未注入 bridge 的 WebView 每次启动都会产生），同样不进指标。
 *
 * 过滤口径**直接复用** `@h5/bridge` 的 `isReportableBridgeFailure()`（排除集在该包内私有，
 * 故意不导出：可变引用会被外部改写，让两侧口径以最难查的方式漂移）。两侧共用一份实现，
 * §11.2 的客户端兼容性指标就不会被单边污染。
 *
 * 注意（容易误判成死代码）：bridge 在调用注入的上报钩子**之前**就已经用同一口径过滤过，
 * 所以对「来自 bridge 的码」这层守卫是冗余的。它不是冗余代码，价值在于覆盖从**其它入口**
 * 进来的码——monitor 自己捕获的错误、以及将来直连原生回调 / 事件的上报路径，都可能带着
 * `-2` 之类的结果码直接进到这里。
 */
export function reportBridgeError(method: string, code: number, msg: string): void {
  if (!isEnabled()) return
  if (!isReportableBridgeFailure(code)) return
  const payload: Record<string, unknown> = {
    ...commonFields(),
    method,
    code,
    msg,
  }
  record('bridge', method, payload, true)
  sentryCapture(new Error(`bridge call failed: ${method} (${code}) ${msg}`.trim()), payload)
}
