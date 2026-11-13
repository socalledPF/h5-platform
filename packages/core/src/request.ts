import { auth as bridgeAuth } from '@h5/bridge'
import axios, { isAxiosError } from 'axios'
import type {
  AxiosInstance,
  AxiosRequestConfig,
  AxiosResponse,
  InternalAxiosRequestConfig,
} from 'axios'
import { useAuthStore } from './auth'
import { env } from './env'
import { ApiError, normalizeError, readMessage } from './errors'
import { markFirstScreenApi } from './monitor'

/** 用户可见错误的处理策略：静默 / 统一提示（默认）/ 业务自行处理。 */
export type ErrorMode = 'silent' | 'toast' | 'custom'

declare module 'axios' {
  // axios 的 AxiosRequestConfig 声明了默认泛型参数 D = any，接口合并要求参数列表完全一致，
  // 因此这里必须重复该默认值（且该参数在扩展里天然不会被使用）；core 自身代码不使用 any。
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
  export interface AxiosRequestConfig<D = any> {
    /** 失败时的用户提示策略，默认 toast。 */
    errorMode?: ErrorMode
    /** 网络错误的重试次数，默认 1（仅对幂等方法生效）。 */
    retry?: number
    /** 是否已因 401 重放过，防止无限循环。 */
    _retried?: boolean
    /** 已重试次数。 */
    _retryCount?: number
  }
}

/** 请求配置：在 axios 配置之上增加错误策略与重试次数（设计文档 6.3）。 */
export interface RequestConfig extends AxiosRequestConfig {
  errorMode?: ErrorMode
  retry?: number
}

/** 默认超时 15 秒（设计文档 6.3）。 */
export const DEFAULT_TIMEOUT_MS = 15_000

/** 幂等方法才自动重试，避免重复下单之类的副作用。 */
const RETRYABLE_METHODS = new Set(['get', 'head', 'options'])

type Envelope = { code: number; data: unknown; msg?: unknown }

let errorNotifier: ((message: string) => void) | null = null

/** 注入用户可见错误提示（业务传 Vant Toast）；core 不依赖任何 UI 包。 */
export function setErrorNotifier(fn: ((message: string) => void) | null): void {
  errorNotifier = fn
}

/** 创建 axios 实例：统一超时与请求头，错误收敛在拦截器里。 */
export const http: AxiosInstance = axios.create({ timeout: DEFAULT_TIMEOUT_MS })

http.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const auth = useAuthStore()
  if (auth.token !== null) config.headers.set('Authorization', `Bearer ${auth.token}`)
  config.headers.set('X-App-Version', env.appVersion === '' ? 'unknown' : env.appVersion)
  config.headers.set('X-H5-App', env.appId === '' ? 'unknown' : env.appId)
  if (config.baseURL === undefined && env.apiBaseUrl !== '') config.baseURL = env.apiBaseUrl
  return config
})

http.interceptors.response.use(
  // 拦截器把 AxiosResponse 换成解包后的 data；axios 的类型仍按 AxiosResponse 声明，
  // 因此在边界处收窄一次，对外由 request<T>() 给出真实类型。
  (response: AxiosResponse): AxiosResponse => unwrap(response) as AxiosResponse,
  async (error: unknown) => {
    if (!isAxiosError(error) || error.config === undefined) throw notifyAndWrap(error, undefined)
    const config = error.config

    if (error.response?.status === 401 && config._retried !== true) {
      config._retried = true
      try {
        const token = await refreshToken()
        useAuthStore().setToken(token)
      } catch (refreshError) {
        throw notifyAndWrap(refreshError, config)
      }
      return http.request(config)
    }

    if (shouldRetry(error, config)) {
      config._retryCount = (config._retryCount ?? 0) + 1
      return http.request(config)
    }

    throw notifyAndWrap(error, config)
  },
)

