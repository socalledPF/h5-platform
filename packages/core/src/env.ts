import { app as bridgeApp, getUAInfo, isAvailable } from '@h5/bridge'
import type { AppEnv } from './types'

declare global {
  /** 由 vite define 注入；单测环境下为 undefined。 */
  const __APP_VERSION__: string | undefined
  const __BUILD_TIME__: string | undefined
  const __APP_ID__: string | undefined
}

/** 读取 app.getInfo 的最大等待时间：原生迟迟不回也不能拖死启动。 */
const APP_INFO_TIMEOUT_MS = 800

/** 运行环境快照：createH5App / initEnv 就地更新，业务始终引用同一个对象。 */
export const env: AppEnv = {
  isApp: false,
  appId: '',
  appVersion: '',
  os: 'web',
  osVersion: '',
  device: 'unknown',
  isDev: true,
  isTest: false,
  isPre: false,
  isProd: false,
  buildTime: '',
  statusBarHeight: 0,
  safeAreaTop: 0,
  safeAreaBottom: 0,
  apiBaseUrl: '',
  cdnBase: '',
}

interface EnvStage {
  isDev: boolean
  isTest: boolean
  isPre: boolean
  isProd: boolean
}

/**
 * 环境识别（设计文档 4、9.3）：UA / 注入通道判断是否在 App 内，VITE_APP_ENV 判断环境，
 * 在 App 内时用 `app.getInfo()` 补齐状态栏高度与安全区。任何原生信息拿不到都只是降级，不抛错。
 */
export async function initEnv(overrides: Partial<AppEnv> = {}): Promise<AppEnv> {
  const ua = getUAInfo()
  const stage = resolveStage(overrides)
  const isApp = overrides.isApp ?? (isAvailable() || ua.appVersion !== '')

  Object.assign(env, {
    isApp,
    appId: overrides.appId ?? readBuildConstant('appId'),
    appVersion: overrides.appVersion ?? (ua.appVersion || readBuildConstant('appVersion')),
    os: ua.os,
    osVersion: ua.osVersion,
    device: ua.device,
    // 几何信息每次重新推算：原生接口缺字段时不得残留上一次的值（对应 11.2 的降级要求）
    statusBarHeight: 0,
    safeAreaTop: 0,
    safeAreaBottom: 0,
    buildTime: overrides.buildTime ?? readBuildConstant('buildTime'),
    apiBaseUrl: overrides.apiBaseUrl ?? readMeta('VITE_API_BASE_URL'),
    cdnBase: overrides.cdnBase ?? readMeta('VITE_CDN_BASE'),
    ...stage,
    ...overrides,
  } satisfies Partial<AppEnv>)

  if (env.isApp) await applyNativeAppInfo()
  return env
}

/**
 * 原生信息可能缺失，失败时保留 UA 推算结果。
 *
 * 原生答 `{ code: 0 }` 却没有 `data`（旧版本或客户端缺陷）时必须降级而不是抛错：
 * initEnv 抛错会让 createH5App 整体 reject，main.ts 的 `.then(mount)` 永不执行，
 * 用户看到的是永久白屏（正是设计文档 11.2 白屏检测要观测的失败形态）。
 * 部分可用的载荷（如只有 appVersion / os）照常采用，缺的字段保留原值或归零。
 */
async function applyNativeAppInfo(): Promise<void> {
  const info = await withTimeout(
    bridgeApp.getInfo().catch(() => null),
    APP_INFO_TIMEOUT_MS,
  )
  if (!isRecord(info)) return

  const appVersion = readString(info.appVersion)
  if (appVersion !== '') env.appVersion = appVersion

  const os = readOs(info.os)
  if (os !== null) env.os = os

  const osVersion = readString(info.osVersion)
  if (osVersion !== '') env.osVersion = osVersion

  const device = readString(info.device)
  if (device !== '') env.device = device

  env.statusBarHeight = toPositiveNumber(info.statusBarHeight)
  env.safeAreaTop = toPositiveNumber(info.safeAreaTop)
  env.safeAreaBottom = toPositiveNumber(info.safeAreaBottom)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readOs(value: unknown): AppEnv['os'] | null {
  return value === 'ios' || value === 'android' || value === 'web' ? value : null
}

function withTimeout<T>(task: Promise<T | null>, timeoutMs: number): Promise<T | null> {
  return new Promise<T | null>((resolve) => {
    const timer = setTimeout(() => {
      resolve(null)
    }, timeoutMs)
    void task.then((value) => {
      clearTimeout(timer)
      resolve(value)
    })
  })
}

function toPositiveNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

/** VITE_APP_ENV 决定环境开关；显式 overrides 优先，便于测试与灰度。 */
function resolveStage(overrides: Partial<AppEnv>): EnvStage {
  const explicit = ['isDev', 'isTest', 'isPre', 'isProd'].some((key) => key in overrides)
  if (explicit) {
    return {
      isDev: overrides.isDev ?? false,
      isTest: overrides.isTest ?? false,
      isPre: overrides.isPre ?? false,
      isProd: overrides.isProd ?? false,
    }
  }
  const raw = readMeta('VITE_APP_ENV').toLowerCase()
  return {
    isDev: raw === 'dev' || raw === '',
    isTest: raw === 'test',
    isPre: raw === 'pre' || raw === 'staging',
    isProd: raw === 'prod' || raw === 'production',
  }
}

function readMeta(key: string): string {
  try {
    const meta = import.meta as unknown as { env?: Record<string, string | undefined> }
    return meta.env?.[key] ?? ''
  } catch {
    return ''
  }
}

function readBuildConstant(name: 'appVersion' | 'buildTime' | 'appId'): string {
  try {
    if (name === 'appVersion' && typeof __APP_VERSION__ === 'string') return __APP_VERSION__
    if (name === 'buildTime' && typeof __BUILD_TIME__ === 'string') return __BUILD_TIME__
    if (name === 'appId' && typeof __APP_ID__ === 'string') return __APP_ID__
  } catch {
    // 未注入（单测 / 未走 vite 的场景）按空值处理
  }
  return ''
}
