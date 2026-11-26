import { onBeforeUnmount, onMounted, ref } from 'vue'
import type { Ref } from 'vue'
import { env } from '@h5/core'

/** 视觉视口比布局视口矮出这个值才算键盘弹起，避免地址栏收缩误判。 */
const KEYBOARD_THRESHOLD = 100

/** 会唤起软键盘的元素。它们聚焦期间视口变矮一律优先判成键盘。 */
const EDITABLE_TAGS = new Set(['INPUT', 'TEXTAREA'])

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return EDITABLE_TAGS.has(target.tagName) || target.isContentEditable
}

function isEditableFocused(): boolean {
  return isEditable(document.activeElement)
}

/** 基线比视觉视口高出超过阈值才算键盘弹起，否则归零。 */
function keyboardHeightFrom(baseline: number, visualHeight: number): number {
  const gap = Math.round(baseline - visualHeight)
  return gap > KEYBOARD_THRESHOLD ? gap : 0
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
 * - 宽度变化触发的重建是**延后**的：键盘弹起期间旋转时新宽度下的两个高度都还被键盘压着，
 *   当场采纳新基线会把键盘判成收起，等键盘收起或输入聚焦消失后再采纳
 * - iOS：键盘收起后页面可能停在滚动位置不回弹，`focusout` 时执行 `window.scrollTo(0, 0)`；
 *   焦点在字段间移动（`relatedTarget` 仍是可编辑元素）不算收起，不能回弹
 */
export function useKeyboard(): { visible: Ref<boolean>; height: Ref<number> } {
  const visible = ref(false)
  const height = ref(0)

  /** 键盘收起时的布局视口高度，也就是比较用的基线。 */
  let baseline = 0
  /** 建立基线时的布局视口宽度；宽度一变就说明是旋转 / 分屏，基线整个作废。 */
  let baselineWidth = 0
  /**
   * 宽度变化当刻测到的候选基线，`null` 表示没有待定的重建。
   * 旋转当刻键盘可能还压着布局视口，这个候选值本身是「压矮后」的，先存着不采纳。
   */
  let pendingRebaseline: number | null = null
  let viewport: VisualViewport | null = null

  const measure = (): void => {
    // 老 WebView 没有 visualViewport：静默降级，键盘状态一直保持 false
    if (!viewport) return
    const layoutHeight = window.innerHeight
    const layoutWidth = window.innerWidth

    if (layoutWidth !== baselineWidth) {
      // 旋转 / 分屏：宽度变化与软键盘无关，基线需要重建。
      // 但不能立刻采纳 max(innerHeight, visualViewport.height)：adjustResize /
      // `interactive-widget=resizes-content` 下两者都被键盘一起压矮，max 仍是压矮后的值。
      // 竖屏 400×800 被键盘压到 150/150 时旋转 ⇒ 直接采纳会把还在弹起的键盘判成收起。
      // 先记为待定，等有「键盘已收起」的证据再采纳。
      baselineWidth = layoutWidth
      pendingRebaseline = Math.max(layoutHeight, viewport.height)
    } else if (layoutHeight > baseline) {
      // 布局视口变高不可能是键盘（键盘只会压矮它）：地址栏 / 系统栏回缩，抬高基线
      baseline = layoutHeight
    }

    // 视觉视口高度已经不含键盘占的高度；`offsetTop` 只是视觉视口内的滚动偏移。
    // 再减 offsetTop 会把键盘高度抵掉：iOS 为露出输入框上滚 250px 时 800-500-250=50<100，键盘被判成收起。
    let keyboardHeight = keyboardHeightFrom(baseline, viewport.height)

    // 只有「回到基线附近」（keyboardHeight 为 0）才谈得上重设基线：键盘还占着高度时重设，
    // 等于把键盘高度写进基线，之后 next 恒为 0、visible 永远回不到 true。
    // 键盘已收起时仍要求一个非键盘信号：没有任何可编辑元素聚焦。
    // Android adjustResize / `interactive-widget=resizes-content` 会把 innerHeight 和
    // visualViewport.height 一起压矮（设计文档 8.3 的 Android 路径），此时一定有个输入框聚焦，
    // 匿名重设基线就会把这次键盘吞掉——上一版就是这样把检测关死的。
    if (keyboardHeight === 0 && layoutHeight < baseline && !isEditableFocused()) {
      baseline = layoutHeight
    }

    // 待定基线只在拿到「键盘已收起」的证据时才采纳：几何上已回到基线附近，或没有可编辑元素聚焦
    // （键盘不可能在无输入框聚焦时还压着布局视口）。键盘还压着时继续保持旧基线，visible 不翻转。
    // 采纳值取「旋转当刻的候选」与「此刻两个高度」的最大值：任何一者更矮都只可能是键盘压的。
    if (pendingRebaseline !== null && (keyboardHeight === 0 || !isEditableFocused())) {
      baseline = Math.max(pendingRebaseline, layoutHeight, viewport.height)
      pendingRebaseline = null
      keyboardHeight = keyboardHeightFrom(baseline, viewport.height)
    }

    height.value = keyboardHeight
    visible.value = keyboardHeight > 0
  }

  const handleFocusOut = (event: FocusEvent): void => {
    if (env.os !== 'ios') return
    // 焦点从 A 字段移到 B 字段（或点到提交按钮）也会触发 focusout，此时键盘仍开着，
    // 把页面 scrollTo(0, 0) 会让表单整个跳到顶部。只有真正收起键盘才回弹。
    if (isEditable(event.relatedTarget)) return
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
