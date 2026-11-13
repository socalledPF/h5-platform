import { onBeforeUnmount, onMounted, ref } from 'vue'
import type { Ref } from 'vue'
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
 * 安全区数值（px），供 canvas、拖拽、固定定位等拿不到 CSS 变量计算值的场景使用。
 *
 * 优先 CSS `env()`；部分 Android 机型 `env()` 恒为 0，回落到原生给的
 * `statusBarHeight` / `safeAreaBottom`（设计文档 8.2）。
 */
export function useSafeArea(): { top: Ref<number>; bottom: Ref<number> } {
  const top = ref(0)
  const bottom = ref(0)

  const measure = (): void => {
    const envTop = measureInset('top')
    const envBottom = measureInset('bottom')
    top.value = envTop > 0 ? envTop : env.safeAreaTop || env.statusBarHeight || 0
    bottom.value = envBottom > 0 ? envBottom : env.safeAreaBottom || 0
  }

  onMounted(() => {
    measure()
    window.addEventListener('resize', measure)
    window.addEventListener('orientationchange', measure)
  })

  onBeforeUnmount(() => {
    window.removeEventListener('resize', measure)
    window.removeEventListener('orientationchange', measure)
  })

  return { top, bottom }
}
