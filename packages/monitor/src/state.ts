import { useAuthStore } from '@h5/core'
import type { AppEnv } from '@h5/core'

/** initMonitor 的入参（由 createH5App 或业务直接调用时提供）。 */
export interface MonitorOptions {
  appId: string
  env: AppEnv
  /** Sentry DSN；缺省时只做本地记录与打点，不加载 Sentry。 */
  dsn?: string
  /** 性能采样率（0–1），默认 0.15；错误全量上报，不受影响。 */
  sampleRate?: number
  /** false 时全部上报静默（灰度 / 排障用）。 */
  enabled?: boolean
}

/** 上报分类：错误、性能、埋点、Bridge 失败。 */
export type RecordKind = 'error' | 'perf' | 'track' | 'bridge'

/** 一条已采集的上报（也是单测的观察点）。 */
export interface MonitorRecord {
  kind: RecordKind
  name: string
  payload: Record<string, unknown>
  /** 是否通过了采样；false 表示只记录不上报。 */
  sampled: boolean
  at: number
}

const DEFAULT_SAMPLE_RATE = 0.15
const MAX_RECORDS = 200
const MAX_RECENT_ERRORS = 10

interface MonitorState {
  appId: string
  env: AppEnv | null
  dsn: string
  sampleRate: number
  enabled: boolean
  network: string
}

const state: MonitorState = {
  appId: '',
  env: null,
  dsn: '',
  sampleRate: DEFAULT_SAMPLE_RATE,
  enabled: true,
  network: 'unknown',
}

const records: MonitorRecord[] = []
const recentErrors: string[] = []

/** 一条等待 Sentry 就绪后再上报的异常（启动期采集，公共字段此刻还不真实）。 */
export interface PendingCapture {
  error: unknown
  context?: Record<string, unknown>
}

const MAX_PENDING_CAPTURES = 50
const pendingCaptures: PendingCapture[] = []

/**
 * Sentry 就绪前入队：有界（超出丢弃最旧的），且绝不抛错。
 *
 * 启动期的 Bridge 失败（native `app.getInfo` 失败之类的兼容性问题）发生在 `initEnv` 之前，
 * 那一刻 Sentry 还没初始化、`state.env` 还是 null，直接 capture 只会静默丢掉事件。
 */
export function enqueuePendingCapture(entry: PendingCapture): void {
  pendingCaptures.push(entry)
  if (pendingCaptures.length > MAX_PENDING_CAPTURES) pendingCaptures.shift()
}

/**
 * 取走全部待上报异常并清空。
 *
 * 清空发生在捕获**之前**，所以重复 flush（二次 initMonitor、initSentry 重入）不会重复上报。
 */
export function takePendingCaptures(): PendingCapture[] {
  return pendingCaptures.splice(0, pendingCaptures.length)
}

/**
 * 当前登录区间的假名缓存：一次“连续非空 token 期”内保持不变。
 * token 归零（登出）时丢弃 —— 语义与代价见 resolveUid 的注释。
 */
let sessionUid: string | null = null

/**
 * 登录状态转为“无会话”时由 core 通过 `MonitorAdapter.markSessionEnd()` 调用：丢弃本登录区间的假名。
 *
 * 这是换账号不串号的**唯一可靠信号**。不能依赖“换账号会整页 reload”这个旧前提：
 * core/src/auth.ts 的 `applyAuthChange(null)` 只做 `store.clear(); return`，没有 reload，
 * 而登录页没有任何采集点（repo 内 `trackPageView` / `trackEvent` 调用点为 0），
 * 所以 A 登录 → 登出 → B 登录这条路径上 monitor 观察不到任何变化，
 * `sessionUid ??=` 会把 B 的错误继续记在 A 的假名下。
 *
 * 只在“转为无会话”时调用，401 刷新（core/src/request.ts 先 refreshToken 再 setToken）不调用，
 * 因此一次连续非空 token 期内的假名仍然稳定（§11.2 按用户聚合的前提）。
 */
export function markSessionEnd(): void {
  sessionUid = null
}

/** 当前状态（只读视图，供其它模块读取 appId / dsn / env）。 */
export function getState(): Readonly<MonitorState> {
  return state
}

/** 是否启用上报。 */
export function isEnabled(): boolean {
  return state.enabled
}

/** 采样率（0–1）。 */
export function perfSampleRate(): number {
  return state.sampleRate
}

/** 记录初始化参数；initMonitor 调用。 */
export function configure(options: MonitorOptions): void {
  state.appId = options.appId
  state.env = options.env
  state.dsn = options.dsn ?? ''
  state.enabled = options.enabled !== false
  state.sampleRate = clampRate(options.sampleRate)
}

