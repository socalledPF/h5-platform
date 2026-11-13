import { BridgeError, CODE, reportBridgeError } from './error'
import { METHOD_LIST, METHODS } from './protocol'
import { getUAInfo } from './ua'
import type {
  AlertOptions,
  AppInfo,
  MockAdapter,
  MockStorage,
  NavTarget,
  NetworkInfo,
  ShareOptions,
  ToastOptions,
  TokenResult,
} from './types'

/** mock token 默认有效期（7 天）。 */
const MOCK_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000

/** 默认存储后端的 key 前缀，避免与业务 localStorage 冲突。 */
const STORAGE_PREFIX = 'h5:bridge:mock:'

const MOCK_APP_VERSION = 'mock'

let adapter: MockAdapter | null = null

const memoryStorage = new Map<string, string>()

/** 开启浏览器 mock 并注入 UI / token / 存储实现；重复调用以最后一次为准。 */
export function configureMock(next: MockAdapter): void {
  adapter = next
}

/** 当前是否路由到 mock 分支。 */
export function isMockActive(): boolean {
  return adapter !== null
}

/** 仅供测试重置 mock 状态（不从包入口导出）。 */
export function resetMock(): void {
  adapter = null
  memoryStorage.clear()
}

/**
 * mock 分支的 invoke 实现：不依赖原生通道，未注入能力时用控制台 / localStorage 兜底。
 * 仅未知方法以 1001 拒绝，其余方法一律 resolve，保证 PC 浏览器里可完整开发与跑 E2E。
 */
export async function mockInvoke<T>(method: string, params: Record<string, unknown>): Promise<T> {
  const current = adapter
  if (current === null) throw new BridgeError(CODE.NOT_IN_APP, 'not in app', method)
  try {
    return (await callMock(current, method, params)) as T
  } catch (error) {
    const bridgeError = toBridgeError(error, method)
    reportBridgeError(method, bridgeError.code, bridgeError.message)
    throw bridgeError
  }
}

async function callMock(
  current: MockAdapter,
  method: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  const custom = current.handlers?.[method]
  if (custom !== undefined) return custom(params)

  switch (method) {
    case METHODS.app.getCapabilities:
      return current.capabilities === undefined ? [...METHOD_LIST] : [...current.capabilities]
    case METHODS.app.getInfo:
      return mockAppInfo()
    case METHODS.auth.getToken:
    case METHODS.auth.refreshToken:
      return mockToken(current, method)
    case METHODS.auth.login:
    case METHODS.auth.logout:
      return undefined
    case METHODS.nav.open:
      mockNavOpen(current, params)
      return undefined
    case METHODS.nav.close:
    case METHODS.nav.setBar:
    case METHODS.nav.setRightButtons:
    case METHODS.nav.setBackInterceptor:
      return undefined
    case METHODS.nav.back:
      mockNavBack()
      return undefined
    case METHODS.nav.setTitle:
      if (typeof document !== 'undefined' && typeof params.title === 'string') {
        document.title = params.title
      }
      return undefined
    case METHODS.ui.toast:
      mockToast(current, params)
      return undefined
    case METHODS.ui.loading:
      mockLoading(params)
      return undefined
    case METHODS.ui.alert:
      mockAlert(current, params)
      return undefined
    case METHODS.share.open:
      mockShare(current, params)
      return undefined
    case METHODS.device.getNetwork:
      return current.network ?? mockNetwork()
    case METHODS.device.getLocation:
      return current.location ?? { latitude: 0, longitude: 0 }
    case METHODS.device.scan:
      return { text: '' }
    case METHODS.device.vibrate:
      mockVibrate(params)
      return undefined
    case METHODS.media.chooseImage:
      return { paths: [] }
    case METHODS.media.previewImage:
    case METHODS.media.saveImage:
      return undefined
    case METHODS.storage.get:
      return mockStorageGet(current, params)
    case METHODS.storage.set:
      mockStorageSet(current, params)
      return undefined
    case METHODS.track.event:
      mockTrack(current, params)
      return undefined
    default:
      throw new BridgeError(CODE.NOT_FOUND, `mock: 未实现的方法 ${method}`, method)
  }
}

function toBridgeError(error: unknown, method: string): BridgeError {
  if (error instanceof BridgeError) return error
  const msg = error instanceof Error ? error.message : 'mock error'
  return new BridgeError(CODE.BAD_PARAMS, msg, method)
}

function mockAppInfo(): AppInfo {
  const ua = getUAInfo()
  return {
    appVersion: ua.appVersion === '' ? MOCK_APP_VERSION : ua.appVersion,
    os: ua.os,
    osVersion: ua.osVersion,
    device: ua.device,
    statusBarHeight: 0,
    safeAreaTop: 0,
    safeAreaBottom: 0,
  }
}

async function mockToken(current: MockAdapter, method: string): Promise<TokenResult> {
  const provider = current.getToken
  if (provider === undefined) {
    return { token: 'mock-token', expireAt: Date.now() + MOCK_TOKEN_TTL_MS }
  }
  const token = await provider()
  if (token === null) throw new BridgeError(CODE.DENIED, 'mock: 未登录', method)
  return token
}

