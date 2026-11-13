import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { off, on } from '../src/index'
import { listenerCount } from '../src/core'
import { emitNativeEvent, resetBridgeState } from './helpers'

beforeEach(() => {
  resetBridgeState()
})

afterEach(() => {
  vi.restoreAllMocks()
  resetBridgeState()
})

describe('事件推送', () => {
  it('emit 把数据派发给订阅者', () => {
    const received: unknown[] = []
    on('network.change', (data) => received.push(data))

    emitNativeEvent('network.change', { type: 'wifi' })

    expect(received).toEqual([{ type: 'wifi' }])
  })

  it('多个订阅者都收到；取消订阅后不再收到', () => {
    const first: string[] = []
    const second: string[] = []
    const unsubscribe = on('page.resume', () => first.push('first'))
    const handler = (): void => second.push('second')
    on('page.resume', handler)

    emitNativeEvent('page.resume')
    unsubscribe()
    emitNativeEvent('page.resume')

    expect(first).toEqual(['first'])
    expect(second).toEqual(['second', 'second'])

    off('page.resume', handler)
    emitNativeEvent('page.resume')

    expect(second).toHaveLength(2)
    expect(listenerCount()).toBe(0)
  })

  it('单个监听器抛错不影响同一事件的其他监听器', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const healthy = vi.fn()
    on('nav.backPress', () => {
      throw new Error('listener boom')
    })
    on('nav.backPress', healthy)

    emitNativeEvent('nav.backPress')

    expect(healthy).toHaveBeenCalledTimes(1)
    expect(errorSpy).toHaveBeenCalled()
  })

  it('监听器在派发过程中取消订阅不影响本轮派发', () => {
    const calls: string[] = []
    let unsubscribeThird: () => void = () => undefined
    const cancelFirst = on('page.pause', () => {
      calls.push('first')
      unsubscribeThird()
    })
    unsubscribeThird = on('page.pause', () => calls.push('third'))

    emitNativeEvent('page.pause')
    expect(calls).toEqual(['first', 'third'])
    expect(listenerCount()).toBe(1)

    emitNativeEvent('page.pause')
    expect(calls).toEqual(['first', 'third', 'first'])

    cancelFirst()
    expect(listenerCount()).toBe(0)
  })

  it('没有订阅者时 emit 不抛错', () => {
    expect(() => emitNativeEvent('no.subscriber', { any: true })).not.toThrow()
  })
})
