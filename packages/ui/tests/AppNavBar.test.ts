import { enableAutoUnmount, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NavBarButton } from '@h5/bridge'

// 每个用例结束自动卸载，避免残留实例跟着 navMode 变化继续调用 bridge
enableAutoUnmount(afterEach)

const bridgeMock = vi.hoisted(() => {
  const listeners = new Map<string, (payload: unknown) => void>()
  return {
    listeners,
    setTitle: vi.fn(() => Promise.resolve()),
    setRightButtons: vi.fn(() => Promise.resolve()),
    unsubscribe: vi.fn(),
  }
})

const coreMock = vi.hoisted(() => ({
  goBack: vi.fn(),
}))

vi.mock('@h5/bridge', () => ({
  nav: {
    setTitle: bridgeMock.setTitle,
    setRightButtons: bridgeMock.setRightButtons,
    back: vi.fn(() => Promise.resolve()),
    close: vi.fn(() => Promise.resolve()),
  },
  on: vi.fn((event: string, fn: (payload: unknown) => void) => {
    bridgeMock.listeners.set(event, fn)
    return () => {
      bridgeMock.listeners.delete(event)
      bridgeMock.unsubscribe()
    }
  }),
}))

vi.mock('@h5/core', async () => {
  const { ref } = await import('vue')
  return {
    navMode: ref('native'),
    goBack: coreMock.goBack,
    env: { os: 'ios', statusBarHeight: 20, safeAreaTop: 0, safeAreaBottom: 0 },
  }
})

import { goBack, navMode } from '@h5/core'
import { AppNavBar } from '../src/index'

const HELP: NavBarButton = { id: 'help', text: '帮助' }

const emitNativeRightClick = (button: NavBarButton) => {
  bridgeMock.listeners.get('nav.rightButtonClick')?.(button)
}

const styleOf = (wrapper: ReturnType<typeof mount>) => String(wrapper.attributes('style') ?? '')

beforeEach(() => {
  bridgeMock.listeners.clear()
  bridgeMock.setTitle.mockClear()
  bridgeMock.setRightButtons.mockClear()
  bridgeMock.unsubscribe.mockClear()
  coreMock.goBack.mockClear()
  navMode.value = 'native'
  document.title = ''
})

describe('AppNavBar / 原生模式', () => {
  it('不渲染导航栏内容，只把标题与右侧按钮同步给原生', () => {
    const wrapper = mount(AppNavBar, { props: { title: '我的订单', right: [HELP] } })

    expect(wrapper.find('.app-nav-bar--empty').exists()).toBe(true)
    expect(wrapper.find('[data-testid="app-nav-bar-title"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="app-nav-bar-back"]').exists()).toBe(false)
    expect(wrapper.text()).toBe('')

    expect(bridgeMock.setTitle).toHaveBeenCalledWith('我的订单')
    expect(bridgeMock.setRightButtons).toHaveBeenCalledWith([HELP])
  })

  it('同时设置 document.title（浏览器与旧原生实现兜底）', () => {
    mount(AppNavBar, { props: { title: '订单详情' } })

    expect(document.title).toBe('订单详情')
  })

  it('没有右侧按钮时把空数组同步给原生', () => {
    mount(AppNavBar, { props: { title: '首页' } })

    expect(bridgeMock.setRightButtons).toHaveBeenCalledWith([])
  })

  it('title / right 变化时重新同步', async () => {
    const wrapper = mount(AppNavBar, { props: { title: '旧标题', right: [HELP] } })

    await wrapper.setProps({ title: '新标题', right: [{ id: 'share', text: '分享' }] })

    expect(bridgeMock.setTitle).toHaveBeenLastCalledWith('新标题')
    expect(bridgeMock.setRightButtons).toHaveBeenLastCalledWith([{ id: 'share', text: '分享' }])
    expect(document.title).toBe('新标题')
  })

  it('原生右侧按钮回调只转发生效过的 id', () => {
    const wrapper = mount(AppNavBar, { props: { title: '我的订单', right: [HELP] } })

    emitNativeRightClick(HELP)
    emitNativeRightClick({ id: 'unknown', text: '别的页面' })

    expect(wrapper.emitted('right-click')).toEqual([[HELP]])
  })

  it('卸载时注销原生事件订阅', () => {
    const wrapper = mount(AppNavBar, { props: { title: '我的订单' } })

    wrapper.unmount()

    expect(bridgeMock.unsubscribe).toHaveBeenCalledTimes(1)
    expect(bridgeMock.listeners.has('nav.rightButtonClick')).toBe(false)
  })
})