function mockNavOpen(current: MockAdapter, params: Record<string, unknown>): void {
  const target: NavTarget = { ...(params as NavTarget) }
  if (current.open !== undefined) {
    current.open(target)
    return
  }
  try {
    if (typeof target.url === 'string' && target.url !== '') {
      if (target.external === true && typeof window !== 'undefined') {
        window.open(target.url, '_blank', 'noopener')
        return
      }
      if (typeof history !== 'undefined') history.pushState({}, '', target.url)
      return
    }
    if (typeof target.route === 'string' && typeof history !== 'undefined') {
      history.pushState({}, '', `#${target.route}`)
    }
  } catch {
    // mock 导航失败不影响调用方（如 jsdom 不支持真实跳转）
  }
}

function mockNavBack(): void {
  try {
    if (typeof history !== 'undefined' && history.length > 1) history.back()
  } catch {
    // 同上
  }
}

function mockToast(current: MockAdapter, params: Record<string, unknown>): void {
  const message = typeof params.message === 'string' ? params.message : ''
  const options: ToastOptions =
    typeof params.duration === 'number' ? { duration: params.duration } : {}
  if (current.toast !== undefined) {
    current.toast(message, options)
    return
  }
  console.info(`[bridge:mock] toast: ${message}`)
}

function mockLoading(params: Record<string, unknown>): void {
  const text = typeof params.text === 'string' ? `: ${params.text}` : ''
  console.info(`[bridge:mock] loading ${params.show === true ? 'show' : 'hide'}${text}`)
}

function mockAlert(current: MockAdapter, params: Record<string, unknown>): void {
  const options: AlertOptions = {
    message: typeof params.message === 'string' ? params.message : '',
  }
  if (typeof params.title === 'string') options.title = params.title
  if (typeof params.confirmText === 'string') options.confirmText = params.confirmText
  if (typeof params.cancelText === 'string') options.cancelText = params.cancelText
  if (current.alert !== undefined) {
    current.alert(options)
    return
  }
  console.info(`[bridge:mock] alert: ${options.title ?? ''} ${options.message}`.trim())
}

function mockShare(current: MockAdapter, params: Record<string, unknown>): void {
  const options: ShareOptions = { link: typeof params.link === 'string' ? params.link : '' }
  if (typeof params.title === 'string') options.title = params.title
  if (typeof params.desc === 'string') options.desc = params.desc
  if (typeof params.imageUrl === 'string') options.imageUrl = params.imageUrl
  if (current.share !== undefined) {
    current.share(options)
    return
  }
  console.info(`[bridge:mock] share: ${options.link}`)
}

function mockNetwork(): NetworkInfo {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return { type: 'none' }
  const effectiveType = readEffectiveType()
  return effectiveType === undefined ? { type: 'unknown' } : { type: 'unknown', effectiveType }
}

function readEffectiveType(): string | undefined {
  try {
    const connection = (navigator as Navigator & { connection?: { effectiveType?: unknown } })
      .connection
    return typeof connection?.effectiveType === 'string' ? connection.effectiveType : undefined
  } catch {
    return undefined
  }
}

function mockVibrate(params: Record<string, unknown>): void {
  const duration = typeof params.durationMs === 'number' ? params.durationMs : 15
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(duration)
    }
  } catch {
    // 部分浏览器禁用震动
  }
}

function mockStorageGet(current: MockAdapter, params: Record<string, unknown>): unknown {
  const key = typeof params.key === 'string' ? params.key : ''
  const raw = pickStorage(current).getItem(storageKey(current, key))
  if (raw === null) return null
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

function mockStorageSet(current: MockAdapter, params: Record<string, unknown>): void {
  const key = typeof params.key === 'string' ? params.key : ''
  pickStorage(current).setItem(storageKey(current, key), JSON.stringify(params.value ?? null))
}

/** 注入的后端按原样使用 key，默认后端加前缀避免污染业务数据。 */
function storageKey(current: MockAdapter, key: string): string {
  return current.storage === undefined ? `${STORAGE_PREFIX}${key}` : key
}

function pickStorage(current: MockAdapter): MockStorage {
  if (current.storage !== undefined) return current.storage
  const local = readLocalStorage()
  if (local !== null) return local
  return {
    getItem: (key) => memoryStorage.get(key) ?? null,
    setItem: (key, value) => {
      memoryStorage.set(key, value)
    },
  }
}

function readLocalStorage(): MockStorage | null {
  try {
    if (typeof localStorage === 'undefined') return null
    return localStorage
  } catch {
    return null
  }
}

function mockTrack(current: MockAdapter, params: Record<string, unknown>): void {
  const name = typeof params.name === 'string' ? params.name : ''
  const trackParams =
    typeof params.params === 'object' && params.params !== null
      ? (params.params as Record<string, unknown>)
      : {}
  if (current.trackEvent !== undefined) {
    current.trackEvent(name, trackParams)
    return
  }
  console.info(`[bridge:mock] track: ${name}`, trackParams)
}
