import { onBeforeUnmount, onMounted, ref } from 'vue'
import type { Ref } from 'vue'
import { env } from '@h5/core'

/** 视觉视口比布局视口矮出这个值才算键盘弹起，避免地址栏收缩误判。 */
const KEYBOARD_THRESHOLD = 100

/**
 * 软键盘状态（设计文档 8.3）。
 *
 * - 双端：监听 `visualViewport.resize` / `scroll` 得到键盘高度，键盘弹起期间业务可隐藏底部固定栏
 * - 基线不是一次性的：旋转、地址栏收缩等**非键盘**的视口变化会重设基线，否则
 *   `baseline - visualViewport.height > 100` 永久为真，`visible` 再也回不到 false，
 *   底部固定栏整场会话都回不来
 * - iOS：键盘收起后页面可能停在滚动位置不回弹，`focusout` 时执行 `window.scrollTo(0, 0)`
 */
export function useKeyboard(): { visible: Ref<boolean>; height: Ref<number> } {
  const visible = ref(false)
  const height = ref(0)

  /** 键盘收起时的布局视口高度，也就是比较用的基线。 */
  let baseline = 0
  let viewport: VisualViewport | null = null

  const measure = (): void => {
    // 老 WebView 没有 visualViewport：静默降级，键盘状态一直保持 false
    if (!viewport) return
    const layoutHeight = window.innerHeight
    // 视觉视口仍明显矮于布局视口：键盘还占着高度。
    const keyboardOccupies = visible.value && viewport.height < layoutHeight - KEYBOARD_THRESHOLD
    // 布局视口高度变了（旋转 / 地址栏 / 系统栏）说明这次变化不是键盘，重设基线。
    // 键盘可见期间不重设，否则键盘高度会被算进基线、`visible` 卡在 true。
    if (layoutHeight !== baseline && !keyboardOccupies) baseline = layoutHeight
    const next = Math.round(baseline - viewport.height - viewport.offsetTop)
    const keyboardHeight = next > KEYBOARD_THRESHOLD ? next : 0
    height.value = keyboardHeight
    visible.value = keyboardHeight > 0
  }

  const handleFocusOut = (): void => {
    if (env.os !== 'ios') return
    window.scrollTo(0, 0)
  }

  onMounted(() => {
    baseline = window.innerHeight
    viewport = window.visualViewport
    // Android 键盘弹起只改视觉视口；部分 iOS 版本只推 scroll，两个都听
    viewport?.addEventListener('resize', measure)
    viewport?.addEventListener('scroll', measure)
    // 旋转 / 地址栏收缩不一定经过视觉视口：布局视口变化也听，由 measure 重设基线
    window.addEventListener('resize', measure)
    window.addEventListener('orientationchange', measure)
    document.addEventListener('focusout', handleFocusOut)
  })

  onBeforeUnmount(() => {
    viewport?.removeEventListener('resize', measure)
    viewport?.removeEventListener('scroll', measure)
    window.removeEventListener('resize', measure)
    window.removeEventListener('orientationchange', measure)
    document.removeEventListener('focusout', handleFocusOut)
    viewport = null
  })

  return { visible, height }
}
