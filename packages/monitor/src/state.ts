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
 * 公共字段（设计文档 11.2）：业务、版本、App 版本、系统及版本、机型、网络、路由、脱敏 uid。
 * 每条上报都必须带上，否则线上无法定位到具体版本与机型。
 */
export function commonFields(): Record<string, unknown> {
  const env = state.env
  return {
    appId: state.appId,
    h5Version: readH5Version(),
    appVersion: env?.appVersion ?? '',
    os: env === null ? 'unknown' : `${env.os} ${env.osVersion}`.trim(),
    device: env?.device ?? 'unknown',
    network: state.network,
    route: currentRoute(),
    uid: maskedUid(),
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

/** uid 脱敏：只保留首尾各 2 位，未登录标记 anon。 */
function maskedUid(): string {
  const token = readToken()
  if (token === null) return 'anon'
  if (token.length <= 4) return '***'
  return `${token.slice(0, 2)}***${token.slice(-2)}`
}

function readToken(): string | null {
  try {
    const token = useAuthStore().token
    return token === null || token === '' ? null : token
  } catch {
    return null
  }
}
