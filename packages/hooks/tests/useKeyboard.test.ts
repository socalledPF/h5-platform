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

beforeEach(() => {
  viewport = new FakeVisualViewport(LAYOUT_HEIGHT)
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: LAYOUT_HEIGHT })
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
