/** 协议版本号，随每次 H5 → 原生消息发送；不兼容变更时递增。 */
export const BRIDGE_VERSION = 1

/** invoke 默认超时（毫秒）。 */
export const DEFAULT_TIMEOUT_MS = 10_000

/** 需要用户交互的长耗时方法（唤起原生登录）超时（毫秒）。 */
export const LONG_TIMEOUT_MS = 120_000

/** ready() 默认等待注入的时间（毫秒）。 */
export const READY_TIMEOUT_MS = 1_000

/** ready() 轮询注入对象的时间间隔（毫秒）。 */
export const READY_POLL_INTERVAL_MS = 30

/** 方法名常量表：业务与 playground 不得硬编码方法字符串。 */
export const METHODS = {
  app: {
    getCapabilities: 'app.getCapabilities',
    getInfo: 'app.getInfo',
  },
  auth: {
    getToken: 'auth.getToken',
    refreshToken: 'auth.refreshToken',
    login: 'auth.login',
    logout: 'auth.logout',
  },
  nav: {
    open: 'nav.open',
    close: 'nav.close',
    back: 'nav.back',
    setTitle: 'nav.setTitle',
    setBar: 'nav.setBar',
    setRightButtons: 'nav.setRightButtons',
    setBackInterceptor: 'nav.setBackInterceptor',
  },
  ui: {
    toast: 'ui.toast',
    loading: 'ui.loading',
    alert: 'ui.alert',
  },
  share: {
    open: 'share.open',
  },
  device: {
    getNetwork: 'device.getNetwork',
    getLocation: 'device.getLocation',
    scan: 'device.scan',
    vibrate: 'device.vibrate',
  },
  media: {
    chooseImage: 'media.chooseImage',
    previewImage: 'media.previewImage',
    saveImage: 'media.saveImage',
  },
  storage: {
    get: 'storage.get',
    set: 'storage.set',
  },
  track: {
    event: 'track.event',
  },
} as const

/** 方法名联合类型。 */
export type BridgeMethod = {
  [K in keyof typeof METHODS]: (typeof METHODS)[K][keyof (typeof METHODS)[K]]
}[keyof typeof METHODS]

/** 全部方法名的扁平列表，供能力探测 / mock 使用。 */
export const METHOD_LIST: readonly string[] = Object.values(METHODS).flatMap((group) =>
  Object.values(group),
)
