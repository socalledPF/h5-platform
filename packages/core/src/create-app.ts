import {
  app as bridgeApp,
  configureMock,
  getUAInfo,
  isAvailable,
  ready,
  setBridgeErrorReporter,
} from '@h5/bridge'
import type { MockAdapter, NavTarget } from '@h5/bridge'
import { createPinia, setActivePinia } from 'pinia'
import { createApp } from 'vue'
import type { App, Component, ComponentPublicInstance } from 'vue'
import type { Router } from 'vue-router'
import { bootstrapAuth, subscribeAuthChange, useAuthStore } from './auth'
import { env, initEnv } from './env'
import {
  getMonitorAdapter,
  monitorError,
  monitorTrack,
  recentErrorMessages,
  setMonitorAdapter,
} from './monitor'
import {
  installNavigation,
  navMode,
  resolveNavMode,
  setDefaultNavMode,
  syncCurrentRoute,
} from './navigation'
import type { AppEnv, CreateH5AppOptions } from './types'
import { initVConsole } from './vconsole'

/** Bridge 就绪等待上限（设计文档 5.3）。 */
const READY_WAIT_MS = 1_000

/** 白屏检测的默认延迟与根节点（设计文档 11.2）。 */
const WHITE_SCREEN_DELAY_MS = 3_000
const DEFAULT_ROOT_SELECTOR = '#app'

const unsubscribers: (() => void)[] = []

/**
 * 统一启动入口（设计文档 4）：浏览器 mock → 上报器 → Bridge 就绪 → 环境识别 → 登录态 →
 * 监控 init → vConsole → 导航模式 → 路由/导航 → 返回拦截。返回**未挂载**的 App，由 `main.ts` 调用 mount。
 *
 * ```ts
 * createH5App(App, { appId: 'member', router, requireLogin: true }).then((app) => app.mount('#app'))
 * ```
 */
export async function createH5App(
  rootComponent: Component,
  options: CreateH5AppOptions,
): Promise<App<Element>> {
  if (shouldPreinstallMock(options)) configureMock(buildMockAdapter(options, env))

  // 上报器必须早于第一次 Bridge 调用装上：initEnv → app.getInfo() 就是启动期的第一次调用，
  // 旧客户端（1001 方法不存在）或 800ms 超时（-1）都在这里发生。装晚了这些失败会落进
  // errorReporter === null 的空档被静默丢弃，§11.2 的兼容性指标于是系统性漏掉最老的客户端。
  installBridgeErrorReporting(options)

  await ready(READY_WAIT_MS)
  await initEnv({ appId: options.appId })

  // pinia 必须在登录态初始化之前激活：auth store 写在同一个实例里，
  // 否则后面 app.use(pinia) 会换成新实例，业务读到空的登录态。
  const pinia = createPinia()
  setActivePinia(pinia)

  initMonitorAdapter(options)
  await bootstrapAuthSafely(options.requireLogin === true)
  unsubscribers.push(subscribeAuthChange())
  void initVConsole()

  setDefaultNavMode(options.defaultNav ?? 'native')
  navMode.value = resolveNavMode()

  const app = createApp(rootComponent)
  app.use(pinia)
  // 先装导航钩子再装 router：vue-router 的 install 会立刻发起落地导航，
  // 钩子若注册在它之后，落地路由可能在钩子到位前就结算，首屏于是漏掉 title / navMode 同步。
  unsubscribers.push(installNavigation(options.router))
  app.use(options.router)
  installVueErrorHandler(app)
  await syncLandingRoute(options.router)

  prefetchCapabilities()
  scheduleWhiteScreenCheck(options)
  return app
}

/**
 * 落地路由同步（设计文档 7.2）：等初始导航结算后按 currentRoute 显式同步一次标题 /
 * 导航栏模式 / 栈深度，兜住「钩子注册晚于初始导航」的时序窗口（幂等，不与 afterEach 冲突）。
 * 初始导航失败或迟迟不结算都不能挡住挂载——白屏比未同步更糟，因此按当前路由尽力同步后继续。
 */
async function syncLandingRoute(current: Router): Promise<void> {
  if (typeof window !== 'undefined') {
    // 必须设上限：全局 beforeEach 里 await 一个永不结算的 Promise（等原生登录、等配置）时，
    // isReady() 永不结算，createH5App 也永不 resolve → main.ts 的 .then(mount) 不执行，
    // 后面的白屏检测同样装不上：用户看到永久白屏，而且一条遥测都没有。
    await waitWithLimit(current, READY_WAIT_MS)
  }
  syncCurrentRoute()
}

/** 等初始导航结算，最多等 `timeoutMs`；导航失败 / 超时都只是降级，不抛错。 */
async function waitWithLimit(current: Router, timeoutMs: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      current.isReady().catch(() => undefined),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeoutMs)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/**
 * 是否在等待就绪之前先装浏览器 mock（首屏预算见设计文档 10.1 / 10.2）。
 *
 * 没有原生通道时 `ready()` 会一直等到超时（1 秒）才返回，浏览器里这段时间就是白屏；
 * 先装 mock 让 `ready()` 立即命中，页面马上挂载。
 *
 * 但 mock 一旦配置就无法撤销，所以「App 内通道晚到」绝不能提前装：
 * 协议约定 App 的 UA 一定带 `MyApp/<版本>`（docs/bridge-protocol.md §1），
 * 只要 UA 表明在 App 内就仍按原逻辑等待通道。
 */
