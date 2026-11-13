import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import type { Ref } from 'vue'

const coreMock = vi.hoisted(() => ({
  env: { os: 'android', statusBarHeight: 24, safeAreaTop: 0, safeAreaBottom: 34 },
}))

vi.mock('@h5/core', () => ({ env: coreMock.env }))

import { useSafeArea } from '../src/useSafeArea'

function mountSafeArea(): { top: Ref<number>; bottom: Ref<number> } {
  const result = { top: null, bottom: null } as unknown as {
    top: Ref<number>
    bottom: Ref<number>
  }
  mount(
    defineComponent({
      setup() {
        const area = useSafeArea()
        result.top = area.top
        result.bottom = area.bottom
        return () => h('div')
      },
    }),
  )
  return result
}

beforeEach(() => {
  coreMock.env.statusBarHeight = 24
  coreMock.env.safeAreaTop = 0
  coreMock.env.safeAreaBottom = 34
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useSafeArea', () => {
  it('env() 不可用时回退到原生给的状态栏 / 安全区高度', () => {
    const area = mountSafeArea()

    expect(area.top.value).toBe(24)
    expect(area.bottom.value).toBe(34)
  })

  it('env() 生效时以 CSS 计算值为准（Android 报 0 也能被覆盖）', () => {
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      paddingTop: '47px',
      paddingBottom: '34px',
    } as unknown as CSSStyleDeclaration)

    const area = mountSafeArea()

    expect(area.top.value).toBe(47)
    expect(area.bottom.value).toBe(34)
  })

  it('探测元素用完即移除，不污染 DOM', () => {
    mountSafeArea()

    expect(document.body.children).toHaveLength(0)
  })

  it('窗口尺寸变化后重新测量', () => {
    const area = mountSafeArea()
    coreMock.env.statusBarHeight = 44

    window.dispatchEvent(new Event('resize'))

    expect(area.top.value).toBe(44)
  })
})
