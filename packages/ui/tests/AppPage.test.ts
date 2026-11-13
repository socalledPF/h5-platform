import { enableAutoUnmount, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { h } from 'vue'

vi.mock('@h5/core', async () => {
  const { ref } = await import('vue')
  return {
    navMode: ref('native'),
    goBack: vi.fn(),
    env: { os: 'ios', statusBarHeight: 20, safeAreaTop: 0, safeAreaBottom: 24 },
  }
})

import { navMode } from '@h5/core'
import { AppPage } from '../src/index'

enableAutoUnmount(afterEach)

const styleOf = (wrapper: ReturnType<typeof mount>) => String(wrapper.attributes('style') ?? '')

beforeEach(() => {
  navMode.value = 'native'
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('AppPage', () => {
  it('原生模式：顶部不额外垫高，底部留安全区', () => {
    const wrapper = mount(AppPage, { slots: { default: () => h('p', '内容') } })

    const style = styleOf(wrapper)
    expect(style).not.toContain('padding-top')
    expect(style).toContain('padding-bottom: 24px')
    expect(wrapper.text()).toContain('内容')
  })

  it('H5 模式：让开导航栏高度 + 状态栏安全区', () => {
    navMode.value = 'h5'
    const wrapper = mount(AppPage)

    expect(styleOf(wrapper)).toContain('padding-top: calc(var(--nav-height) + 20px)')
  })

  it('none 模式：只让开状态栏安全区（页面自绘头部）', () => {
    navMode.value = 'none'
    const wrapper = mount(AppPage)

    expect(styleOf(wrapper)).toContain('padding-top: 20px')
  })

  it('padded=false 时不处理内边距', () => {
    navMode.value = 'h5'
    const wrapper = mount(AppPage, { props: { padded: false } })

    expect(styleOf(wrapper)).not.toContain('padding')
  })

  it('background 覆盖背景色，滚动容器存在', () => {
    const wrapper = mount(AppPage, { props: { background: '#ffffff' } })

    expect((wrapper.element as HTMLElement).style.backgroundColor).toBe('rgb(255, 255, 255)')
    expect(wrapper.find('.app-page__body').exists()).toBe(true)
  })
})
