import { CODE } from '@h5/bridge'
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
 * 非 0 且非用户取消（1003）的结果统一上报，用于发现客户端兼容问题。
 * 用户取消是正常交互，不应进入告警。
 */
export function reportBridgeError(method: string, code: number, msg: string): void {
  if (!isEnabled()) return
  if (code === CODE.OK || code === CODE.CANCELED) return
  const payload: Record<string, unknown> = {
    ...commonFields(),
    method,
    code,
    msg,
  }
  record('bridge', method, payload, true)
  sentryCapture(new Error(`bridge call failed: ${method} (${code}) ${msg}`.trim()), payload)
}
