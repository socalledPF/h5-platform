import type { UAInfo } from './types'

/** 原生约定在 UA 中带上 App 版本，形如 `MyApp/5.6.0`。 */
const APP_VERSION_PATTERN = /MyApp\/([\d.]+)/

const IOS_OS_VERSION_PATTERN = /OS (\d+(?:_\d+)*)/

const ANDROID_OS_VERSION_PATTERN = /Android (\d+(?:\.\d+)*)/

/** `Android x;` 之后的整段机型信息（取到 `)` 为止），逐段挑出真正的机型名。 */
const ANDROID_DEVICE_SEGMENTS_PATTERN = /Android [^;)]*;([^)]*)/

/**
 * 可能出现在机型位、却不是机型名的记号：Chrome 精简 UA 的占位符 `K` / `U`、`HarmonyOS` 一类 ROM 名、
 * WebView 的 `wv` 平台标记。这些值一旦流进设计文档 11.2 的 device 维度，会把机型大盘污染成
 * 「K 机型占一半」「HarmonyOS 机型」这种无意义的分组。
 */
const NON_MODEL_SEGMENTS = new Set([
  'android',
  'build',
  'harmonyos',
  'k',
  'linux',
  'mobile',
  'safari',
  'u',
  'version',
  'wv',
])

/**
 * 同步解析 UA，永远不抛错（设计文档 4 / 12.1：UA 访问只允许在本包内）。
 * 非 App 浏览器返回 `os: 'web'`，SSR 下同样安全。
 */
export function getUAInfo(): UAInfo {
  const ua = readUserAgent()
  if (ua === '') return { os: 'web', osVersion: '', device: 'unknown', appVersion: '' }

  const appVersion = matchGroup(ua, APP_VERSION_PATTERN) ?? ''
  const iosDevice = matchIosDevice(ua)
  if (iosDevice !== null) {
    return {
      os: 'ios',
      osVersion: (matchGroup(ua, IOS_OS_VERSION_PATTERN) ?? '').replace(/_/g, '.'),
      device: iosDevice,
      appVersion,
    }
  }
  if (ua.includes('Android')) {
    return {
      os: 'android',
      osVersion: matchGroup(ua, ANDROID_OS_VERSION_PATTERN) ?? '',
      device: matchAndroidDevice(ua),
      appVersion,
    }
  }
  return { os: 'web', osVersion: '', device: 'desktop', appVersion }
}

function matchIosDevice(ua: string): string | null {
  if (ua.includes('iPad')) return 'iPad'
  if (ua.includes('iPhone')) return 'iPhone'
  if (ua.includes('iPod')) return 'iPod'
  // iPadOS 13+ 默认请求桌面站点，UA 与 macOS 相同，只能靠触摸点数区分
  if (ua.includes('Macintosh') && readMaxTouchPoints() > 1) return 'iPad'
  return null
}

/**
 * 从 `Android x; …` 的各段里挑机型。
 *
 * 机型不是「第一段」：Chrome 精简 UA 只有 `Android 10; K`，HarmonyOS / 定制 ROM 会先塞一段 ROM 名
 * （`Android 12; HarmonyOS; NOH-AL00`），WebView 还会在机型后面补 `wv`。因此按段过滤掉不可信的记号，
 * 取最后一个可信段——它要么是带连字符的真机型（`NOH-AL00`、`SM-A536B`），要么是 `Build/` 前那段
 * （`Pixel 6 Build/…`）；一个可信段都没有时说明 UA 根本没给机型，返回 `unknown` 而不是把 `K` 当机型。
 */
function matchAndroidDevice(ua: string): string {
  const raw = matchGroup(ua, ANDROID_DEVICE_SEGMENTS_PATTERN)
  if (raw === null) return 'unknown'
  const models = raw.split(';').map(normalizeDeviceSegment).filter(isPlausibleModel)
  return models[models.length - 1] ?? 'unknown'
}

/** 去掉机型段尾部的 `Build/<fingerprint>` 与首尾空白。 */
function normalizeDeviceSegment(raw: string): string {
  return raw.replace(/\s+Build.*$/, '').trim()
}

function isPlausibleModel(segment: string): boolean {
  // 单字符段是 Chrome 精简 UA 的占位符（`K`），不是机型
  if (segment.length < 2) return false
  if (NON_MODEL_SEGMENTS.has(segment.toLowerCase())) return false
  // 机型名以大写字母或数字开头；小写开头的是 `wv`、`zh-cn` 一类平台/语言记号
  return /^[A-Z0-9]/.test(segment)
}

function matchGroup(source: string, pattern: RegExp): string | null {
  const matched = pattern.exec(source)
  return matched?.[1] ?? null
}

function readUserAgent(): string {
  try {
    if (typeof navigator === 'undefined') return ''
    return typeof navigator.userAgent === 'string' ? navigator.userAgent : ''
  } catch {
    return ''
  }
}

function readMaxTouchPoints(): number {
  try {
    if (typeof navigator === 'undefined') return 0
    return typeof navigator.maxTouchPoints === 'number' ? navigator.maxTouchPoints : 0
  } catch {
    return 0
  }
}
