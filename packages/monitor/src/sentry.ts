/**
 * Sentry 接入（设计文档 11.2）。
 *
 * `@sentry/vue` 必须**按需动态加载**：只有配置了 dsn 且不是 dev 环境才 import，
 * 保证纯浏览器开发时不下载、不执行 Sentry。
 */

type SentryConfig = {
  dsn: string
  environment: string
  release: string
}

type SentryModule = typeof import('@sentry/vue')

let sentry: SentryModule | null = null
let loading: Promise<SentryModule | null> | null = null

/** 是否已经完成 Sentry 初始化。 */
export function isSentryReady(): boolean {
  return sentry !== null
}

/**
 * 初始化 Sentry；没有 dsn 或处于 dev 时直接返回（不发请求、不加载包）。
 * 返回 Promise 便于测试等待，业务无需关心。
 */
export function initSentry(config: SentryConfig): Promise<void> {
  if (config.dsn === '' || config.environment === 'dev') return Promise.resolve()
  if (loading !== null) return loading.then(() => undefined)

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
      // Sentry 加载失败不影响业务，下次初始化可重试
      loading = null
      return null
    })
  return loading.then(() => undefined)
}

/** 上报异常；未初始化时静默。 */
export function sentryCapture(error: unknown, context?: Record<string, unknown>): void {
  if (sentry === null) return
  try {
    sentry.captureException(error, context === undefined ? undefined : { extra: context })
  } catch {
    // 监控自身异常不得影响业务
  }
}

/** 仅供测试：清空 Sentry 状态。 */
export function resetSentry(): void {
  sentry = null
  loading = null
}
