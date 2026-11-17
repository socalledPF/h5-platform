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
 * `uid` 是会话级假名（见 resolveUid），追加的 `uidSource` 显式标出它的来源
 * （`'token-hash'` / `'anon'`），下游不必再猜这个字段到底是不是真实 uid。
 * 两个字段都是追加的：`uid` 字段名保持不变，已有看板与告警口径不受影响。
 */
export function commonFields(): Record<string, unknown> {
  const env = state.env
  const { uid, uidSource } = resolveUid()
  return {
    appId: state.appId,
    h5Version: readH5Version(),
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
 * H5 版本取构建期注入的 `__APP_VERSION__`（vite define，见 core/env.ts）；
 * 单测 / 未走 vite 的场景没有该常量，按 '0.0.0' 降级而不是抛错。
 */
function readH5Version(): string {
  try {
    if (typeof __APP_VERSION__ === 'string' && __APP_VERSION__ !== '') return __APP_VERSION__
  } catch {
    // 未注入时读取裸标识符可能抛错，按降级处理
  }
  return '0.0.0'
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

/** `uid` 字段的来源：token 哈希（会话级假名）或未登录。 */
export type UidSource = 'token-hash' | 'anon'

/** FNV-1a 32 位的偏移基与质数。 */
const FNV_OFFSET_BASIS = 0x811c9dc5
const FNV_PRIME = 0x01000193
const UID_PREFIX = 'u_'

/**
 * uid 上报值：**会话级用户假名**，不是真实 uid，且绝不包含 token 的任何片段。
 *
 * - 取当前 token 的 FNV-1a 32 位（非加密）哈希，定长渲染为 `u_` + 8 位十六进制：
 *   定长所以不泄露 token 长度，哈希不可逆所以无法从上报值还原 token。
 * - 哈希只依赖 token 本身，同一 token 恒定 —— §11.2 的按用户聚合因此成立。
 * - token 被重新签发（换会话登录、换账号）后假名随之改变：这是**会话级**假名，
 *   跨会话无法把同一账号串联起来。Bridge 没有原生 uid 方法（见
 *   docs/bridge-protocol.md 的方法清单，且与客户端约定不新增），要做到跨会话稳定
 *   必须由原生补一个 uid 方法。
 * - 未登录（无 token）时为 `'anon'`，`uidSource` 标记为 `'anon'`。
 * - 32 位哈希必然有碰撞：按生日界，约 7.7 万个不同 token 就有 50% 概率撞上一对。
 *   用来“按用户看错误分布”足够，但**不能**当唯一标识；要唯一标识必须由原生给 uid。
 *
 * 旧实现把 token 首尾各 2 位（`ab***gh`）当 uid：4 个真实凭证字符随每条上报进入
 * Sentry / 埋点（Sentry 的 beforeSend 只清洗 token 形状的字段名，`uid` 下的片段
 * 不会被命中），同时因为 token 每次刷新都变而破坏按用户聚合。本实现同时修掉这两点。
 */
function resolveUid(): { uid: string; uidSource: UidSource } {
  const token = readToken()
  if (token === null) return { uid: 'anon', uidSource: 'anon' }
  const hex = fnv1a32(token).toString(16).padStart(8, '0')
  return { uid: `${UID_PREFIX}${hex}`, uidSource: 'token-hash' }
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
