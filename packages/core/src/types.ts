import type { MockAdapter, NavMode, NavTarget } from '@h5/bridge'
import type { Router } from 'vue-router'

/** 导航栏模式：原生渲染 / H5 自绘 / 全屏沉浸（设计文档 7.1）。 */
export type { NavMode }

/** 页面跳转目标，与 Bridge 协议一致（设计文档 7.4）。 */
export type { NavTarget }

/** 浏览器 mock 可注入的实现，由业务按需覆盖（设计文档 5.4）。 */
export type { MockAdapter }

/** 运行环境快照；`env` 对象在 createH5App / initEnv 时就地更新。 */
export interface AppEnv {
  isApp: boolean
  appId: string
  appVersion: string
  os: 'ios' | 'android' | 'web'
  osVersion: string
  device: string
  isDev: boolean
  isTest: boolean
  isPre: boolean
  isProd: boolean
  buildTime: string
  statusBarHeight: number
  safeAreaTop: number
  safeAreaBottom: number
  apiBaseUrl: string
  cdnBase: string
}

/**
 * 监控上报的注入点。
 *
 * core 不能依赖 @h5/monitor（层序 bridge <- core <- monitor），因此用依赖注入：
 * 业务传 `monitor: toMonitorAdapter()`，core 只调用这些可选钩子。
 */
export interface MonitorAdapter {
  init?: (options: { appId: string; env: AppEnv }) => void
  captureError?: (error: unknown, context?: Record<string, unknown>) => void
  reportBridgeError?: (method: string, code: number, msg: string) => void
  trackEvent?: (name: string, params?: Record<string, unknown>) => void
  markFirstScreen?: () => void
  /**
   * 首屏接口返回（core 的请求层触发）。首屏阶段的属主是监控实现，
   * 由它记下这一刻并在 `markFirstScreen` 时一并产出 `first-screen-api` 阶段。
   */
  markFirstScreenApi?: () => void
  reportPerf?: (stage: string, durationMs: number) => void
}

/** createH5App 的启动参数。 */
export interface CreateH5AppOptions {
  appId: string
  router: Router
  /** 启动时确保拿到 token（会触发原生登录）。 */
  requireLogin?: boolean
  /** 应用默认导航栏模式；不在 App 内时按 7.1 规则 4 回退为 h5。 */
  defaultNav?: NavMode
  /** false 关闭浏览器 mock；对象用于覆盖 mock 的默认实现。 */
  mock?: boolean | Partial<MockAdapter>
  monitor?: MonitorAdapter
  /** 白屏检测使用的根节点选择器。 */
  firstScreenSelector?: string
}

/** 登录态；token 只存内存，与原生登录态始终一致（设计文档 6.1）。 */
export interface AuthState {
  token: string | null
  expireAt: number
  setToken(token: string | null, expireAt?: number): void
  clear(): void
  ensureToken(): Promise<string>
}

/** 返回拦截：resolve true 表示已消费本次返回，不再执行默认返回逻辑（设计文档 7.3）。 */
export type BackHandler = () => boolean | Promise<boolean>
