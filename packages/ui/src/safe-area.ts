import { env } from '@h5/core'

type Side = 'top' | 'bottom'

const PROBE_PADDING: Record<Side, string> = {
  top: 'env(safe-area-inset-top, 0px)',
  bottom: 'env(safe-area-inset-bottom, 0px)',
}

const CSS_VARIABLE: Record<Side, string> = {
  top: '--safe-top',
  bottom: '--safe-bottom',
}

/** 用探测元素的 padding 读出 env() 的真实计算值；不支持时得到 0。 */
function measureInset(side: Side): number {
  if (typeof document === 'undefined') return 0
  const probe = document.createElement('div')
  probe.style.cssText = [
    'position:fixed',
    'top:0',
    'left:0',
    'width:0',
    'height:0',
    'visibility:hidden',
    'pointer-events:none',
    `padding-${side}:${PROBE_PADDING[side]}`,
  ].join(';')
  document.body.appendChild(probe)
  const computed = window.getComputedStyle(probe)
  const raw = side === 'top' ? computed.paddingTop : computed.paddingBottom
  probe.remove()
  const value = Number.parseFloat(raw)
  return Number.isFinite(value) ? value : 0
}

/**
 * 安全区像素值：优先 CSS `env()`，不支持 `env()` 的 Android 机型回落到原生给的
 * `statusBarHeight` / `safeAreaBottom`（设计文档 8.2）。
 *
 * 只在 CSS 变量缺失时用作兜底；正常链路里安全区的真值在 `--safe-top` / `--safe-bottom`。
 */
export function readSafeInset(side: Side): number {
  const measured = measureInset(side)
  if (measured > 0) return measured
  if (side === 'top') return env.safeAreaTop || env.statusBarHeight || 0
  return env.safeAreaBottom || 0
}

/** `@h5/core` / `@h5/styles` 是否已经把安全区写成根元素上的 CSS 变量。 */
function hasSafeAreaVariable(name: string): boolean {
  if (typeof document === 'undefined') return false
  const root = document.documentElement
  if (root.style.getPropertyValue(name).trim() !== '') return true
  return window.getComputedStyle(root).getPropertyValue(name).trim() !== ''
}

/**
 * 安全区内边距的 CSS 值（设计文档 8.2）。
 *
 * `@h5/core` 启动时把量测值写到 `:root` 的 `--safe-top` / `--safe-bottom`，`@h5/styles`
 * 里也有 `env()` 兜底，所以变量在时直接用 `var(--safe-top)`：组件不再自己量一遍，
 * 也不会和 apps 里直接用变量的页面（如 activity）出现两个真值。
 * 变量缺失（`@h5/ui` 独立渲染、core 未启动）时回落到 `readSafeInset()` 的 px 值。
 */
export function safeInsetValue(side: Side): string {
  const name = CSS_VARIABLE[side]
  return hasSafeAreaVariable(name) ? `var(${name})` : `${readSafeInset(side)}px`
}
