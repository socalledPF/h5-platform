import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { auth, BridgeError, CODE, invoke, setBridgeErrorReporter } from '../src/index'
import { pendingCount } from '../src/core'
import { installFakeAndroid, installFakeIos, resetBridgeState, respondFromNative } from './helpers'

beforeEach(() => {
  resetBridgeState()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  resetBridgeState()
})

describe('invoke 协议', () => {
  it('按 { method, params, callbackId, version } 发送，并在 code 0 时 resolve data', async () => {
    const native = installFakeAndroid((_message, respond) => {
      respond({ code: CODE.OK, data: { token: 'tk-1', expireAt: 1700000000000 } })
    })

    await expect(auth.getToken()).resolves.toEqual({ token: 'tk-1', expireAt: 1700000000000 })

    expect(native.sent).toHaveLength(1)
    expect(native.sent[0]).toMatchObject({
      method: 'auth.getToken',
      params: {},
      version: 1,
    })
    expect(native.sent[0]?.callbackId).toMatch(/^cb_\d+_\d+$/)
    expect(pendingCount()).toBe(0)
  })

  it('优先使用 iOS 通道，其次才是 Android', async () => {
    const ios = installFakeIos((_message, respond) => respond({ code: CODE.OK, data: 'ios' }))
    const android = installFakeAndroid((_message, respond) =>
      respond({ code: CODE.OK, data: 'android' }),
    )

    await expect(invoke('app.getInfo')).resolves.toBe('ios')

    expect(ios.sent).toHaveLength(1)
    expect(android.sent).toHaveLength(0)
  })

  it.each([CODE.NOT_FOUND, CODE.BAD_PARAMS, CODE.CANCELED, CODE.DENIED])(
    '原生返回 %i 时以 BridgeError 拒绝，并带上 code 与 method',
    async (code) => {
      installFakeAndroid((_message, respond) => respond({ code, data: null, msg: 'native fail' }))

      const error: unknown = await invoke('share.open').catch((reason: unknown) => reason)

      expect(error).toBeInstanceOf(BridgeError)
      expect(error).toMatchObject({ code, method: 'share.open', message: 'native fail' })
    },
  )

  it('非 0 且非用户取消的结果上报监控；取消（1003）不上报', async () => {
    const reporter = vi.fn()
    setBridgeErrorReporter(reporter)
    installFakeAndroid((message, respond) => {
      const code = message.params.failWith === true ? CODE.DENIED : CODE.CANCELED
      respond({ code, data: null, msg: 'reason' })
    })

    await invoke('ui.toast', { failWith: true }).catch(() => undefined)
    await invoke('ui.toast', {}).catch(() => undefined)

    expect(reporter).toHaveBeenCalledTimes(1)
    expect(reporter).toHaveBeenCalledWith('ui.toast', CODE.DENIED, 'reason')
  })

  it('没有原生通道时以 -2 拒绝，且不残留 pending', async () => {
    const error: unknown = await invoke('device.vibrate').catch((reason: unknown) => reason)

    expect(error).toBeInstanceOf(BridgeError)
    expect(error).toMatchObject({ code: CODE.NOT_IN_APP, method: 'device.vibrate' })
    expect(pendingCount()).toBe(0)
  })

  it('超时以 -1 拒绝，并清理 pending 与 timer', async () => {
    vi.useFakeTimers()
    installFakeAndroid(() => {
      // 永不回调，模拟原生无响应
    })

    const promise = invoke('device.getLocation')
    const settled = expect(promise).rejects.toMatchObject({
      code: CODE.TIMEOUT,
      method: 'device.getLocation',
    })
    expect(pendingCount()).toBe(1)

    vi.advanceTimersByTime(10_000)
    await settled

    expect(pendingCount()).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('非法回调载荷按参数错误（1002）拒绝', async () => {
    installFakeAndroid((_message, respond) => respond('not-a-result'))

    await expect(invoke('media.saveImage', { path: '/tmp/a.png' })).rejects.toMatchObject({
      code: CODE.BAD_PARAMS,
      method: 'media.saveImage',
    })
    expect(pendingCount()).toBe(0)
  })

  it('auth.login 使用 120s 长超时', async () => {
    vi.useFakeTimers()
    installFakeAndroid(() => {
      // 原生登录界面长时间不回调
    })

    const settled = expect(auth.login()).rejects.toMatchObject({ code: CODE.TIMEOUT })

    vi.advanceTimersByTime(10_000)
    expect(pendingCount()).toBe(1)

    vi.advanceTimersByTime(110_000)
    await settled

    expect(pendingCount()).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('未知 callbackId 的回调被安全忽略', () => {
    installFakeAndroid()

    expect(() => respondFromNative('cb_unknown_1', { code: 0, data: 'ignored' })).not.toThrow()
    expect(pendingCount()).toBe(0)
  })
})
