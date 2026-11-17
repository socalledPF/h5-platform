/** 原生回调统一结构；code 为 0 表示成功。 */
export interface BridgeResult<T> {
  code: number
  data: T
  msg?: string
}

/** 导航栏模式：原生渲染 / H5 自绘 / 不显示。 */
export type NavMode = 'native' | 'h5' | 'none'

/** App 环境信息，来自原生 `app.getInfo`。 */
export interface AppInfo {
  appVersion: string
  os: 'ios' | 'android' | 'web'
  osVersion: string
  device: string
  statusBarHeight: number
  safeAreaTop?: number
  safeAreaBottom?: number
}

/** UA 解析结果：纯前端推算，不依赖原生，永远不抛错。 */
export interface UAInfo {
  os: 'ios' | 'android' | 'web'
  osVersion: string
  device: string
  appVersion: string
}

/** 登录态；token 只存内存，expireAt 是毫秒时间戳。 */
export interface TokenResult {
  token: string
  expireAt: number
}

/** 页面跳转目标。 */
export interface NavTarget {
  url?: string
  route?: string
  nav?: NavMode
  external?: boolean
  title?: string
}

/** 导航栏外观。 */
export interface NavBarOptions {
  title?: string
  backgroundColor?: string
  textColor?: string
  hidden?: boolean
}

/** 原生导航栏右侧按钮。 */
export interface NavBarButton {
  id: string
  text: string
  icon?: string
}

/** 原生 Toast 选项。 */
export interface ToastOptions {
  duration?: number
}

/** 原生 Alert 选项。 */
export interface AlertOptions {
  title?: string
  message: string
  confirmText?: string
  cancelText?: string
}

/** 分享内容。 */
export interface ShareOptions {
  title?: string
  desc?: string
  link: string
  imageUrl?: string
}

/** 网络状态，来自原生 `device.getNetwork` 或 `network.change` 事件。 */
export interface NetworkInfo {
  type: 'wifi' | '4g' | '5g' | '3g' | '2g' | 'none' | 'unknown'
  effectiveType?: string
}

/** 定位结果。 */
export interface LocationInfo {
  latitude: number
  longitude: number
  address?: string
}

/** 扫码选项。 */
export interface ScanOptions {
  onlyFromCamera?: boolean
}

/** 扫码结果。 */
export interface ScanResult {
  text: string
}

/** 选图选项。 */
export interface ChooseImageOptions {
  count?: number
  sourceType?: 'camera' | 'album'
}

/** 选图结果，paths 为可直接用于 img 的本地路径 / URL。 */
export interface ChooseImageResult {
  paths: string[]
}

/** 图片预览选项。 */
export interface PreviewImageOptions {
  paths: string[]
  index?: number
}

/** 图片保存选项。 */
export interface SaveImageOptions {
  path: string
}

/** 原生 → H5 事件表，与 docs/bridge-protocol.md 的事件推送表一一对应。 */
export interface BridgeEventPayload {
  'page.resume': void
  'page.pause': void
  'network.change': NetworkInfo
  'nav.rightButtonClick': NavBarButton
  'nav.backPress': void
  'auth.change': { token: string | null }
}

/** 事件名联合类型，由事件表推导。 */
export type BridgeEventName = keyof BridgeEventPayload

/** 浏览器 mock 的存储后端；@h5/core 可注入自己的实现（如带命名空间的封装）。 */
export interface MockStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/**
 * 浏览器 mock 可注入的能力。
 *
 * bridge 是叶子包（不依赖 vant/vue），toast / alert 等 UI 行为由 @h5/core 注入；
 * 未注入时 mock 走 console / localStorage 兜底，保证在 PC 浏览器里永远可跑通。
 */
export interface MockAdapter {
  /** 注入 UI 的 Toast 实现，默认 console.info。 */
  toast?: (message: string, options?: ToastOptions) => void
  /** 注入 UI 的 Alert 实现，默认 console.info。 */
  alert?: (options: AlertOptions) => void
  /** 注入 token 提供者；返回 null 表示未登录，mock 会以 1004 拒绝。 */
  getToken?: () => TokenResult | null | Promise<TokenResult | null>
  /** 注入存储后端，默认 localStorage（不可用时退化到内存 Map）。 */
  storage?: MockStorage
  /** 注入能力列表，默认返回全部已定义方法名。 */
  capabilities?: string[]
  /** 注入埋点实现，默认 console.info。 */
  trackEvent?: (name: string, params?: Record<string, unknown>) => void
  /** 注入定位结果，默认经纬度为 0。 */
  location?: LocationInfo
  /** 注入网络信息，默认按 navigator.onLine 推断。 */
  network?: NetworkInfo
  /** 注入分享实现，默认 console.info。 */
  share?: (options: ShareOptions) => void
  /**
   * 打开后 mock 的 `share.open` 以 `1003`（用户取消）拒绝。
   * 取消是协议里的一等结果（docs/bridge-protocol.md 错误码表），浏览器里必须能演练到。
   */
  cancelShare?: boolean
  /** 注入导航实现（如 vue-router push），默认 history.pushState。 */
  open?: (target: NavTarget) => void
  /** 逃生舱：为任意方法注入自定义实现（返回值即 data）。 */
  handlers?: Record<string, (params: Record<string, unknown>) => unknown>
}
