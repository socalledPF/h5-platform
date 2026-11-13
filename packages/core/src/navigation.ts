import { nav as bridgeNav, on } from '@h5/bridge'
import { ref } from 'vue'
import type { Ref } from 'vue'
import type { RouteLocationNormalized, RouteLocationRaw, Router } from 'vue-router'
import { env } from './env'
import { rememberError } from './monitor'
import type { BackHandler, NavMode, NavTarget } from './types'

/** 当前生效的导航栏模式；路由变化时按 7.1 优先级重算。 */
export const navMode: Ref<NavMode> = ref<NavMode>('native')

/** 入口内路由栈深度：1 表示当前是入口首个页面（设计文档 7.3）。 */
export const routeStackDepth: Ref<number> = ref(1)

/** 应用默认导航栏模式（7.1 规则 3）。 */
let defaultNav: NavMode = 'native'

let router: Router | null = null
let basePosition: number | null = null
let backPressSubscribed = false
const backHandlers: BackHandler[] = []
const unsubscribers: (() => void)[] = []

const NAV_VALUES: readonly NavMode[] = ['native', 'h5', 'none']

/** 设置应用默认导航栏模式（7.1 规则 3），同时按当前上下文重算 navMode。 */
export function setDefaultNavMode(mode: NavMode): void {
  defaultNav = mode
  navMode.value = resolveNavMode()
}

/**
 * 导航栏模式决定（设计文档 7.1，按优先级从高到低）：
 * 1. URL 参数 `?nav=`；2. 路由 `meta.nav`；3. 应用默认值；4. 不在 App 内 → h5。
 */
export function resolveNavMode(to?: RouteLocationNormalized | RouteLocationRaw): NavMode {
  const fromUrl = readNavFromLocation() ?? readNavFromRouteQuery(to)
  if (fromUrl !== null) return fromUrl

  const fromMeta = readNavFromRouteMeta(to)
  if (fromMeta !== null) return fromMeta

  if (!env.isApp) return 'h5'
  return defaultNav
}

function toNavMode(value: unknown): NavMode | null {
  if (typeof value !== 'string') return null
  return NAV_VALUES.includes(value as NavMode) ? (value as NavMode) : null
}

/** 打开方通过 URL 带过来的模式（真实 location，含 hash 路由的 query）。 */
function readNavFromLocation(): NavMode | null {
  const search = readLocation('search')
  const fromSearch = toNavMode(new URLSearchParams(search).get('nav'))
  if (fromSearch !== null) return fromSearch

  const hash = readLocation('hash')
  const queryStart = hash.indexOf('?')
  if (queryStart < 0) return null
  return toNavMode(new URLSearchParams(hash.slice(queryStart + 1)).get('nav'))
}

function readLocation(part: 'search' | 'hash'): string {
  try {
    if (typeof location === 'undefined') return ''
    return part === 'search' ? location.search : location.hash
  } catch {
    return ''
  }
}

/** 路由 query 里的 nav：SSR / 导航守卫里 `to` 还没反映到 location 时使用。 */
function readNavFromRouteQuery(to?: RouteLocationNormalized | RouteLocationRaw): NavMode | null {
  if (typeof to !== 'object' || to === null || !('query' in to)) return null
  const query = to.query
  if (typeof query !== 'object' || query === null) return null
  const raw = (query as Record<string, unknown>).nav
  return toNavMode(Array.isArray(raw) ? raw[0] : raw)
}

function readNavFromRouteMeta(to?: RouteLocationNormalized | RouteLocationRaw): NavMode | null {
  if (typeof to !== 'object' || to === null || !('meta' in to)) return null
  const meta = to.meta
  if (typeof meta !== 'object' || meta === null) return null
  return toNavMode((meta as Record<string, unknown>).nav)
}

/**
 * 统一跳转入口（设计文档 7.4）：
 * 站内路径 → router.push；`native://` → 原生路由；外部链接 → 内置/系统浏览器；其它 apps 入口 → 新 WebView。
 */