function clampRate(rate: number | undefined): number {
  if (typeof rate !== 'number' || Number.isNaN(rate)) return DEFAULT_SAMPLE_RATE
  return Math.min(1, Math.max(0, rate))
}

/** 采样判定：rate >= 1 直通；随机数落在区间内才算命中。 */
export function shouldSample(rate: number): boolean {
  if (rate >= 1) return true
  if (rate <= 0) return false
  return Math.random() < rate
}

/** 更新网络类型（原生 network.change 推送 / device.getNetwork 拉取）。 */
export function setNetwork(type: string): void {
  state.network = type === '' ? 'unknown' : type
}

/**
 * 公共字段（设计文档 11.2）：业务、版本、App 版本、系统及版本、机型、网络、路由、uid。
 * 每条上报都必须带上，否则线上无法定位到具体版本与机型。
 *
 * `uid` 是登录区间级假名（见 resolveUid），追加的 `uidSource` 显式标出它的来源
 * （`'token-hash'` / `'anon'`），下游不必再猜这个字段到底是不是真实 uid。
 * 两个字段都是追加的：`uid` 字段名保持不变，已有看板与告警口径不受影响。
 */
export function commonFields(): Record<string, unknown> {
  const env = state.env
  const { uid, uidSource } = resolveUid()
  return {
    appId: state.appId,
    h5Version: h5Version(),
    appVersion: env?.appVersion ?? '',
    os: env === null ? 'unknown' : `${env.os} ${env.osVersion}`.trim(),
    device: env?.device ?? 'unknown',
    network: state.network,
    route: currentRoute(),
    uid,
    uidSource,
  }
}

/** 采集记录（有界，避免长时间会话无限增长）。 */
export function record(
  kind: RecordKind,
  name: string,
  payload: Record<string, unknown>,
  sampled: boolean,
): MonitorRecord {
  const entry: MonitorRecord = { kind, name, payload, sampled, at: Date.now() }
  records.push(entry)
  if (records.length > MAX_RECORDS) records.shift()
  return entry
}

/** 最近错误（白屏上报要能带上它们）。 */
export function pushRecentError(message: string): void {
  recentErrors.push(message)
  if (recentErrors.length > MAX_RECENT_ERRORS) recentErrors.shift()
}

export function recentErrorText(): string {
  return recentErrors.join(' | ')
}

/** 最近错误的数组形态；与 core 内联白屏检测的 `recentErrorMessages()` 同形，避免两份上下文格式不一致。 */
export function recentErrorMessages(): string[] {
  return [...recentErrors]
}

/** 仅供测试：读取已采集的记录。 */
export function collectedRecords(): MonitorRecord[] {
  return [...records]
}

/** 仅供测试：清空全部模块级状态。 */
export function resetMonitor(): void {
  records.length = 0
  recentErrors.length = 0
  pendingCaptures.length = 0
  sessionUid = null
  state.appId = ''
  state.env = null
  state.dsn = ''
  state.sampleRate = DEFAULT_SAMPLE_RATE
  state.enabled = true
  state.network = 'unknown'
}

/** 把任意异常转成可上报的文案。 */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message || error.name
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

/**
 * H5 版本 = 构建期注入的 `__APP_VERSION__`（vite define，见 core/env.ts）。
 *
 * 这里不需要 try/catch：对一个未声明的标识符取 `typeof` 不会抛错（单测 / 未走 vite 时
 * 取到 'undefined' 字符串），因此只需要拦住 `undefined` 与空串，缺省按 '0.0.0' 降级。
 *
 * 它与 `env.appVersion`（原生 App 版本）是两个独立来源：后者只来自 UA 的 `MyApp/<版本>`
 * 或原生 `app.getInfo`，缺失时为 `''`（core 不再拿构建版本兜底），因此两者可以区分；
 * 任何一方都**不能**拿另一方反推，也不能互相兜底。
 */
export function h5Version(): string {
  return typeof __APP_VERSION__ === 'string' && __APP_VERSION__ !== '' ? __APP_VERSION__ : '0.0.0'
}

/** 当前路由：监控提交时以真实地址为准，避免依赖 core 的 router 实例。 */
function currentRoute(): string {
  try {
    if (typeof location === 'undefined') return ''
    return `${location.pathname}${location.search}${location.hash}`
  } catch {
    return ''
  }
}

/** `uid` 字段的来源：token 哈希（登录区间级假名）或未登录。 */
export type UidSource = 'token-hash' | 'anon'

/** FNV-1a 32 位的偏移基与质数。 */
const FNV_OFFSET_BASIS = 0x811c9dc5
const FNV_PRIME = 0x01000193
const UID_PREFIX = 'u_'

