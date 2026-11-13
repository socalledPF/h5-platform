import { resetCapabilities } from '../src/capabilities'
import { resetBridgeCore } from '../src/core'
import { setBridgeErrorReporter } from '../src/error'
import { resetMock } from '../src/mock'

/** H5 → 原生的 JSON 消息。 */
export interface NativeMessage {
  method: string
  params: Record<string, unknown>
  callbackId: string
  version: number
}

type Respond = (result: unknown) => void
type OnMessage = (message: NativeMessage, respond: Respond) => void

interface NativeBridgeGlobal {
  callback?: (callbackId: string, result: unknown) => void
  emit?: (event: string, data: unknown) => void
}

interface TestBridgeWindow {
  __H5Bridge?: NativeBridgeGlobal
  webkit?: { messageHandlers?: { H5Bridge?: { postMessage: (payload: string) => void } } }
  H5Bridge?: { postMessage?: (payload: string) => void }
}

interface FakeNative {
  sent: NativeMessage[]
  restore: () => void
}

function testWindow(): TestBridgeWindow {
  return window as unknown as TestBridgeWindow
}

/** 装一个 Android 通道（window.H5Bridge.postMessage）。 */
export function installFakeAndroid(onMessage?: OnMessage): FakeNative {
  const sent: NativeMessage[] = []
  const bridgeWindow = testWindow()
  bridgeWindow.H5Bridge = {
    postMessage(payload: string): void {
      const message = JSON.parse(payload) as NativeMessage
      sent.push(message)
      onMessage?.(message, (result) => respondFromNative(message.callbackId, result))
    },
  }
  return { sent, restore: () => delete bridgeWindow.H5Bridge }
}

/** 装一个 iOS 通道（window.webkit.messageHandlers.H5Bridge.postMessage）。 */
export function installFakeIos(onMessage?: OnMessage): FakeNative {
  const sent: NativeMessage[] = []
  const bridgeWindow = testWindow()
  bridgeWindow.webkit = {
    messageHandlers: {
      H5Bridge: {
        postMessage(payload: string): void {
          const message = JSON.parse(payload) as NativeMessage
          sent.push(message)
          onMessage?.(message, (result) => respondFromNative(message.callbackId, result))
        },
      },
    },
  }
  return { sent, restore: () => delete bridgeWindow.webkit }
}

/** 模拟原生回调。 */
export function respondFromNative(callbackId: string, result: unknown): void {
  testWindow().__H5Bridge?.callback?.(callbackId, result)
}

/** 模拟原生事件推送。 */
export function emitNativeEvent(event: string, data?: unknown): void {
  testWindow().__H5Bridge?.emit?.(event, data)
}

/** 替换 navigator.userAgent，resetBridgeState 会撤销。 */
export function setUserAgent(userAgent: string): void {
  Object.defineProperty(window.navigator, 'userAgent', { value: userAgent, configurable: true })
}

/** 替换 navigator.onLine / navigator.connection，resetBridgeState 会撤销。 */
export function setNavigatorProperty(key: string, value: unknown): void {
  Object.defineProperty(window.navigator, key, { value, configurable: true })
}

/** 每个用例前重置全部模块级状态（挂起调用、订阅、能力缓存、mock、上报钩子）。 */
export function resetBridgeState(): void {
  resetBridgeCore()
  resetCapabilities()
  resetMock()
  setBridgeErrorReporter(null)

  const bridgeWindow = testWindow()
  delete bridgeWindow.H5Bridge
  delete bridgeWindow.webkit

  for (const key of ['userAgent', 'onLine', 'connection']) {
    Reflect.deleteProperty(window.navigator, key)
  }
}