describe('AppNavBar / H5 模式', () => {
  it('渲染标题、返回按钮与右侧文字按钮，且不调用原生导航栏', () => {
    navMode.value = 'h5'
    const wrapper = mount(AppNavBar, { props: { title: '我的订单', right: [HELP] } })

    expect(wrapper.find('.app-nav-bar--h5').exists()).toBe(true)
    expect(wrapper.find('[data-testid="app-nav-bar-title"]').text()).toBe('我的订单')
    expect(wrapper.find('[data-testid="app-nav-bar-back"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="app-nav-bar-right-help"]').text()).toBe('帮助')

    expect(bridgeMock.setTitle).not.toHaveBeenCalled()
    expect(bridgeMock.setRightButtons).not.toHaveBeenCalled()
  })

  it('点击右侧按钮抛出 right-click', async () => {
    navMode.value = 'h5'
    const wrapper = mount(AppNavBar, { props: { title: '我的订单', right: [HELP] } })

    await wrapper.find('[data-testid="app-nav-bar-right-help"]').trigger('click')

    expect(wrapper.emitted('right-click')).toEqual([[HELP]])
  })

  it('点击返回调用 core.goBack 并抛出 back', async () => {
    navMode.value = 'h5'
    const wrapper = mount(AppNavBar, { props: { title: '我的订单' } })

    await wrapper.find('[data-testid="app-nav-bar-back"]').trigger('click')

    expect(goBack).toHaveBeenCalledTimes(1)
    expect(wrapper.emitted('back')).toHaveLength(1)
  })

  it('showBack=false 时不渲染返回按钮', () => {
    navMode.value = 'h5'
    const wrapper = mount(AppNavBar, { props: { title: '活动页', showBack: false } })

    expect(wrapper.find('[data-testid="app-nav-bar-back"]').exists()).toBe(false)
  })

  it('高度包含状态栏安全区，immersive 时不包含', () => {
    navMode.value = 'h5'
    const normal = mount(AppNavBar, { props: { title: '普通页' } })
    const immersive = mount(AppNavBar, { props: { title: '沉浸页', immersive: true } })

    // jsdom 不支持 env()，走核心 env.statusBarHeight = 20 的兜底
    expect(styleOf(normal)).toContain('--app-nav-safe-top: 20px')
    expect(styleOf(immersive)).toContain('--app-nav-safe-top: 0px')
  })

  it('colors 可覆盖', () => {
    navMode.value = 'h5'
    const wrapper = mount(AppNavBar, {
      props: { title: '主题页', backgroundColor: '#000000', textColor: '#ffffff' },
    })

    const element = wrapper.element as HTMLElement
    expect(element.style.backgroundColor).toBe('rgb(0, 0, 0)')
    expect(element.style.color).toBe('rgb(255, 255, 255)')
  })
})

describe('AppNavBar / none 模式', () => {
  it('不渲染内容，也不调用原生导航栏', () => {
    navMode.value = 'none'
    const wrapper = mount(AppNavBar, { props: { title: '沉浸活动页', right: [HELP] } })

    expect(wrapper.find('.app-nav-bar--empty').exists()).toBe(true)
    expect(wrapper.find('[data-testid="app-nav-bar-title"]').exists()).toBe(false)
    expect(wrapper.text()).toBe('')
    expect(bridgeMock.setTitle).not.toHaveBeenCalled()
    expect(bridgeMock.setRightButtons).not.toHaveBeenCalled()
  })
})

describe('AppNavBar / mode 覆盖', () => {
  it('mode prop 优先于 core 的 navMode', () => {
    navMode.value = 'native'
    const wrapper = mount(AppNavBar, { props: { title: '强制 H5', mode: 'h5' } })

    expect(wrapper.find('.app-nav-bar--h5').exists()).toBe(true)
    expect(bridgeMock.setTitle).not.toHaveBeenCalled()
  })
})
