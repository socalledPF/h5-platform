import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  auth,
  BridgeError,
  CODE,
  invoke,
  isReportableBridgeFailure,
  setBridgeErrorReporter,
} from '../src/index'
import { pendingCount, resetBridgeCore } from '../src/core'
import { reportBridgeError } from '../src/error'
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

describe('失败上报口径（设计文档 11.2）', () => {
  /** 必须上报：1001 是客户端兼容性信号，1002 / 1004 / -1 是真实失败。 */
  const REPORTED: readonly number[] = [CODE.NOT_FOUND, CODE.BAD_PARAMS, CODE.DENIED, CODE.TIMEOUT]
  /** 不上报：成功、用户取消、以及「不在 App 内」（运行环境事实，不是客户端问题）。 */
  const UNREPORTED: readonly number[] = [CODE.OK, CODE.CANCELED, CODE.NOT_IN_APP]

  it.each(REPORTED)('错误码 %i 上报', (code) => {
    const reporter = vi.fn()
    setBridgeErrorReporter(reporter)

    reportBridgeError('share.open', code, 'boom')

    expect(reporter).toHaveBeenCalledWith('share.open', code, 'boom')
  })

  it.each(UNREPORTED)('错误码 %i 不上报', (code) => {
    const reporter = vi.fn()
    setBridgeErrorReporter(reporter)

    reportBridgeError('share.open', code, 'boom')

    expect(reporter).not.toHaveBeenCalled()
  })

  it('原生新增的未识别码原样上报', () => {
    const reporter = vi.fn()
    setBridgeErrorReporter(reporter)

    reportBridgeError('share.open', 1099, 'unknown code')

    expect(reporter).toHaveBeenCalledWith('share.open', 1099, 'unknown code')
  })

  // 从包入口导入（而不是子模块）：monitor 只能走入口，深导入被仓库禁令挡住
  it('入口导出的判定函数与上报口径同源，可直接供 monitor 过滤', () => {
    for (const code of UNREPORTED) expect(isReportableBridgeFailure(code)).toBe(false)
    for (const code of REPORTED) expect(isReportableBridgeFailure(code)).toBe(true)
    // 未识别的原生新码按可上报处理
    expect(isReportableBridgeFailure(-99)).toBe(true)
  })

  it('-2（没有原生通道）经 invoke 产生时也不上报', async () => {
    const reporter = vi.fn()
    setBridgeErrorReporter(reporter)

    await expect(invoke('device.vibrate')).rejects.toMatchObject({ code: CODE.NOT_IN_APP })

    expect(reporter).not.toHaveBeenCalled()
  })
})

describe('resetBridgeCore 的结算语义', () => {
  it('reset 时把挂起调用以 -2 拒绝，不留悬空 Promise 与计时器', async () => {
    const reporter = vi.fn()
    setBridgeErrorReporter(reporter)
    vi.useFakeTimers()
    installFakeAndroid(() => {
      // 原生永不回调：reset 时这两个调用仍挂在 pending 里
    })

    const first = invoke('device.getLocation')
    const second = invoke('auth.getToken')
    expect(pendingCount()).toBe(2)

    resetBridgeCore()

    await expect(first).rejects.toMatchObject({
      code: CODE.NOT_IN_APP,
      method: 'device.getLocation',
      message: 'bridge reset',
    })
    await expect(second).rejects.toMatchObject({
      code: CODE.NOT_IN_APP,
      method: 'auth.getToken',
    })
    expect(pendingCount()).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
    // reset 是测试 / 环境重建，不是客户端失败，不得计入 11.2 指标
    expect(reporter).not.toHaveBeenCalled()
  })
})
