/**
 * @h5/bridge —— App WebView 的 JSBridge 唯一入口。
 *
 * 业务只使用本包导出的有类型 API，禁止直接访问 window.webkit / window.H5Bridge /
 * navigator.userAgent（设计文档 4 / 12.1）；协议见 docs/bridge-protocol.md。
 */

/** 包名，供跨包自检与日志区分使用。 */
export const PACKAGE_NAME = '@h5/bridge'

export { app, auth, device, media, nav, share, storage, track, ui } from './api'
export { canIUse } from './capabilities'
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
