import { onBeforeUnmount, onMounted, ref } from 'vue'
import type { Ref } from 'vue'
import { env } from '@h5/core'

/** 视觉视口比布局视口矮出这个值才算键盘弹起，避免地址栏收缩误判。 */
const KEYBOARD_THRESHOLD = 100

/** 会唤起软键盘的元素。它们聚焦期间视口变矮一律优先判成键盘。 */
const EDITABLE_TAGS = new Set(['INPUT', 'TEXTAREA'])

function isEditableFocused(): boolean {
  const active = document.activeElement as HTMLElement | null
  if (active === null) return false
  return EDITABLE_TAGS.has(active.tagName) || active.isContentEditable
}

/**
 * 软键盘状态（设计文档 8.3）。
 *
 * - 双端：监听 `visualViewport.resize` / `scroll` 得到键盘高度，键盘弹起期间业务可隐藏底部固定栏
 * - 基线不是一次性的：旋转、地址栏收缩等**非键盘**的视口变化会重设基线，否则
 *   `baseline - visualViewport.height > 100` 永久为真，`visible` 再也回不到 false，
 *   底部固定栏整场会话都回不来
 * - 重设基线必须有独立的非键盘信号（宽度变化 / 无输入聚焦），否则 Android 上键盘与
 *   地址栏的视口变化长得一模一样，一次误重设就会把键盘检测永久关掉
 * - iOS：键盘收起后页面可能停在滚动位置不回弹，`focusout` 时执行 `window.scrollTo(0, 0)`
 */
export function useKeyboard(): { visible: Ref<boolean>; height: Ref<number> } {
  const visible = ref(false)
  const height = ref(0)

  /** 键盘收起时的布局视口高度，也就是比较用的基线。 */
  let baseline = 0
  /** 建立基线时的布局视口宽度；宽度一变就说明是旋转 / 分屏，基线整个作废。 */
  let baselineWidth = 0
  let viewport: VisualViewport | null = null

  const measure = (): void => {
    // 老 WebView 没有 visualViewport：静默降级，键盘状态一直保持 false
    if (!viewport) return
    const layoutHeight = window.innerHeight
    const layoutWidth = window.innerWidth

    if (layoutWidth !== baselineWidth) {
      // 旋转 / 分屏：宽度变化与软键盘无关，基线重建。
      // 取 max 是因为旋转当刻键盘可能还压着布局视口（adjustResize），不能把它算成新基线。
      baselineWidth = layoutWidth
      baseline = Math.max(layoutHeight, viewport.height)
    } else if (layoutHeight > baseline) {
      // 布局视口变高不可能是键盘（键盘只会压矮它）：地址栏 / 系统栏回缩，抬高基线
      baseline = layoutHeight
    }

    // 视觉视口高度已经不含键盘占的高度；`offsetTop` 只是视觉视口内的滚动偏移。
    // 再减 offsetTop 会把键盘高度抵掉：iOS 为露出输入框上滚 250px 时 800-500-250=50<100，键盘被判成收起。
    const next = Math.round(baseline - viewport.height)
    const keyboardHeight = next > KEYBOARD_THRESHOLD ? next : 0

    // 只有「回到基线附近」（keyboardHeight 为 0）才谈得上重设基线：键盘还占着高度时重设，
    // 等于把键盘高度写进基线，之后 next 恒为 0、visible 永远回不到 true。
    // 键盘已收起时仍要求一个非键盘信号：没有任何可编辑元素聚焦。
    // Android adjustResize / `interactive-widget=resizes-content` 会把 innerHeight 和
    // visualViewport.height 一起压矮（设计文档 8.3 的 Android 路径），此时一定有个输入框聚焦，
    // 匿名重设基线就会把这次键盘吞掉——上一版就是这样把检测关死的。
    if (keyboardHeight === 0 && layoutHeight < baseline && !isEditableFocused()) {
      baseline = layoutHeight
    }

    height.value = keyboardHeight
    visible.value = keyboardHeight > 0
  }

  const handleFocusOut = (): void => {
    if (env.os !== 'ios') return
    window.scrollTo(0, 0)
  }

  onMounted(() => {
    baseline = window.innerHeight
    baselineWidth = window.innerWidth
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
