import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'

const bridgeMock = vi.hoisted(() => {
  const handlers = new Map<string, () => void>()
  const unsubscribed = vi.fn()
  return {
    handlers,
    unsubscribed,
    on: vi.fn((event: string, fn: () => void) => {
      handlers.set(event, fn)
      return () => {
        handlers.delete(event)
        unsubscribed()
      }
    }),
  }
})

vi.mock('@h5/bridge', () => ({ on: bridgeMock.on }))

import { usePageShow } from '../src/usePageShow'

function mountProbe(options?: { immediate?: boolean }) {
  const fn = vi.fn()
  const wrapper = mount(
    defineComponent({
      setup() {
        usePageShow(fn, options)
        return () => h('div')
      },
    }),
  )
  return { fn, wrapper }
}

const emitNativeResume = () => bridgeMock.handlers.get('page.resume')?.()
const emitVisible = () => document.dispatchEvent(new Event('visibilitychange'))

beforeEach(() => {
  bridgeMock.handlers.clear()
  vi.clearAllMocks()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('usePageShow', () => {
  it('页面重新可见时触发：原生 page.resume', () => {
    const { fn } = mountProbe()

    emitNativeResume()

    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('浏览器 visibilitychange 变可见时也触发', () => {
    const { fn } = mountProbe()

    emitVisible()

    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('两个来源在 100ms 内同时到达只回调一次', () => {
    const { fn } = mountProbe()

    emitNativeResume()
    emitVisible()
    vi.advanceTimersByTime(50)
    emitVisible()

    expect(fn).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(120)
    emitNativeResume()

    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('immediate 时挂载即执行一次，且不吞掉紧随其后的真实事件', () => {
    const { fn } = mountProbe({ immediate: true })

    expect(fn).toHaveBeenCalledTimes(1)

    emitNativeResume()

    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('卸载时注销原生监听与 visibilitychange 监听', () => {
    const { fn, wrapper } = mountProbe()

    wrapper.unmount()
    emitNativeResume()
    emitVisible()

    expect(bridgeMock.handlers.has('page.resume')).toBe(false)
    expect(bridgeMock.unsubscribed).toHaveBeenCalledTimes(1)
    expect(fn).not.toHaveBeenCalled()
  })
})
