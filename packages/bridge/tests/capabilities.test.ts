import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { app, canIUse, CODE, setBridgeErrorReporter } from '../src/index'
import type { BridgeMethod } from '../src/index'
import { cachedCapabilityList, loadCapabilities, resetCapabilities } from '../src/capabilities'
import { configureMock } from '../src/mock'
import { METHODS } from '../src/protocol'
import { installFakeAndroid, resetBridgeState } from './helpers'

beforeEach(() => {
  resetBridgeState()
})

afterEach(() => {
  vi.restoreAllMocks()
  resetBridgeState()
})

/** 装一个只应答 app.getCapabilities 的假原生通道，并按调用次数给出不同载荷。 */
function installCapabilityNative(reply: (call: number) => unknown): {
  callCount: () => number
  restore: () => void
} {
  let call = 0
  const native = installFakeAndroid((message, respond) => {
    if (message.method !== METHODS.app.getCapabilities) return
    call += 1
    respond(reply(call))
  })
  return { callCount: () => call, restore: native.restore }
}

/** 等一轮探测彻底结算（postMessage → callback → then 链全部跑完，in-flight 已清空）。 */
function flushProbe(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0)
  })
}

/** 旧版 App 能给出的各种「非数组」载荷（invoke 分别 resolve 成 undefined / null / 对象 / 字符串）。 */
const MALFORMED_PAYLOADS: ReadonlyArray<readonly [string, unknown]> = [
  ['{ code: 0 } 无 data → resolve undefined', { code: 0 }],
  ['{ code: 0, data: undefined }', { code: 0, data: undefined }],
  ['{ code: 0, data: null }', { code: 0, data: null }],
  ['{ code: 0, data: 非数组对象 }', { code: 0, data: { capabilities: ['share.open'] } }],
  ['{ code: 0, data: 字符串 }', { code: 0, data: 'share.open' }],
]

describe('能力探测载荷防御（设计文档 13.2）', () => {
  it.each(MALFORMED_PAYLOADS)('载荷 %s 按「未知」处理：不缓存、可重试', async (_label, payload) => {
    const native = installCapabilityNative(() => payload)

    await expect(loadCapabilities()).resolves.toEqual([])
    expect(cachedCapabilityList()).toBeNull()

    // 第二次调用必须真的再次请求原生方法（旧实现会命中 [] 缓存而不再请求）
    await loadCapabilities()
    expect(native.callCount()).toBe(2)
    expect(cachedCapabilityList()).toBeNull()

    native.restore()
  })

  it('载荷不合法时 canIUse 仍保持乐观，不把未知当成不支持', async () => {
    installCapabilityNative(() => ({ code: 0 }))

    await loadCapabilities()
    expect(cachedCapabilityList()).toBeNull()

    // 参数已收窄为 BridgeMethod，这里用真实方法名验证「能力未知 → 乐观 true」的语义
    expect(canIUse(METHODS.device.scan)).toBe(true)
    expect(canIUse('media.chooseImage')).toBe(true)
  })

  it('既无通道也无 mock 时未知仍按原语义返回 false', async () => {
    await expect(loadCapabilities()).rejects.toMatchObject({ code: CODE.NOT_IN_APP })
    expect(canIUse('share.open')).toBe(false)
  })

  it('载荷不合法整页只上报一次错误，且不会形成上报循环', async () => {
    const reporter = vi.fn()
    setBridgeErrorReporter(reporter)
    const native = installCapabilityNative(() => ({ code: 0 }))

    await loadCapabilities()
    await loadCapabilities()
    await loadCapabilities()

    expect(native.callCount()).toBe(3)
    expect(reporter).toHaveBeenCalledTimes(1)
    expect(reporter).toHaveBeenCalledWith(
      METHODS.app.getCapabilities,
      CODE.BAD_PARAMS,
      expect.any(String),
    )
  })

  it('载荷从非法恢复为合法后能正常缓存', async () => {
    const native = installCapabilityNative((call) =>
      call === 1 ? { code: 0 } : { code: 0, data: ['share.open'] },
    )

    await loadCapabilities()
    expect(cachedCapabilityList()).toBeNull()

    await expect(loadCapabilities()).resolves.toEqual(['share.open'])
    expect(cachedCapabilityList()).toEqual(['share.open'])
    expect(native.callCount()).toBe(2)
    expect(canIUse('share.open')).toBe(true)
    expect(canIUse('media.chooseImage')).toBe(false)
  })

  it('mock 返回 undefined 同样按「未知」处理并可重试', async () => {
    let calls = 0
    configureMock({
      handlers: {
        [METHODS.app.getCapabilities]: () => {
          calls += 1
          return undefined
        },
      },
    })

    await loadCapabilities()
    expect(cachedCapabilityList()).toBeNull()

    await loadCapabilities()
    expect(calls).toBe(2)
    expect(cachedCapabilityList()).toBeNull()
  })
})

