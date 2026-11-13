import { onBeforeUnmount, onMounted, ref } from 'vue'
import type { Ref } from 'vue'
import { env } from '@h5/core'

/** 视觉视口比布局视口矮出这个值才算键盘弹起，避免地址栏收缩误判。 */
const KEYBOARD_THRESHOLD = 100

/**
 * 软键盘状态（设计文档 8.3）。
 *
 * - 双端：监听 `visualViewport.resize` 得到键盘高度，键盘弹起期间业务可隐藏底部固定栏
 * - iOS：键盘收起后页面可能停在滚动位置不回弹，`focusout` 时执行 `window.scrollTo(0, 0)`
 */
export function useKeyboard(): { visible: Ref<boolean>; height: Ref<number> } {
  const visible = ref(false)
  const height = ref(0)

  let baseline = 0
  let viewport: VisualViewport | null = null

  const measure = (): void => {
    if (viewport === null) return
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
    document.addEventListener('focusout', handleFocusOut)
  })

  onBeforeUnmount(() => {
    viewport?.removeEventListener('resize', measure)
    viewport?.removeEventListener('scroll', measure)
    document.removeEventListener('focusout', handleFocusOut)
    viewport = null
  })

  return { visible, height }
}
