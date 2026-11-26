import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { app, canIUse, CODE, loadCapabilities, ready, resetCapabilities } from '../src/index'
import { cachedCapabilityList } from '../src/capabilities'
import { configureMock } from '../src/mock'
import { getUAInfo } from '../src/ua'
import { installFakeAndroid, resetBridgeState, setUserAgent } from './helpers'

beforeEach(() => {
  resetBridgeState()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  resetBridgeState()
})

describe('ready', () => {
  it('通道已存在时立即 resolve(true)', async () => {
    installFakeAndroid()
    await expect(ready()).resolves.toBe(true)
  })

  it('通道晚到也能 resolve(true)，且不残留 timer', async () => {
    vi.useFakeTimers()
    let result: boolean | undefined
    void ready(200).then((value) => {
      result = value
    })

    await vi.advanceTimersByTimeAsync(60)
    expect(result).toBeUndefined()

    installFakeAndroid()
    await vi.advanceTimersByTimeAsync(40)

    expect(result).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('硬截止时间到达仍无通道时 resolve(false)', async () => {
    vi.useFakeTimers()
    let result: boolean | undefined
    void ready(100).then((value) => {
      result = value
    })

    await vi.advanceTimersByTimeAsync(120)

    expect(result).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('并发重复调用各自独立结算', async () => {
    installFakeAndroid()
    await expect(Promise.all([ready(50), ready(50), ready(50)])).resolves.toEqual([
      true,
      true,
      true,
    ])
  })

  it('开启 mock 后不需要原生通道也 resolve(true)', async () => {
    configureMock({})
    await expect(ready(10)).resolves.toBe(true)
  })
})

describe('能力探测 canIUse', () => {
  it('能力未知时返回 true，加载后按缓存判断', async () => {
    configureMock({ capabilities: ['share.open'] })

    expect(cachedCapabilityList()).toBeNull()
    expect(canIUse('share.open')).toBe(true)
    expect(canIUse('media.chooseImage')).toBe(true)

    await app.getCapabilities()

    expect(canIUse('share.open')).toBe(true)
    expect(canIUse('media.chooseImage')).toBe(false)
  })

  it('既无通道也无 mock 时返回 false', () => {
    expect(canIUse('share.open')).toBe(false)
  })

  it('能力列表只请求一次（并发共享同一个请求）', async () => {
    let calls = 0
    configureMock({
      handlers: {
        'app.getCapabilities': () => {
          calls += 1
          return ['auth.getToken']
        },
      },
    })

    await Promise.all([app.getCapabilities(), app.getCapabilities()])
    await app.getCapabilities()

    expect(calls).toBe(1)
    await expect(app.getCapabilities()).resolves.toEqual(['auth.getToken'])
  })

  it('能力探测失败不阻塞，后续可重试', async () => {
    installFakeAndroid((_message, respond) => respond({ code: CODE.NOT_FOUND, msg: 'old app' }))

    await expect(app.getCapabilities()).rejects.toMatchObject({ code: CODE.NOT_FOUND })
    expect(cachedCapabilityList()).toBeNull()
  })

  it('loadCapabilities / resetCapabilities 从包入口可达，探测预算可恢复', async () => {
    configureMock({ capabilities: ['share.open'] })

    // 显式探测从包入口调用：业务代码不允许 import 本包内部模块（本用例的 import 即证据）
    await expect(loadCapabilities()).resolves.toEqual(['share.open'])
    expect(canIUse('share.open')).toBe(true)
    expect(canIUse('media.chooseImage')).toBe(false)

    // 「回到前台重新探测」「App 升级后重连」唯一的重置入口：缓存与失败预算一起清零
    resetCapabilities()
    expect(cachedCapabilityList()).toBeNull()
    expect(canIUse('media.chooseImage')).toBe(true)
  })
})

describe('getUAInfo', () => {
  it('解析 iOS UA', () => {
    setUserAgent(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 16_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MyApp/5.6.0',
    )

    expect(getUAInfo()).toEqual({
      os: 'ios',
      osVersion: '16.3',
      device: 'iPhone',
      appVersion: '5.6.0',
    })
  })

  it('解析 Android UA（带机型）', () => {
    setUserAgent(
      'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP1A.240505.005; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0.0.0 Mobile Safari/537.36 MyApp/5.6.0',
    )

    expect(getUAInfo()).toEqual({
      os: 'android',
      osVersion: '14',
      device: 'Pixel 8',
      appVersion: '5.6.0',
    })
  })

  it('解析 Android UA（无 Build 段）', () => {
    setUserAgent(
      'Mozilla/5.0 (Linux; Android 13; SM-A536B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Mobile Safari/537.36',
    )

    expect(getUAInfo()).toMatchObject({ os: 'android', osVersion: '13', device: 'SM-A536B' })
  })

  it('Chrome 精简 UA 的机型位只有占位符 K，按 unknown 处理', () => {
    setUserAgent(
      'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
    )

    // `K` 是 reduced UA 的占位符，不是机型：报 'K' 会让 §11.2 的 device 维度凭空多出一个「K 机型」
    expect(getUAInfo()).toMatchObject({ os: 'android', osVersion: '10', device: 'unknown' })
  })

  it('HarmonyOS 等定制 ROM：跳过 ROM 名与 wv 段，取最后一个可信机型', () => {
    setUserAgent(
      'Mozilla/5.0 (Linux; Android 12; HarmonyOS; NOH-AL00; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/114.0.0.0 Mobile Safari/537.36',
    )

    // 'HarmonyOS' 是 ROM 名、'wv' 是平台标记，带连字符的 'NOH-AL00' 才是机型
    expect(getUAInfo()).toMatchObject({ os: 'android', osVersion: '12', device: 'NOH-AL00' })
  })

  it('正常 UA 仍取 Build/ 前的机型，不被末尾的 wv 抢走', () => {
    setUserAgent(
      'Mozilla/5.0 (Linux; Android 14; Pixel 6 Build/AP1A.240505.005; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0.0.0 Mobile Safari/537.36 MyApp/5.6.0',
    )

    expect(getUAInfo()).toEqual({
      os: 'android',
      osVersion: '14',
      device: 'Pixel 6',
      appVersion: '5.6.0',
    })
  })

  it('桌面浏览器降级为 web', () => {
    setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    )

    expect(getUAInfo()).toEqual({ os: 'web', osVersion: '', device: 'desktop', appVersion: '' })
  })

  it('UA 为空时不抛错', () => {
    setUserAgent('')
    expect(getUAInfo()).toEqual({ os: 'web', osVersion: '', device: 'unknown', appVersion: '' })
  })
})
