import { isAvailable } from './channel'
import { invoke } from './core'
import { CODE, reportBridgeError } from './error'
import { isMockActive } from './mock'
import { METHODS } from './protocol'
import type { BridgeMethod } from './protocol'

/**
 * 隐式自动探测的失败次数上限。
 *
 * canIUse 的典型用法是在 computed / 渲染表达式里判能力（「不支持就隐藏按钮」），
 * 旧版 App 永远回畸形载荷时，若不加限制，每次 canIUse 都会打一次原生调用并挂一个最长 10s 的超时计时器，
 * 一个渲染循环就能放大成 Bridge 洪水。因此隐式探测最多失败 3 次后停止自动重试。
 */
const MAX_IMPLICIT_PROBES = 3

let cachedCapabilities: readonly string[] | null = null
let inflight: Promise<string[]> | null = null
let reportedMalformedPayload = false
let failedProbes = 0

/**
 * 归一化原生返回的能力载荷。
 *
 * 非数组载荷（典型场景：旧版 App 对 `app.getCapabilities` 只回 `{ code: 0 }` 不带 data，
 * invoke 因此 resolve `undefined`）视为「未知」，返回 null——不能当成 `[]`。
 * 真正的数组一律接受：空数组是合法结果，代表「客户端支持该方法但没有任何能力」。
 */
function normalizeCapabilities(payload: unknown): string[] | null {
  if (!Array.isArray(payload)) return null
  return payload.filter((item): item is string => typeof item === 'string')
}

/** 载荷不合法只上报一次（整页一次），复用监控注入的上报通道。 */
function reportMalformedOnce(): void {
  if (reportedMalformedPayload) return
  reportedMalformedPayload = true
  // 复用 @h5/monitor 注入的上报钩子；上报本身不会再触发探测，因此不存在上报循环。
  reportBridgeError(METHODS.app.getCapabilities, CODE.BAD_PARAMS, 'invalid capabilities payload')
}

/**
 * 加载并缓存能力列表（设计文档 5.3）：整个页面生命周期只成功请求一次，
 * 并发调用共享同一个请求；失败后清空 in-flight，允许后续重试。
 *
 * 注意：本函数是「显式」探测（业务主动要能力列表），**不受**隐式探测的失败次数上限约束，
 * 上限只拦截 canIUse / warmCapabilities 触发的自动探测；每次失败都会累加隐式预算。
 */
export function loadCapabilities(): Promise<string[]> {
  if (cachedCapabilities !== null) return Promise.resolve([...cachedCapabilities])
  if (inflight !== null) return inflight

  inflight = invoke<string[]>(METHODS.app.getCapabilities)
    .then((list) => {
      const capabilities = normalizeCapabilities(list)
      if (capabilities === null) {
        // 载荷不合法 = 能力「未知」，不是「一项能力都没有」（设计文档 13.2）。
        // 绝不写入 cachedCapabilities：否则整页会永久按空列表判定，所有能力开关集体失效且无法重试。
        // 清空 in-flight 允许后续调用重新探测；本次返回空数组只为满足 Promise<string[]> 契约。
        inflight = null
        failedProbes += 1
        reportMalformedOnce()
        return []
      }
      cachedCapabilities = capabilities
      return [...capabilities]
    })
    .catch((error: unknown) => {
      inflight = null
      failedProbes += 1
      throw error
    })
  return inflight
}

/**
 * 后台预热能力列表，失败静默（不阻塞启动流程）。
 *
 * 这里只做「隐式」自动探测，因此受失败次数预算约束：失败达到 MAX_IMPLICIT_PROBES 后不再自动请求，
 * 避免 canIUse 在渲染循环里把旧版 App 的畸形响应放大成 Bridge 洪水。
 * 预算耗尽后业务仍可显式调用 loadCapabilities()；也可用 resetCapabilities() 清零预算后重试。
 */
export function warmCapabilities(): void {
  if (cachedCapabilities !== null || inflight !== null) return
  if (failedProbes >= MAX_IMPLICIT_PROBES) return
  void loadCapabilities().catch(() => {
    // 能力探测失败按「未知」处理，不影响业务
  })
}

/**
 * 同步判断方法是否可用。
 *
 * 已缓存能力列表 → 精确判断；未缓存但原生通道存在（或 mock 开启）→ 返回 true，
 * 同时触发一次能力探测，避免旧版 App 上误判导致功能被隐藏。
 *
 * 能力仍为「未知」时（含探测载荷不合法而未缓存的情况）保持乐观：返回 true 并继续尝试探测。
 * 理由：把「未知」当成「不支持」会在旧版 App 上一次性关掉全部能力功能，且写死缓存后无法自愈；
 * 乐观放行只会让个别功能在真正调用时以 1001/-2 失败，错误可被捕获与上报，退化更温和。
 *
 * 参数收窄为 `BridgeMethod`：方法名只能取自 METHODS，写错（如 `'share.opne'`）在编译期报错，
 * 而不是静默返回 false 让功能永久消失。需要探测任意字符串时请显式断言类型，不要放宽本签名。
 */
export function canIUse(method: BridgeMethod): boolean {
  if (cachedCapabilities !== null) return cachedCapabilities.includes(method)
  warmCapabilities()
  return isAvailable() || isMockActive()
}

/**
 * 仅供测试：清空能力缓存与隐式探测预算。
 *
 * 同时把失败次数与「已上报」标记清零，因此也为「回到前台重新探测」这类场景保留了唯一的重置入口。
 */
export function resetCapabilities(): void {
  cachedCapabilities = null
  inflight = null
  reportedMalformedPayload = false
  failedProbes = 0
}

/** 仅供测试：读取已缓存的能力列表（未加载时为 null）。 */
export function cachedCapabilityList(): readonly string[] | null {
  return cachedCapabilities
}
