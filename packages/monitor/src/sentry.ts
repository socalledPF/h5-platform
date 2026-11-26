/**
 * Sentry 接入（设计文档 11.2）。
 *
 * `@sentry/vue` 必须**按需动态加载**：只有配置了 dsn 且不是 dev 环境才 import，
 * 保证纯浏览器开发时不下载、不执行 Sentry。
 */

import {
  commonFields,
  enqueuePendingCapture,
  getState,
  isEnabled,
  takePendingCaptures,
} from './state'

type SentryConfig = {
  dsn: string
  environment: string
  release: string
}

type SentryModule = typeof import('@sentry/vue')

let sentry: SentryModule | null = null
let loading: Promise<SentryModule | null> | null = null

/**
 * 这份配置下 Sentry 确定不会就绪（没 dsn / dev 环境）：待上报队列没有消费者，
 * 不再累积、也不再增长。只有加载失败（可重试）不设置它。
 */
let captureUnavailable = false

/** 是否已经完成 Sentry 初始化。 */
export function isSentryReady(): boolean {
  return sentry !== null
}

/**
 * 此刻能否真的上报：Sentry 已就绪 **且** 公共字段来源已确定。
 *
 * 只看 `sentry !== null` 是不够的：启动期的 Bridge 失败（原生 `app.getInfo` 失败）发生在
 * `initEnv` 之前，那一刻 `state.env` 还是 null，`commonFields()` 只能产出空 appId 与 unknown，
 * 事件要么丢、要么带着错误的版本/机型进 Sentry —— §11.2 的客户端兼容性指标会系统性漏掉
 * 最老的那批客户端。所以未就绪时先入队，就绪后再按**当时的**公共字段补发。
 */
function canCaptureNow(): boolean {
  return sentry !== null && getState().env !== null
}

function captureNow(error: unknown, context?: Record<string, unknown>): void {
  if (sentry === null) return
  try {
    sentry.captureException(error, context === undefined ? undefined : { extra: context })
  } catch {
    // 监控自身异常不得影响业务
  }
}

/** 把待上报队列送进 Sentry：公共字段在**flush 时**重算，此时 appId / env 才是真实值。 */
function drainToSentry(): void {
  if (sentry === null) return
  // 先取走再捕获：队列在捕获之前就已经清空，重复 flush 不会重复上报
  const pending = takePendingCaptures()
  // 入队时 enabled 还是缺省值 true；`enabled: false` 必须整体静默，排队的事件同样丢弃
  if (!isEnabled()) return
  for (const entry of pending) {
    captureNow(entry.error, { ...entry.context, ...commonFields() })
  }
}

/**
 * 初始化 Sentry；没有 dsn 或处于 dev 时直接返回（不发请求、不加载包）。
 * 返回 Promise 便于测试等待，业务无需关心。初始化成功后补发启动期入队的异常。
 */
export function initSentry(config: SentryConfig): Promise<void> {
  if (config.dsn === '' || config.environment === 'dev') {
    // 永远不会就绪：启动期缓冲没有消费者，直接丢弃而不是攒到上限
    captureUnavailable = true
    takePendingCaptures()
    return Promise.resolve()
  }
  if (loading !== null) return loading.then(drainToSentry)

  loading = import('@sentry/vue')
    .then((mod) => {
      mod.init({
        dsn: config.dsn,
        environment: config.environment,
        release: config.release,
        tracesSampleRate: 0,
      })
      sentry = mod
      return mod
    })
    .catch(() => {
      // Sentry 加载失败不影响业务，下次初始化可重试；待上报队列保留给那次重试
      loading = null
      return null
    })
  return loading.then(drainToSentry)
}

/** 上报异常：已就绪时直接上报，否则进入有界待上报队列，等 initSentry 成功后补发。 */
export function sentryCapture(error: unknown, context?: Record<string, unknown>): void {
  if (canCaptureNow()) {
    captureNow(error, context)
    return
  }
  if (captureUnavailable) return
  enqueuePendingCapture({ error, context })
}

/** 仅供测试：清空 Sentry 状态。 */
export function resetSentry(): void {
  sentry = null
  loading = null
  captureUnavailable = false
  takePendingCaptures()
}
