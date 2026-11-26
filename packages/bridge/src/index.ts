/**
 * @h5/bridge —— App WebView 的 JSBridge 唯一入口。
 *
 * 业务只使用本包导出的有类型 API，禁止直接访问 window.webkit / window.H5Bridge /
 * navigator.userAgent（设计文档 4 / 12.1）；协议见 docs/bridge-protocol.md。
 */

/** 包名，供跨包自检与日志区分使用。 */
export const PACKAGE_NAME = '@h5/bridge'

export { app, auth, device, media, nav, share, storage, track, ui } from './api'
/**
 * 能力探测：`canIUse` 同步判断，`loadCapabilities` 显式拉取，`resetCapabilities` 清空缓存与隐式探测预算。
 *
 * `resetCapabilities` 是「回到前台重新探测」「App 升级后重连」唯一的重置入口（见 capabilities.ts），
 * 因此必须从包入口导出——业务代码不得直接 import 本包内部模块。
 */
export { canIUse, loadCapabilities, resetCapabilities } from './capabilities'
export { isAvailable } from './channel'
export { invoke, off, on } from './core'
export { BridgeError, CODE, isReportableBridgeFailure, setBridgeErrorReporter } from './error'
export { configureMock } from './mock'
export {
  BRIDGE_VERSION,
  DEFAULT_TIMEOUT_MS,
  LONG_TIMEOUT_MS,
  METHOD_LIST,
  METHODS,
  READY_TIMEOUT_MS,
} from './protocol'
export { ready } from './ready'
export { getUAInfo } from './ua'

export type { BridgeCode, BridgeErrorReporter } from './error'
export type { BridgeMethod } from './protocol'
export type {
  AlertOptions,
  AppInfo,
  BridgeEventName,
  BridgeEventPayload,
  BridgeResult,
  ChooseImageOptions,
  ChooseImageResult,
  LocationInfo,
  MockAdapter,
  MockStorage,
  NavBarButton,
  NavBarOptions,
  NavMode,
  NavTarget,
  NetworkInfo,
  PreviewImageOptions,
  SaveImageOptions,
  ScanOptions,
  ScanResult,
  ShareOptions,
  ToastOptions,
  TokenResult,
  UAInfo,
} from './types'
