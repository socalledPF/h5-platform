import type { BridgeResult } from './types'

/** iOS `window.webkit.messageHandlers.H5Bridge` 的最小形状。 */
interface IOSMessageHandler {
  postMessage: (message: string) => void
}

/** Android `addJavascriptInterface` 注入的 `window.H5Bridge` 最小形状。 */
interface AndroidBridge {
  postMessage?: (message: string) => void
}

/** 挂给原生调用的全局对象。 */
export interface BridgeGlobal {
  callback?: (callbackId: string, result: BridgeResult<unknown>) => void
  emit?: (event: string, data: unknown) => void
}

/** 本包需要访问的 window 原生属性；仅此文件允许触碰（设计文档 12.1）。 */
interface BridgeWindow {
  __H5Bridge?: BridgeGlobal
  webkit?: { messageHandlers?: { H5Bridge?: IOSMessageHandler } }
  H5Bridge?: AndroidBridge
}

/** 全局回调处理器签名。 */
export interface BridgeGlobalHandlers {
  callback: (callbackId: string, result: unknown) => void
  emit: (event: string, data: unknown) => void
}

/** 能力探测用：同步判断注入通道是否存在。 */
export function isAvailable(): boolean {
  const bridgeWindow = getBridgeWindow()
  if (bridgeWindow === undefined) return false
  const iosHandler = bridgeWindow.webkit?.messageHandlers?.H5Bridge
  if (typeof iosHandler?.postMessage === 'function') return true
  return typeof bridgeWindow.H5Bridge?.postMessage === 'function'
}

/** 发送 JSON 到原生：先 iOS 后 Android，都不可用时返回 false。 */
export function postToNative(payload: string): boolean {
  const bridgeWindow = getBridgeWindow()
  if (bridgeWindow === undefined) return false

  const iosHandler = bridgeWindow.webkit?.messageHandlers?.H5Bridge
  if (typeof iosHandler?.postMessage === 'function') {
    try {
      iosHandler.postMessage(payload)
      return true
    } catch {
      // iOS 通道抛错时继续尝试 Android 通道
    }
  }

  const androidBridge = bridgeWindow.H5Bridge
  if (typeof androidBridge?.postMessage === 'function') {
    try {
      androidBridge.postMessage(payload)
      return true
    } catch {
      return false
    }
  }
  return false
}

/**
 * 挂载 `window.__H5Bridge`，供原生回调与事件推送调用。
 * 幂等：已挂载同一组处理器时直接返回；被外部覆盖后重新挂载。
 */
export function installBridgeGlobal(handlers: BridgeGlobalHandlers): void {
  const bridgeWindow = getBridgeWindow()
  if (bridgeWindow === undefined) return
  const current = bridgeWindow.__H5Bridge
  if (current?.callback === handlers.callback && current?.emit === handlers.emit) return
  bridgeWindow.__H5Bridge = { callback: handlers.callback, emit: handlers.emit }
}

/** 读取全局原生对象；非浏览器环境返回 undefined。 */
function getBridgeWindow(): BridgeWindow | undefined {
  if (typeof window === 'undefined') return undefined
  return window as unknown as BridgeWindow
}