/**
 * uid 上报值：**登录区间级用户假名**，不是真实 uid，且绝不包含 token 的任何片段。
 *
 * - 取 token 的 FNV-1a 32 位（非加密）哈希，定长渲染为 `u_` + 8 位十六进制：
 *   定长所以不泄露 token 长度；哈希不可逆，无法从上报值还原 token。
 * - **假名在“一次连续非空 token 期”内保持稳定**：首次见到非空 token 时派生一次并缓存，
 *   之后 token 被就地替换（401 刷新，core/src/request.ts:86-87 先 refreshToken() 再
 *   setToken(newToken)）不再重新派生。这正是 §11.2 按用户聚合的前提：刷新若换假名，
 *   同一个用户会被拆成 N 个假名，用户数系统性虚高且几乎无法发现。
 * - 假名缓存的**清空只有两个触发点**，都表示“这段登录区间结束了”：
 *   1. core 在登录态转为“无会话”时调用 `markSessionEnd()`（`applyAuthChange()` 的
 *      `next === null || next === ''` 分支，即 `store.clear()` 那一刻）。这是换账号不串号的
 *      唯一可靠信号；清除后下一个非空 token 重新派生假名。
 *   2. monitor 自己在某个上报点上读到 token 为 null（登出窗口内恰有采集点时的兜底）。
 * - **不要**指望“换账号会整页 reload”这个前提（历史上注释这样写过，是错的）：core/src/auth.ts
 *   的 `applyAuthChange(null)` 只做 `store.clear(); return`，不 reload；登录页也没有任何采集点
 *   （repo 内 `trackPageView` / `trackEvent` 调用点为 0）。所以 A 登录 → 登出 → B 登录这条
 *   路径上，若没有 `markSessionEnd()`，`sessionUid ??=` 会把 B 的错误继续记在 A 的假名下。
 * - 残余限制（本层无法区分，已按更安全的语义取舍）：monitor 只在**上报点上**读 token，也只在
 *   core 主动调用 `markSessionEnd()` 时才知道会话结束。因此“token 被替换、中间没有经过任何
 *   会话结束信号”与一次 401 刷新完全同形，此时保持旧假名 —— 这是刻意的：宁可少计用户，
 *   也不要把一个账号拆成多个假名让每张看板的用户数系统性虚高。代价是缺少 `markSessionEnd()`
 *   的旧版 core 上，换账号仍可能把 B 的错误归到 A 的假名下。
 *   彻底的修法是由原生补一个 uid 方法；Bridge 目前没有（见 docs/bridge-protocol.md 的方法清单，
 *   且与客户端约定不新增），跨会话/跨设备稳定标识必须等原生补该方法。
 * - 未登录（无 token）时为 `'anon'`，`uidSource` 标记为 `'anon'`。
 * - 哈希是**无盐**的：持有候选 token 的一方可以对候选逐一哈希做**确认**（off-line 比对），
 *   因此“无法从假名还原 token”成立，“无法把假名与某个已知 token 关联起来”**不成立**。
 *   加盐 / HMAC 需要构建期密钥，而 H5 的密钥必然随包下发、只能提高成本不能解决，本层不做。
 * - 32 位哈希必然有碰撞：按生日界，约 7.7 万个不同 token 就有 50% 概率撞上一对。
 *   用来“按用户看错误分布”足够，但**不能**当唯一标识；要唯一标识必须由原生给 uid。
 *
 * 旧实现把 token 首尾各 2 位（`ab***gh`）当 uid：4 个真实凭证字符随每条上报进入
 * Sentry / 埋点（Sentry 的 beforeSend 只清洗 token 形状的字段名，`uid` 下的片段
 * 不会被命中）。本实现同时修掉泄露与“刷新即换假名”两点。
 */
function resolveUid(): { uid: string; uidSource: UidSource } {
  const token = readToken()
  if (token === null) {
    sessionUid = null
    return { uid: 'anon', uidSource: 'anon' }
  }
  sessionUid ??= `${UID_PREFIX}${fnv1a32(token).toString(16).padStart(8, '0')}`
  return { uid: sessionUid, uidSource: 'token-hash' }
}

/** FNV-1a 32 位哈希：只求稳定、定长、不可逆，不用于任何安全用途。 */
function fnv1a32(text: string): number {
  let hash = FNV_OFFSET_BASIS
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, FNV_PRIME)
  }
  return hash >>> 0
}

function readToken(): string | null {
  try {
    const token = useAuthStore().token
    return token === null || token === '' ? null : token
  } catch {
    return null
  }
}