function shouldPreinstallMock(options: CreateH5AppOptions): boolean {
  if (options.mock === false || isAvailable()) return false
  return getUAInfo().appVersion === ''
}

/**
 * Bridge 失败上报与埋点 adapter（设计文档 11.2）：adapter 由业务传入，core 不 import @h5/monitor。
 *
 * 只做「接上」这件事，不做 `init`：这一步必须早于第一次 Bridge 调用，
 * 而 `init` 需要 initEnv 之后才有值的 env 快照。
 */
function installBridgeErrorReporting(options: CreateH5AppOptions): void {
  const monitor = options.monitor
  if (monitor === undefined) {
    // 同一次页面生命周期里可能二次启动（微前端重挂、单测）：上一轮的 reporter / adapter 会
    // 闭包住旧的 monitor 实例，不清掉就会被当成这次启动的实现，上报与埋点串进上一份配置。
    setBridgeErrorReporter(null)
    setMonitorAdapter(undefined)
    return
  }
  setMonitorAdapter(monitor)
  setBridgeErrorReporter((method, code, msg) => {
    monitor.reportBridgeError?.(method, code, msg)
  })
}

/**
 * 监控初始化：必须在 initEnv 之后 —— init 当场读 env 的环境开关（isProd / isPre / isTest）
 * 决定 Sentry 的 environment，提前调用只会读到「四个开关全是 false」的半初始化快照。
 * init 抛错不影响启动。
 */
function initMonitorAdapter(options: CreateH5AppOptions): void {
  const monitor = options.monitor
  if (monitor === undefined) return
  try {
    monitor.init?.({ appId: options.appId, env })
  } catch (error) {
    rememberQuietly(error)
  }
}

/**
 * 登录态初始化（设计文档 6.1）：先同步内存登录态；`requireLogin` 时确保拿到 token。
 * 拿不到（旧版 App / 未登录 / 关掉 mock 的浏览器）只上报，绝不挡住挂载——白屏比未登录更糟。
 */
async function bootstrapAuthSafely(requireLogin: boolean): Promise<void> {
  try {
    await bootstrapAuth()
    if (requireLogin) await useAuthStore().ensureToken()
  } catch (error) {
    rememberQuietly(error)
  }
}

function rememberQuietly(error: unknown): void {
  monitorError(error, { source: 'createH5App' })
}

/** §5.3：启动后台预热能力列表，失败静默。 */
function prefetchCapabilities(): void {
  void bridgeApp.getCapabilities().catch(() => undefined)
}

/** Vue 渲染期错误进入监控（设计文档 11.2）；未被监控接管时保留框架默认的 console 输出。 */
function installVueErrorHandler(app: App): void {
  app.config.errorHandler = (
    error: unknown,
    _instance: ComponentPublicInstance | null,
    info: string,
  ) => {
    monitorError(error, { source: 'vue', info })
    if (getMonitorAdapter() === undefined) console.error('[h5:core] vue error:', error, info)
  }
}

function scheduleWhiteScreenCheck(options: CreateH5AppOptions): void {
  const selector = options.firstScreenSelector ?? DEFAULT_ROOT_SELECTOR
  setTimeout(() => {
    if (hasMeaningfulContent(selector)) return
    monitorError(new Error(`白屏：根节点 ${selector} 无有效内容`), {
      source: 'white-screen',
      selector,
      route: options.router.currentRoute.value.fullPath,
      recentErrors: recentErrorMessages(),
    })
  }, WHITE_SCREEN_DELAY_MS)
}

/** 根节点有文本或子元素即认为渲染成功；文档不存在（SSR/单测）时不误报。 */
function hasMeaningfulContent(selector: string): boolean {
  try {
    if (typeof document === 'undefined') return true
    const root = document.querySelector(selector)
    if (root === null) return false
    if ((root.textContent ?? '').trim().length > 0) return true
    return root.childElementCount > 0
  } catch {
    return true
  }
}

/**
 * 浏览器 mock 的默认实现（设计文档 5.4）：业务可用 `mock: { ... }` 覆盖任意一项。
 * token / 存储保持 bridge 的默认行为，core 不额外持久化任何登录态。
 */
function buildMockAdapter(options: CreateH5AppOptions, current: AppEnv): Partial<MockAdapter> {
  const overrides: Partial<MockAdapter> =
    typeof options.mock === 'object' && options.mock !== null ? options.mock : {}

  const defaults: Partial<MockAdapter> = {
    // PC 浏览器里没有原生导航：把跳转意图打到控制台，避免开发时“点了没反应”
    open: (target: NavTarget) => {
      const description = target.route ?? target.url ?? '(empty)'
      console.info(`[h5:core:mock] nav.open ${description}`, {
        external: target.external === true,
        nav: target.nav ?? navMode.value,
        appId: current.appId,
      })
    },
  }
  if (options.monitor !== undefined) {
    // 浏览器里 mock 的埋点应和线上一样落到监控实现，保证口径一致
    defaults.trackEvent = (name, params) => {
      monitorTrack(name, params)
    }
  }
  return { ...defaults, ...overrides }
}

/** 仅供测试：解绑 auth.change 等启动期订阅。 */
export function resetCreateAppState(): void {
  for (const unsubscribe of unsubscribers) unsubscribe()
  unsubscribers.length = 0
  setBridgeErrorReporter(null)
  setMonitorAdapter(undefined)
}