/** 网络错误下的 GET 重试（默认 1 次）；`retry` 可覆盖，`retry: 0` 关闭。 */
function shouldRetry(
  error: { code?: string; response?: unknown },
  config: AxiosRequestConfig,
): boolean {
  if (error.response !== undefined) return false
  if (error.code === 'ERR_CANCELED') return false
  const method = (config.method ?? 'get').toLowerCase()
  if (!RETRYABLE_METHODS.has(method)) return false
  return (config._retryCount ?? 0) < (config.retry ?? 1)
}

/** 解包 `{ code, data, msg }`：code !== 0 抛 ApiError，非信封结构原样返回。 */
function unwrap(response: AxiosResponse): unknown {
  markFirstScreenApi()
  const payload = response.data
  if (!isEnvelope(payload)) return payload
  if (payload.code === 0) return payload.data
  const message = readMessage(payload) ?? `接口返回错误码 ${payload.code}`
  throw notifyAndWrap(new ApiError(payload.code, message, payload.data), response.config)
}

function isEnvelope(value: unknown): value is Envelope {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { code?: unknown }).code === 'number'
  )
}

/** 按 errorMode 决定是否提示用户，并把任意异常收敛成 ApiError。 */
function notifyAndWrap(error: unknown, config: AxiosRequestConfig | undefined): ApiError {
  const apiError = normalizeError(error)
  const mode = config?.errorMode ?? 'toast'
  if (mode === 'toast') notifyUser(apiError.message)
  return apiError
}

function notifyUser(message: string): void {
  try {
    if (errorNotifier !== null) errorNotifier(message)
    else console.warn(`[h5:core] ${message}`)
  } catch {
    // 提示实现自身异常不得影响请求链路
  }
}

let refreshing: Promise<string> | null = null

/**
 * 401 并发刷新（设计文档 6.2）：同一时刻只有一个 refreshToken 在飞，
 * 其余请求 await 同一个 Promise 后重放各自的原配置。
 */
export function refreshToken(): Promise<string> {
  if (refreshing === null) {
    refreshing = doRefreshToken().finally(() => {
      refreshing = null
    })
  }
  return refreshing
}

/** 先请原生刷新，失败则唤起原生登录再取 token。 */
async function doRefreshToken(): Promise<string> {
  try {
    const refreshed = await bridgeAuth.refreshToken()
    if (typeof refreshed.token === 'string' && refreshed.token !== '') return refreshed.token
  } catch {
    // 刷新失败走原生登录
  }
  await bridgeAuth.login()
  const relogged = await bridgeAuth.getToken()
  if (typeof relogged.token !== 'string' || relogged.token === '') {
    throw new ApiError(-1, '登录态获取失败')
  }
  return relogged.token
}

/** 发起请求并直接拿到解包后的 data。 */
export async function request<T = unknown>(config: RequestConfig): Promise<T> {
  return (await http.request(config)) as unknown as T
}

/** GET 快捷方法。 */
export function get<T = unknown>(
  url: string,
  params?: Record<string, unknown>,
  config: RequestConfig = {},
): Promise<T> {
  return request<T>({ ...config, url, method: 'GET', params })
}

/** POST 快捷方法。 */
export function post<T = unknown>(
  url: string,
  data?: unknown,
  config: RequestConfig = {},
): Promise<T> {
  return request<T>({ ...config, url, method: 'POST', data })
}

/**
 * 可取消请求（设计文档 6.3）：页面卸载时 abort，避免回包写入已销毁的组件。
 *
 * ```ts
 * const { promise, abort } = withCancel((signal) => get('/api/list', {}, { signal }))
 * ```
 */
export function withCancel<T>(run: (signal: AbortSignal) => Promise<T>): {
  promise: Promise<T>
  abort: () => void
} {
  const controller = new AbortController()
  return {
    promise: run(controller.signal),
    abort: () => {
      controller.abort()
    },
  }
}

/** 仅供测试：清空单飞刷新状态。 */
export function resetRequestState(): void {
  refreshing = null
  errorNotifier = null
  http.defaults.adapter = undefined
}
