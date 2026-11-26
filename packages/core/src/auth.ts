import { auth as bridgeAuth, on } from '@h5/bridge'
import { createPinia, defineStore, getActivePinia, setActivePinia } from 'pinia'
import type { Pinia } from 'pinia'
import { ApiError, UNKNOWN_ERROR_CODE } from './errors'
import { getMonitorAdapter } from './monitor'
import type { AuthState } from './types'

/**
 * 登录态（设计文档 6.1）：原生是唯一来源，H5 只把 token 放在内存里。
 *
 * 这里刻意不碰 localStorage / sessionStorage：多个 WebView 之间 token 不一致、
 * 原生已登出而 H5 仍持有旧 token，都是线上事故的来源。
 */
const useAuthStoreInternal = defineStore('h5-auth', {
  state: () => ({
    token: null as string | null,
    expireAt: 0,
  }),
  actions: {
    setToken(token: string | null, expireAt = 0): void {
      this.token = token === '' ? null : token
      this.expireAt = this.token === null ? 0 : expireAt
    },
    clear(): void {
      this.token = null
      this.expireAt = 0
    },
    /** 拿到可用 token：内存里有就直接用；否则问原生，必要时唤起原生登录。 */
    async ensureToken(): Promise<string> {
      if (this.token !== null) return this.token
      const loaded = await readNativeToken()
      if (loaded !== null) {
        this.setToken(loaded.token, loaded.expireAt)
        return loaded.token
      }
      await bridgeAuth.login()
      const relogged = await readNativeToken()
      if (relogged === null) throw new ApiError(UNKNOWN_ERROR_CODE, '登录后仍未拿到 token')
      this.setToken(relogged.token, relogged.expireAt)
      return relogged.token
    },
  },
})

/** 业务拿到的登录态视图：读写都是实时的（getter/setter 转发到 pinia store）。 */
export function useAuthStore(): AuthState {
  const store = useAuthStoreInternal(ensurePinia())
  return {
    get token(): string | null {
      return store.token
    },
    set token(next: string | null) {
      store.setToken(next)
    },
    get expireAt(): number {
      return store.expireAt
    },
    set expireAt(next: number) {
      store.expireAt = next
    },
    setToken(token: string | null, expireAt?: number): void {
      store.setToken(token, expireAt)
    },
    clear(): void {
      store.clear()
    },
    ensureToken(): Promise<string> {
      return store.ensureToken()
    },
  }
}

/** 内存里没有 token 时向原生查询；未登录（1004）等失败一律返回 null。 */
async function readNativeToken(): Promise<{ token: string; expireAt: number } | null> {
  try {
    const result = await bridgeAuth.getToken()
    if (typeof result.token !== 'string' || result.token === '') return null
    const expireAt = typeof result.expireAt === 'number' ? result.expireAt : 0
    return { token: result.token, expireAt }
  } catch {
    return null
  }
}

/** 启动时用原生 token 初始化内存登录态；失败只降级为未登录，不阻塞启动。 */
export async function bootstrapAuth(): Promise<void> {
  const store = useAuthStore()
  if (store.token !== null) return
  const loaded = await readNativeToken()
  if (loaded !== null) store.setToken(loaded.token, loaded.expireAt)
}

/**
 * 订阅原生 `auth.change`（设计文档 6.1）：更新内存登录态；
 * 切换到另一个非空 token（换账号）时整页刷新，避免残留上一个用户的数据。
 */
export function subscribeAuthChange(): () => void {
  return on('auth.change', (payload) => {
    applyAuthChange(typeof payload?.token === 'string' ? payload.token : null)
  })
}

/** 单独抽出便于测试与原生事件之外的手动同步。 */
export function applyAuthChange(next: string | null): void {
  const store = useAuthStore()
  const previous = store.token
  if (next === null || next === '') {
    store.clear()
    notifySessionEnd()
    return
  }
  store.setToken(next, store.expireAt)
  if (previous !== null && previous !== next) reloadPage()
}

/**
 * 告诉监控侧「登录态到此为止」（设计文档 6.1 / 11.2）：假名按一段连续非空 token 缓存，
 * 不在这里作废，下一个账号的错误就会顶上一个账号的假名上报。
 *
 * 只覆盖「有 → 无」：401 刷新换 token 走的是 `setToken`（同一个用户），不能途经这里，
 * 否则每次刷新都会重派假名。监控实现自身抛错、未注入监控、重复登出都不影响登录态。
 */
function notifySessionEnd(): void {
  try {
    getMonitorAdapter()?.markSessionEnd?.()
  } catch {
    // 监控实现自身异常不得影响登录态
  }
}

type ReloadHandler = () => void

/** 换账号后整页刷新；部分容器不支持 reload，失败不影响登录态。 */
const defaultReload: ReloadHandler = () => {
  try {
    if (typeof window !== 'undefined' && typeof window.location.reload === 'function') {
      window.location.reload()
    }
  } catch {
    // reload 被容器禁用时仅更新内存登录态
  }
}

let reloadHandler: ReloadHandler = defaultReload

/** 替换整页刷新实现（测试与不支持 reload 的容器使用）。 */
export function setReloadHandler(handler: ReloadHandler | null): void {
  reloadHandler = handler ?? defaultReload
}

function reloadPage(): void {
  try {
    reloadHandler()
  } catch {
    // 同上
  }
}

/** pinia 未安装时兜底创建一个，保证 core 在 app.use(pinia) 之前也能读写登录态。 */
function ensurePinia(): Pinia {
  const active = getActivePinia()
  if (active !== undefined) return active
  const pinia = createPinia()
  setActivePinia(pinia)
  return pinia
}

/** 仅供测试：清空内存登录态。 */
export function resetAuthState(): void {
  useAuthStore().clear()
}
