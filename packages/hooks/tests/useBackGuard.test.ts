import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'

type Handler = () => boolean | Promise<boolean>

const coreMock = vi.hoisted(() => {
  const stack: Handler[] = []
  return {
    stack,
    registerBackHandler: vi.fn((handler: Handler) => {
      stack.push(handler)
      return () => {
        const index = stack.indexOf(handler)
        if (index >= 0) stack.splice(index, 1)
      }
    }),
    // 与 @h5/core 的约定一致：后进先出，返回 true 表示已消费
    triggerBack: async () => {
      for (let index = stack.length - 1; index >= 0; index -= 1) {
        if (await stack[index]()) return true
      }
      return false
    },
  }
})

vi.mock('@h5/core', () => ({ registerBackHandler: coreMock.registerBackHandler }))

import { useBackGuard } from '../src/useBackGuard'

function mountGuard(handler: Handler) {
  return mount(
    defineComponent({
      setup() {
        useBackGuard(handler)
        return () => h('div')
      },
    }),
  )
}

beforeEach(() => {
  coreMock.stack.length = 0
  vi.clearAllMocks()
})

afterEach(() => {
  coreMock.stack.length = 0
})

describe('useBackGuard', () => {
  it('挂载时注册、卸载时注销', () => {
    const wrapper = mountGuard(() => false)

    expect(coreMock.registerBackHandler).toHaveBeenCalledTimes(1)
    expect(coreMock.stack).toHaveLength(1)

    wrapper.unmount()

    expect(coreMock.stack).toHaveLength(0)
  })

  it('后注册的先执行，返回 true 消费掉本次返回', async () => {
    const first = vi.fn(() => true)
    const second = vi.fn(() => true)

    mountGuard(first)
    const secondWrapper = mountGuard(second)

    await expect(coreMock.triggerBack()).resolves.toBe(true)
    expect(second).toHaveBeenCalledTimes(1)
    expect(first).not.toHaveBeenCalled()

    secondWrapper.unmount()
    await expect(coreMock.triggerBack()).resolves.toBe(true)
    expect(first).toHaveBeenCalledTimes(1)
  })

  it('返回 false 时继续交给下一个处理器', async () => {
    const first = vi.fn(() => true)
    const second = vi.fn(() => false)

    mountGuard(first)
    mountGuard(second)

    await expect(coreMock.triggerBack()).resolves.toBe(true)
    expect(second).toHaveBeenCalledTimes(1)
    expect(first).toHaveBeenCalledTimes(1)
  })

  it('异步处理器（如 confirm 弹窗）返回值同样被采用', async () => {
    const handler = vi.fn(async () => true)

    mountGuard(handler)

    await expect(coreMock.triggerBack()).resolves.toBe(true)
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('全部返回 false 时不消费（交给默认返回行为）', async () => {
    mountGuard(() => false)
    mountGuard(() => false)

    await expect(coreMock.triggerBack()).resolves.toBe(false)
  })
})
