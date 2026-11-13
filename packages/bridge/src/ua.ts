import type { UAInfo } from './types'

/** 原生约定在 UA 中带上 App 版本，形如 `MyApp/5.6.0`。 */
const APP_VERSION_PATTERN = /MyApp\/([\d.]+)/

const IOS_OS_VERSION_PATTERN = /OS (\d+(?:_\d+)*)/

const ANDROID_OS_VERSION_PATTERN = /Android (\d+(?:\.\d+)*)/

const ANDROID_DEVICE_PATTERN = /Android [^;)]*;\s*([^;)]+)/

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

function matchAndroidDevice(ua: string): string {
  const raw = matchGroup(ua, ANDROID_DEVICE_PATTERN)
  if (raw === null) return 'Android'
  const device = raw.replace(/\s+Build.*$/, '').trim()
  return device === '' ? 'Android' : device
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