describe('合法能力列表的缓存语义', () => {
  it('合法空数组照常缓存：canIUse 全为 false 且不再重试', async () => {
    const native = installCapabilityNative(() => ({ code: 0, data: [] }))

    await expect(loadCapabilities()).resolves.toEqual([])
    expect(cachedCapabilityList()).toEqual([])
    expect(canIUse('share.open')).toBe(false)

    await loadCapabilities()
    expect(native.callCount()).toBe(1)
    expect(canIUse('media.chooseImage')).toBe(false)
  })

  it('合法列表精确匹配，且过滤非字符串项', async () => {
    const native = installCapabilityNative(() => ({
      code: 0,
      data: ['share.open', 'auth.getToken', 42, null, { name: 'ui.toast' }],
    }))

    await expect(loadCapabilities()).resolves.toEqual(['share.open', 'auth.getToken'])
    expect(canIUse('share.open')).toBe(true)
    expect(canIUse('auth.getToken')).toBe(true)
    // 运行期仍是精确匹配（不按前缀）：'share' 不是方法名，故为 false；类型层已收窄，故需断言
    expect(canIUse('share' as BridgeMethod)).toBe(false)
    expect(canIUse('media.chooseImage')).toBe(false)

    await loadCapabilities()
    expect(native.callCount()).toBe(1)
  })

  describe('隐式探测上限（畸形载荷下防止 Bridge 洪水）', () => {
    it('200 次 canIUse 只打 3 次原生调用，且每次都乐观返回 true', async () => {
      const native = installCapabilityNative(() => ({ code: 0 }))

      for (let i = 0; i < 200; i += 1) {
        expect(canIUse('share.open')).toBe(true)
        await flushProbe()
      }

      expect(native.callCount()).toBe(3)
      expect(cachedCapabilityList()).toBeNull()
    })

    it('预算耗尽后 resetCapabilities() 清零并可再次探测', async () => {
      const native = installCapabilityNative(() => ({ code: 0 }))

      for (let i = 0; i < 4; i += 1) {
        canIUse('share.open')
        await flushProbe()
      }
      expect(native.callCount()).toBe(3)

      resetCapabilities()
      expect(canIUse('share.open')).toBe(true)
      await flushProbe()
      expect(native.callCount()).toBe(4)
    })

    it('预算耗尽后显式 loadCapabilities() 仍然真正发请求', async () => {
      const native = installCapabilityNative(() => ({ code: 0 }))

      for (let i = 0; i < 4; i += 1) await loadCapabilities()
      expect(native.callCount()).toBe(4)

      // 隐式探测已被预算拦住
      expect(canIUse('share.open')).toBe(true)
      await flushProbe()
      expect(native.callCount()).toBe(4)

      // 显式调用不受上限约束
      await expect(loadCapabilities()).resolves.toEqual([])
      expect(native.callCount()).toBe(5)
    })

    it('mock 分支的畸形载荷同样受预算约束，canIUse 仍乐观返回 true', async () => {
      let calls = 0
      configureMock({
        handlers: {
          [METHODS.app.getCapabilities]: () => {
            calls += 1
            return undefined
          },
        },
      })

      for (let i = 0; i < 6; i += 1) {
        expect(canIUse('share.open')).toBe(true)
        await flushProbe()
      }

      expect(calls).toBe(3)
    })
  })

  it('并发调用共享同一个请求', async () => {
    const native = installCapabilityNative(() => ({ code: 0, data: ['share.open'] }))

    await Promise.all([app.getCapabilities(), app.getCapabilities(), loadCapabilities()])
    expect(native.callCount()).toBe(1)
    expect(cachedCapabilityList()).toEqual(['share.open'])
  })
})
