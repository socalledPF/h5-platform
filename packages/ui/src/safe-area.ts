import { env } from '@h5/core'

type Side = 'top' | 'bottom'

const PROBE_PADDING: Record<Side, string> = {
  top: 'env(safe-area-inset-top, 0px)',
  bottom: 'env(safe-area-inset-bottom, 0px)',
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
 * 用固定值而不是纯 CSS 变量，是为了让导航栏高度与页面内边距拿到同一个数，
 * 避免"导航栏按原生状态栏撑开、页面按 0 垫高"造成重叠。
 */
export function readSafeInset(side: Side): number {
  const measured = measureInset(side)
  if (measured > 0) return measured
  if (side === 'top') return env.safeAreaTop || env.statusBarHeight || 0
  return env.safeAreaBottom || 0
}
