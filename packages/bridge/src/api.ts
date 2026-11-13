import { loadCapabilities, warmCapabilities } from './capabilities'
import { invoke } from './core'
import { LONG_TIMEOUT_MS, METHODS } from './protocol'
import type {
  AlertOptions,
  AppInfo,
  ChooseImageOptions,
  ChooseImageResult,
  LocationInfo,
  NavBarButton,
  NavBarOptions,
  NavTarget,
  NetworkInfo,
  PreviewImageOptions,
  SaveImageOptions,
  ScanOptions,
  ScanResult,
  ShareOptions,
  ToastOptions,
  TokenResult,
} from './types'

/** 接口类型没有索引签名，统一转成普通对象再发给原生。 */
function toParams(options: object): Record<string, unknown> {
  return { ...options } as Record<string, unknown>
}

/** App 信息与能力探测。 */
export const app = {
  getInfo(): Promise<AppInfo> {
    warmCapabilities()
    return invoke<AppInfo>(METHODS.app.getInfo)
  },
  getCapabilities(): Promise<string[]> {
    return loadCapabilities()
  },
}

/** 登录态；token 只存内存，与原生登录态保持一致。 */
export const auth = {
  getToken(): Promise<TokenResult> {
    return invoke<TokenResult>(METHODS.auth.getToken)
  },
  refreshToken(): Promise<TokenResult> {
    return invoke<TokenResult>(METHODS.auth.refreshToken)
  },
  login(): Promise<void> {
    // 唤起原生登录，含用户交互，超时放长
    return invoke<void>(METHODS.auth.login, {}, LONG_TIMEOUT_MS)
  },
  logout(): Promise<void> {
    return invoke<void>(METHODS.auth.logout)
  },
}

/** 页面跳转与原生导航栏。 */
export const nav = {
  open(target: NavTarget = {}): Promise<void> {
    return invoke<void>(METHODS.nav.open, toParams(target))
  },
  close(): Promise<void> {
    return invoke<void>(METHODS.nav.close)
  },
  back(): Promise<void> {
    return invoke<void>(METHODS.nav.back)
  },
  setTitle(title: string): Promise<void> {
    return invoke<void>(METHODS.nav.setTitle, { title })
  },
  setBar(options: NavBarOptions): Promise<void> {
    return invoke<void>(METHODS.nav.setBar, toParams(options))
  },
  setRightButtons(buttons: NavBarButton[]): Promise<void> {
    return invoke<void>(METHODS.nav.setRightButtons, { buttons })
  },
  setBackInterceptor(enabled: boolean): Promise<void> {
    return invoke<void>(METHODS.nav.setBackInterceptor, { enabled })
  },
}

/** 原生级弹层（需要盖住原生导航栏时使用）。 */
export const ui = {
  toast(message: string, options: ToastOptions = {}): Promise<void> {
    return invoke<void>(METHODS.ui.toast, { message, ...toParams(options) })
  },
  loading(show: boolean, text?: string): Promise<void> {
    return invoke<void>(METHODS.ui.loading, text === undefined ? { show } : { show, text })
  },
  alert(options: AlertOptions): Promise<void> {
    return invoke<void>(METHODS.ui.alert, toParams(options))
  },
}

/** 原生分享。 */
export const share = {
  open(options: ShareOptions): Promise<void> {
    return invoke<void>(METHODS.share.open, toParams(options))
  },
}

/** 设备能力。 */
export const device = {
  getNetwork(): Promise<NetworkInfo> {
    return invoke<NetworkInfo>(METHODS.device.getNetwork)
  },
  getLocation(): Promise<LocationInfo> {
    return invoke<LocationInfo>(METHODS.device.getLocation)
  },
  scan(options: ScanOptions = {}): Promise<ScanResult> {
    return invoke<ScanResult>(METHODS.device.scan, toParams(options))
  },
  vibrate(durationMs?: number): Promise<void> {
    return invoke<void>(METHODS.device.vibrate, durationMs === undefined ? {} : { durationMs })
  },
}

/** 图片选择 / 预览 / 保存。 */
export const media = {
  chooseImage(options: ChooseImageOptions = {}): Promise<ChooseImageResult> {
    return invoke<ChooseImageResult>(METHODS.media.chooseImage, toParams(options))
  },
  previewImage(options: PreviewImageOptions): Promise<void> {
    return invoke<void>(METHODS.media.previewImage, toParams(options))
  },
  saveImage(options: SaveImageOptions): Promise<void> {
    return invoke<void>(METHODS.media.saveImage, toParams(options))
  },
}

/** 跨 WebView 共享的轻量数据（由原生侧持久化）。 */
export const storage = {
  get<T = unknown>(key: string): Promise<T | null> {
    return invoke<T | null>(METHODS.storage.get, { key })
  },
  set(key: string, value: unknown): Promise<void> {
    return invoke<void>(METHODS.storage.set, { key, value })
  },
}

/** 埋点：优先走 App 的埋点 SDK，保证与原生同一会话。 */
export const track = {
  event(name: string, params: Record<string, unknown> = {}): Promise<void> {
    return invoke<void>(METHODS.track.event, { name, params })
  },
}
