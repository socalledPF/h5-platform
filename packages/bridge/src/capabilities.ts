import { isAvailable } from './channel'
import { invoke } from './core'
import { isMockActive } from './mock'
import { METHODS } from './protocol'

let cachedCapabilities: readonly string[] | null = null
let inflight: Promise<string[]> | null = null

/**
 * 加载并缓存能力列表（设计文档 5.3）：整个页面生命周期只成功请求一次，
 * 并发调用共享同一个请求；失败后清空 in-flight，允许后续重试。
 */
export function loadCapabilities(): Promise<string[]> {
  if (cachedCapabilities !== null) return Promise.resolve([...cachedCapabilities])
  if (inflight !== null) return inflight

  inflight = invoke<string[]>(METHODS.app.getCapabilities)
    .then((list) => {
      const capabilities = Array.isArray(list)
        ? list.filter((item): item is string => typeof item === 'string')
        : []
      cachedCapabilities = capabilities
      return [...capabilities]
    })
    .catch((error: unknown) => {
      inflight = null
      throw error
    })
  return inflight
}

/** 后台预热能力列表，失败静默（不阻塞启动流程）。 */
export function warmCapabilities(): void {
  if (cachedCapabilities !== null || inflight !== null) return
  void loadCapabilities().catch(() => {
    // 能力探测失败按「未知」处理，不影响业务
  })
}

/**
 * 同步判断方法是否可用。
 *
 * 已缓存能力列表 → 精确判断；未缓存但原生通道存在（或 mock 开启）→ 返回 true，
 * 同时触发一次能力探测，避免旧版 App 上误判导致功能被隐藏。
 */
export function canIUse(method: string): boolean {
  if (cachedCapabilities !== null) return cachedCapabilities.includes(method)
  warmCapabilities()
  return isAvailable() || isMockActive()
}

/** 仅供测试：清空能力缓存。 */
export function resetCapabilities(): void {
  cachedCapabilities = null
  inflight = null
}

/** 仅供测试：读取已缓存的能力列表（未加载时为 null）。 */
export function cachedCapabilityList(): readonly string[] | null {
  return cachedCapabilities
}
