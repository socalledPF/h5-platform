import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import type { Ref } from 'vue'

const coreMock = vi.hoisted(() => ({
  env: { os: 'ios', statusBarHeight: 20, safeAreaTop: 0, safeAreaBottom: 34 },
}))

vi.mock('@h5/core', () => ({ env: coreMock.env }))

import { useKeyboard } from '../src/useKeyboard'

class FakeVisualViewport extends EventTarget {
  height: number
  offsetTop = 0

  constructor(height: number) {
    super()
    this.height = height
  }

  press(nextHeight: number): void {
    this.height = nextHeight
    this.dispatchEvent(new Event('resize'))
  }
}

const LAYOUT_HEIGHT = 800
let viewport: FakeVisualViewport
let scrollTo: ReturnType<typeof vi.spyOn>

function mountKeyboard(): { visible: Ref<boolean>; height: Ref<number> } {
  const result = { visible: null, height: null } as unknown as {
    visible: Ref<boolean>
    height: Ref<number>
  }
  mount(
    defineComponent({
      setup() {
        const keyboard = useKeyboard()
        result.visible = keyboard.visible
        result.height = keyboard.height
        return () => h('div')
      },
    }),
  )
  return result
}

function setLayoutHeight(next: number): void {
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: next })
}

/**
 * 模拟旋转 / 地址栏变化：布局视口和视觉视口一起变。
 * 两个事件的到达顺序在真机上不保证，两种顺序都模拟一遍。
 */
function rotate(
  nextLayoutHeight: number,
  nextViewportHeight: number,
  order: 'window-first' | 'viewport-first' = 'window-first',
): void {
  setLayoutHeight(nextLayoutHeight)
  viewport.height = nextViewportHeight
  const layoutEvent = (): void => {
    window.dispatchEvent(new Event('resize'))
  }
  const viewportEvent = (): void => {
    viewport.dispatchEvent(new Event('resize'))
  }
  if (order === 'window-first') {
    layoutEvent()
    viewportEvent()
  } else {
    viewportEvent()
    layoutEvent()
  }
}

beforeEach(() => {
  viewport = new FakeVisualViewport(LAYOUT_HEIGHT)
  setLayoutHeight(LAYOUT_HEIGHT)
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport })
  scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
  coreMock.env.os = 'ios'
})

afterEach(() => {
  scrollTo.mockRestore()
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: undefined })
})

describe('useKeyboard', () => {
  it('键盘弹起：visualViewport 变矮时 visible 为 true 并给出高度', () => {
    const keyboard = mountKeyboard()

    expect(keyboard.visible.value).toBe(false)

    viewport.press(LAYOUT_HEIGHT - 320)

    expect(keyboard.visible.value).toBe(true)
    expect(keyboard.height.value).toBe(320)
  })

  it('键盘收起：高度恢复后归零', () => {
    const keyboard = mountKeyboard()

    viewport.press(LAYOUT_HEIGHT - 320)
    viewport.press(LAYOUT_HEIGHT)

    expect(keyboard.visible.value).toBe(false)
    expect(keyboard.height.value).toBe(0)
  })

  it('小幅视口变化（地址栏收缩）不算键盘', () => {
    const keyboard = mountKeyboard()

    viewport.press(LAYOUT_HEIGHT - 40)

    expect(keyboard.visible.value).toBe(false)
    expect(keyboard.height.value).toBe(0)
  })

  it('收起状态旋转（800→400）：visible 保持 false，键盘按新基线量', () => {
    const keyboard = mountKeyboard()

    rotate(400, 400)

    expect(keyboard.visible.value).toBe(false)

    // 新基线 400：键盘 250 高 → height 250；若仍用旧基线 800 会得到 550
    viewport.press(150)

    expect(keyboard.visible.value).toBe(true)
    expect(keyboard.height.value).toBe(250)
  })

  it('收起状态旋转：视觉视口事件先到也不会误判键盘', () => {
    const keyboard = mountKeyboard()

    rotate(400, 400, 'viewport-first')

    expect(keyboard.visible.value).toBe(false)

    viewport.press(150)

    expect(keyboard.visible.value).toBe(true)
    expect(keyboard.height.value).toBe(250)
  })

  it('orientationchange 也会重设基线', () => {
    const keyboard = mountKeyboard()

    setLayoutHeight(400)
    viewport.height = 400
    window.dispatchEvent(new Event('orientationchange'))

    expect(keyboard.visible.value).toBe(false)

    viewport.press(150)

    expect(keyboard.visible.value).toBe(true)
    expect(keyboard.height.value).toBe(250)
  })

  it('键盘可见期间旋转：不重设基线，仍为 true', () => {
    const keyboard = mountKeyboard()

    viewport.press(LAYOUT_HEIGHT - 320)
    rotate(400, 240)

    expect(keyboard.visible.value).toBe(true)
  })

  it('键盘可见期间旋转后再收起键盘：能回到 false（基线随之恢复）', () => {
    const keyboard = mountKeyboard()

    viewport.press(LAYOUT_HEIGHT - 320)
    rotate(400, 240)
    viewport.press(400)

    expect(keyboard.visible.value).toBe(false)
    expect(keyboard.height.value).toBe(0)
  })

  it('部分 iOS 只推 visualViewport.scroll 时也能识别键盘', () => {
    const keyboard = mountKeyboard()

    viewport.height = LAYOUT_HEIGHT - 300
    viewport.dispatchEvent(new Event('scroll'))

    expect(keyboard.visible.value).toBe(true)
    expect(keyboard.height.value).toBe(300)
  })

  it('没有 visualViewport 时静默降级', () => {
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: undefined })

    const keyboard = mountKeyboard()
    window.dispatchEvent(new Event('resize'))

    expect(keyboard.visible.value).toBe(false)
    expect(keyboard.height.value).toBe(0)
  })

  it('iOS 失焦后回弹页面到顶部', () => {
    mountKeyboard()

    document.dispatchEvent(new Event('focusout'))

    expect(scrollTo).toHaveBeenCalledWith(0, 0)
  })

  it('Android 失焦不做 iOS 专用回弹', () => {
    coreMock.env.os = 'android'
    mountKeyboard()

    document.dispatchEvent(new Event('focusout'))

    expect(scrollTo).not.toHaveBeenCalled()
  })

  it('卸载后不再响应视口变化', () => {
    const keyboard = { visible: null, height: null } as unknown as {
      visible: Ref<boolean>
      height: Ref<number>
    }
    const wrapper = mount(
      defineComponent({
        setup() {
          const result = useKeyboard()
          keyboard.visible = result.visible
          keyboard.height = result.height
          return () => h('div')
        },
      }),
    )

    wrapper.unmount()
    viewport.press(LAYOUT_HEIGHT - 320)

    expect(keyboard.visible.value).toBe(false)
  })
})