export async function navigate(target: NavTarget | string): Promise<void> {
  const decision = decideNavigation(target)
  if (decision.kind === 'router') {
    if (router === null) {
      rememberError('navigate 在 router 安装前被调用')
      return
    }
    await router.push(decision.location)
    return
  }
  try {
    await bridgeNav.open(decision.target)
  } catch (error) {
    // 原生不可用时退化为站内跳转，避免点击无响应
    rememberError(error)
    const fallback = decision.target.url ?? decision.target.route
    const isInternalPath = fallback !== undefined && fallback.startsWith('/')
    if (isInternalPath && router !== null) await router.push(fallback)
  }
}

type Decision = { kind: 'router'; location: string } | { kind: 'bridge'; target: NavTarget }

function decideNavigation(target: NavTarget | string): Decision {
  if (typeof target === 'string') return decideUrl(target)

  if (typeof target.route === 'string' && target.route !== '') {
    return { kind: 'bridge', target: { route: target.route } }
  }
  if (typeof target.url === 'string' && target.url !== '') {
    const decision = decideUrl(target.url)
    if (decision.kind === 'router') return decision
    return { kind: 'bridge', target: { ...target } }
  }
  return { kind: 'router', location: '/' }
}

const SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:/i

function decideUrl(raw: string): Decision {
  const url = raw.trim()
  if (url === '') return { kind: 'router', location: '/' }

  // 原生页面：交给原生路由
  if (/^native:\/\//i.test(url)) return { kind: 'bridge', target: { route: url } }

  // 协议相对地址（//host/path）属于外部链接
  if (url.startsWith('//')) return { kind: 'bridge', target: { url, external: true } }

  // 无 scheme，站内路径
  if (!SCHEME_PATTERN.test(url)) return { kind: 'router', location: url }

  const parsed = parseUrl(url)
  if (parsed === null) return { kind: 'bridge', target: { url, external: true } }
  if (parsed.origin !== currentOrigin()) return { kind: 'bridge', target: { url, external: true } }
  if (!isSameAppPath(parsed.pathname))
    return { kind: 'bridge', target: { url, nav: navMode.value } }
  return { kind: 'router', location: `${parsed.pathname}${parsed.search}${parsed.hash}` }
}

function parseUrl(raw: string): URL | null {
  try {
    return new URL(raw)
  } catch {
    return null
  }
}

function currentOrigin(): string {
  try {
    if (typeof location === 'undefined') return ''
    return location.origin
  } catch {
    return ''
  }
}

/** 本应用部署的 base 路径：优先 env.cdnBase（构建时的 vite base），退化到 BASE_URL。 */
function appBasePath(): string {
  for (const candidate of [env.cdnBase, readBaseUrl()]) {
    const path = extractPath(candidate)
    if (path !== null) return path
  }
  return '/'
}

function readBaseUrl(): string {
  try {
    const meta = import.meta as unknown as { env?: Record<string, string | undefined> }
    return meta.env?.BASE_URL ?? ''
  } catch {
    return ''
  }
}

function extractPath(raw: string): string | null {
  const value = raw.trim()
  if (value === '') return null
  const path = SCHEME_PATTERN.test(value) ? (parseUrl(value)?.pathname ?? null) : value
  if (path === null || path === '') return null
  const withLeading = path.startsWith('/') ? path : `/${path}`
  return withLeading.endsWith('/') ? withLeading : `${withLeading}/`
}

function isSameAppPath(pathname: string): boolean {
  const base = appBasePath()
  if (base === '/') return true
  const normalized = pathname.endsWith('/') ? pathname : `${pathname}/`
  return normalized.startsWith(base)
}

/**
 * 默认返回（设计文档 7.3.2）：栈深度 > 1 走路由返回，否则关闭当前 WebView。
 * 只由 requestBack 调用，保证拦截器不会被二次询问。
 */
function performDefaultBack(): void {
  if (routeStackDepth.value > 1 && router !== null) {
    router.back()
    return
  }
  if (routeStackDepth.value > 1) {
    try {
      if (typeof window !== 'undefined') window.history.back()
    } catch {
      // 忽略
    }
    return
  }
  void bridgeNav.close().catch(() => {
    // 不在 App 内（或原生不支持）时忽略，避免未捕获的 rejection
  })
}

/**
 * 单一路径的返回请求（设计文档 7.3.2 / 7.3.4）：先跑业务注册的拦截器（LIFO），
 * 第一个返回 true 的消费本次返回；都不消费才执行默认返回。
 * 原生 `nav.backPress`、H5 导航栏返回按钮都走这里，拦截器每次返回只运行一遍。
 * 返回 true 表示本次返回已被拦截器消费。
 */
export async function requestBack(): Promise<boolean> {
  for (const handler of [...backHandlers].reverse()) {
    let consumed = false
    try {
      consumed = await handler()
    } catch (error) {
      rememberError(error)
      consumed = false
    }
    if (consumed) return true
  }
  performDefaultBack()
  return false
}

/**
 * 返回（设计文档 7.3）：无拦截器时同步执行默认返回；有拦截器时交给 requestBack，
 * 因为拦截器可能要 await 用户确认。
 */
export function goBack(): void {
  if (backHandlers.length === 0) {
    performDefaultBack()
    return
  }
  void requestBack()
}

/** 注册返回拦截，返回取消注册函数；后注册者先执行（useBackGuard 使用）。 */
export function registerBackHandler(handler: BackHandler): () => void {
  backHandlers.push(handler)
  return () => {
    const index = backHandlers.indexOf(handler)
    if (index >= 0) backHandlers.splice(index, 1)
  }
}

/** 原生返回事件入口：与 H5 返回按钮共用 requestBack 这一条链路。 */
export async function handleBackPress(): Promise<void> {
  await requestBack()
}

/**
 * 安装导航：路由栈深度、标题同步、navMode 重算、原生返回拦截（设计文档 7.3）。
 * createH5App 调用一次即可。
 */
export function installNavigation(nextRouter: Router): void {
  router = nextRouter
  basePosition = null
  routeStackDepth.value = 1
  navMode.value = resolveNavMode()

  nextRouter.afterEach((to, _from, failure) => {
    if (failure !== undefined) return
    updateStackDepth(nextRouter)
    navMode.value = resolveNavMode(to)
    syncTitle(to)
  })

  if (env.isApp) void bridgeNav.setBackInterceptor(true).catch(() => undefined)
  subscribeBackPress()
}

/**
 * 栈深度取自 vue-router 写入的 `history.state.position`（push +1、replace 不变、back -1），
 * 比在 afterEach 里猜导航类型可靠；拿不到（如 memory history）时保持当前值。
 */
function updateStackDepth(current: Router): void {
  const position = readHistoryPosition(current)
  if (position === null) return
  if (basePosition === null) basePosition = position
  routeStackDepth.value = Math.max(1, position - basePosition + 1)
}

function readHistoryPosition(current: Router): number | null {
  try {
    const state = current.options.history.state as { position?: unknown } | undefined
    return typeof state?.position === 'number' ? state.position : null
  } catch {
    return null
  }
}

/** document.title 与原生导航栏标题统一由路由 meta 驱动（设计文档 7.2）。 */
function syncTitle(to: RouteLocationNormalized): void {
  const meta = to.meta as Record<string, unknown>
  const title = typeof meta.title === 'string' ? meta.title : ''
  if (title === '') return
  try {
    if (typeof document !== 'undefined') document.title = title
  } catch {
    // 忽略
  }
  if (navMode.value === 'native' && env.isApp) {
    void bridgeNav.setTitle(title).catch(() => undefined)
  }
}

function subscribeBackPress(): void {
  if (backPressSubscribed) return
  backPressSubscribed = true
  unsubscribers.push(
    on('nav.backPress', () => {
      void handleBackPress()
    }),
  )
}

/** 仅供测试：解绑原事件、清空拦截器与深度。 */
export function resetNavigationState(): void {
  for (const unsubscribe of unsubscribers) unsubscribe()
  unsubscribers.length = 0
  backHandlers.length = 0
  backPressSubscribed = false
  router = null
  basePosition = null
  routeStackDepth.value = 1
  navMode.value = 'native'
  defaultNav = 'native'
}
