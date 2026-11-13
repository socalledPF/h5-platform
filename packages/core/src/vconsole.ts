import { env } from './env'

let started = false

/**
 * vConsole（设计文档 11.1）：test 环境默认注入，pre 环境带 `?debug=1` 才注入，
 * dev 环境仅在 App 内注入；线上（prod）永不注入。动态 import，不进首屏包。
 */
export async function initVConsole(): Promise<void> {
  if (started || !shouldEnable()) return
  started = true
  try {
    const { default: VConsole } = await import('vconsole')
    new VConsole({ theme: 'light' })
  } catch {
    // vConsole 加载失败不影响业务
    started = false
  }
}

function shouldEnable(): boolean {
  if (env.isProd) return false
  if (env.isTest) return true
  if (env.isPre) return hasDebugQuery()
  return env.isDev && env.isApp
}

function hasDebugQuery(): boolean {
  try {
    if (typeof location === 'undefined') return false
    return new URLSearchParams(location.search).get('debug') === '1'
  } catch {
    return false
  }
}

/** 仅供测试：重置“已注入”标记。 */
export function resetVConsoleState(): void {
  started = false
}
