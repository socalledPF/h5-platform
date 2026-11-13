import { installBridgeGlobal, postToNative } from './channel'
import { BridgeError, CODE, normalizeBridgeResult, reportBridgeError } from './error'
import { isMockActive, mockInvoke } from './mock'
import { BRIDGE_VERSION, DEFAULT_TIMEOUT_MS } from './protocol'
import type { BridgeEventName, BridgeEventPayload } from './types'

type AnyEventListener = (data: unknown) => void

interface PendingCall {
  method: string
  resolve: (value: unknown) => void
  reject: (error: BridgeError) => void
  timer: ReturnType<typeof setTimeout>
}

const pendingCalls = new Map<string, PendingCall>()
const listeners = new Map<BridgeEventName, Set<AnyEventListener>>()
let callbackSeq = 0

/**
 * 调用原生方法。
 *
 * - 没有原生通道时立刻以 `-2` 拒绝，并在拒绝前清理 pending / timer；
 * - 超时以 `-1` 拒绝（默认 10s，`auth.login` 使用 120s）；
 * - 原生返回非 0 且非 1003 时上报监控（设计文档 11.2）；
 * - 开启 mock 时路由到 mock 实现，永不依赖原生通道。
 */
export function invoke<T = unknown>(
  method: string,
  params: Record<string, unknown> = {},
  timeout: number = DEFAULT_TIMEOUT_MS,
): Promise<T> {
  if (isMockActive()) return mockInvoke<T>(method, params)
  ensureBridgeGlobal()

  return new Promise<T>((resolve, reject) => {
    const callbackId = `cb_${Date.now()}_${callbackSeq++}`
    const timer = setTimeout(() => {
      pendingCalls.delete(callbackId)
      reject(failWith(CODE.TIMEOUT, 'timeout', method))
    }, timeout)

    pendingCalls.set(callbackId, {
      method,
      resolve: resolve as (value: unknown) => void,
      reject,
      timer,
    })

    const message = JSON.stringify({ method, params, callbackId, version: BRIDGE_VERSION })
    if (postToNative(message)) return

    clearTimeout(timer)
    pendingCalls.delete(callbackId)
    reject(failWith(CODE.NOT_IN_APP, 'not in app', method))
  })
}

/** 订阅原生事件，返回取消订阅函数。 */
export function on<E extends BridgeEventName>(
  event: E,
  fn: (data: BridgeEventPayload[E]) => void,
): () => void {
  ensureBridgeGlobal()
  let group = listeners.get(event)
  if (group === undefined) {
    group = new Set()
    listeners.set(event, group)
  }
  group.add(fn as unknown as AnyEventListener)
  return () => {
    off(event, fn)
  }
}

/** 取消订阅原生事件。 */
export function off<E extends BridgeEventName>(
  event: E,
  fn: (data: BridgeEventPayload[E]) => void,
): void {
  const group = listeners.get(event)
  if (group === undefined) return
  group.delete(fn as unknown as AnyEventListener)
  if (group.size === 0) listeners.delete(event)
}

function failWith(code: number, msg: string, method: string): BridgeError {
  reportBridgeError(method, code, msg)
  return new BridgeError(code, msg, method)
}

function handleNativeCallback(callbackId: string, result: unknown): void {
  const call = pendingCalls.get(callbackId)
  if (call === undefined) return

  clearTimeout(call.timer)
  pendingCalls.delete(callbackId)

  const normalized = normalizeBridgeResult(result)
  if (normalized.code === CODE.OK) {
    call.resolve(normalized.data)
    return
  }
  call.reject(failWith(normalized.code, normalized.msg ?? '', call.method))
}

function handleNativeEmit(event: string, data: unknown): void {
  const group = listeners.get(event as BridgeEventName)
  if (group === undefined) return
  // 复制一份再派发：允许监听器在回调中取消订阅
  for (const listener of [...group]) {
    try {
      listener(data)
    } catch (error) {
      console.error(`[bridge] listener for "${event}" threw:`, error)
    }
  }
}

function ensureBridgeGlobal(): void {
  installBridgeGlobal({ callback: handleNativeCallback, emit: handleNativeEmit })
}

ensureBridgeGlobal()

/** 仅供测试：清空挂起调用与事件订阅，避免用例之间互相影响。 */
export function resetBridgeCore(): void {
  for (const call of pendingCalls.values()) clearTimeout(call.timer)
  pendingCalls.clear()
  listeners.clear()
  callbackSeq = 0
}

/** 仅供测试：当前挂起调用数量，用于验证超时 / 无通道后不残留。 */
export function pendingCount(): number {
  return pendingCalls.size
}

/** 仅供测试：当前事件订阅者总数。 */
export function listenerCount(): number {
  let total = 0
  for (const group of listeners.values()) total += group.size
  return total
}
