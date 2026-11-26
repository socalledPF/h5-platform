import { configureMock } from '@h5/bridge'
import { AxiosError } from 'axios'
import type { AxiosAdapter, AxiosResponse } from 'axios'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
// 层序例外（与 create-app.test.ts 借用 bridge 的 resetMock 同例）：这里接通 monitor 包的真实
// 首屏实现，才能验证「core + monitor 合起来只产出一套首屏阶段」这条集成不变量。
// eslint-disable-next-line no-restricted-syntax -- 层序例外：只有接通 monitor 包的真实首屏实现，才能验证「core + monitor 合起来只产出一套首屏阶段」这条集成不变量
import {
  markFirstScreen as monitorMarkFirstScreen,
  markFirstScreenApi as monitorMarkFirstScreenApi,
  reportPerf as monitorReportPerf,
  resetPerf,
} from '../../monitor/src/perf'
// eslint-disable-next-line no-restricted-syntax -- 层序例外：同上，测试要读取 monitor 的真实采集状态做断言
import { collectedRecords, resetMonitor } from '../../monitor/src/state'
import { applyAuthChange, resetAuthState, useAuthStore } from '../src/auth'
import { env } from '../src/env'
import {
  getMonitorAdapter,
  markFirstScreen,
  markFirstScreenApi,
  monitorError,
  monitorTrack,
  recentErrorMessages,
  rememberError,
  resetMonitorState,
  setMonitorAdapter,
} from '../src/monitor'
import { request, resetRequestState } from '../src/request'
import { initVConsole, resetVConsoleState } from '../src/vconsole'
import type { MonitorAdapter } from '../src/types'

const vconsoleConstructor = vi.hoisted(() => vi.fn())

vi.mock('vconsole', () => ({
  default: class {
    constructor(options: unknown) {
      vconsoleConstructor(options)
    }
  },
}))

function createAdapter(): Required<MonitorAdapter> {
  return {
    init: vi.fn(),
    captureError: vi.fn(),
    reportBridgeError: vi.fn(),
    trackEvent: vi.fn(),
    markFirstScreen: vi.fn(),
    markFirstScreenApi: vi.fn(),
    reportPerf: vi.fn(),
    markSessionEnd: vi.fn(),
  }
}

beforeEach(() => {
  resetAuthState()
  resetRequestState()
  resetMonitorState()
  resetMonitor()
  resetPerf()
  resetVConsoleState()
  vconsoleConstructor.mockClear()
})

afterEach(() => {
  vi.restoreAllMocks()
  resetAuthState()
  resetRequestState()
  resetMonitorState()
  resetMonitor()
  resetPerf()
  vi.unstubAllEnvs()
})

describe('监控注入点（core 不 import @h5/monitor）', () => {
  it('注入后错误/埋点都转发给实现', () => {
    const adapter = createAdapter()
    setMonitorAdapter(adapter)

    expect(getMonitorAdapter()).toBe(adapter)
    monitorError(new Error('boom'), { source: 'test' })
    monitorTrack('click', { id: 1 })

    expect(adapter.captureError).toHaveBeenCalledWith(expect.any(Error), { source: 'test' })
    expect(adapter.trackEvent).toHaveBeenCalledWith('click', { id: 1 })
  })

  it('未注入时全部静默', () => {
    expect(getMonitorAdapter()).toBeUndefined()
    expect(() => monitorError(new Error('boom'))).not.toThrow()
    expect(() => monitorTrack('click')).not.toThrow()
    expect(() => markFirstScreen()).not.toThrow()
  })

  it('实现自身抛错不影响业务', () => {
    setMonitorAdapter({
      captureError: () => {
        throw new Error('adapter down')
      },
      trackEvent: () => {
        throw new Error('adapter down')
      },
      markFirstScreen: () => {
        throw new Error('adapter down')
      },
      reportPerf: () => {
        throw new Error('adapter down')
      },
    })

    expect(() => monitorError(new Error('boom'))).not.toThrow()
    expect(() => monitorTrack('click')).not.toThrow()
    expect(() => markFirstScreen()).not.toThrow()
  })

  it('错误缓冲只保留最近 10 条', () => {
    for (let index = 0; index < 12; index += 1) rememberError(`error-${index}`)

    const recent = recentErrorMessages()
    expect(recent).toHaveLength(10)
    expect(recent[0]).toBe('error-2')
    expect(recent.at(-1)).toBe('error-11')
  })

  it('非 Error 值也能转成可读文案', () => {
    rememberError('plain')
    rememberError({ a: 1 })
    rememberError(3n)

    expect(recentErrorMessages()).toEqual(['plain', '{"a":1}', '3'])
  })
})

describe('首屏打点（设计文档 10.1）', () => {
  it('core 只触发一次 markFirstScreen，不再自己逐阶段上报', () => {
    const adapter = createAdapter()
    setMonitorAdapter(adapter)

    markFirstScreen()
    markFirstScreen()

    expect(adapter.markFirstScreen).toHaveBeenCalledTimes(1)
    expect(adapter.reportPerf).not.toHaveBeenCalled()
  })

  it('首屏接口时刻转交监控实现记账（core 不再维护阶段状态）', () => {
    const adapter = createAdapter()
    setMonitorAdapter(adapter)

    markFirstScreenApi()

    expect(adapter.markFirstScreenApi).toHaveBeenCalledTimes(1)
  })

  it('接上 @h5/monitor 后一屏只有一套阶段、只做一次采样判定', () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.9)
    setMonitorAdapter({
      markFirstScreen: monitorMarkFirstScreen,
      markFirstScreenApi: monitorMarkFirstScreenApi,
      reportPerf: monitorReportPerf,
    })

    markFirstScreenApi()
    markFirstScreen()

    const perf = collectedRecords().filter((entry) => entry.kind === 'perf')
    const stages = perf.map((entry) => entry.name)
    // 3 条（无 first-screen-api / html-ready）或 4 条，但绝不是两套阶段叠加的 6~8 条
    expect(perf.length).toBeGreaterThanOrEqual(3)
    expect(perf.length).toBeLessThanOrEqual(4)
    expect(new Set(stages).size).toBe(stages.length)
    expect(stages).toContain('js-start')
    expect(stages).toContain('first-screen-api')
    expect(stages).toContain('render-done')
    // 一批阶段共用一个采样结果：整批要么全采样要么全不采样
    expect(new Set(perf.map((entry) => entry.sampled)).size).toBe(1)
    // 采样只判定一次；旧实现是批量 1 次 + 逐阶段 4 次
    expect(random).toHaveBeenCalledTimes(1)
  })
})

describe('vConsole 注入（设计文档 11.1）', () => {
  it('线上（prod）永不注入', async () => {
    env.isDev = false
    env.isProd = true
    env.isTest = false
    env.isPre = false

    await initVConsole()

    expect(vconsoleConstructor).not.toHaveBeenCalled()
  })

  it('dev 环境仅 App 内注入', async () => {
    env.isDev = true
    env.isProd = false
    env.isApp = false
    await initVConsole()
    expect(vconsoleConstructor).not.toHaveBeenCalled()

    env.isApp = true
    await initVConsole()
    expect(vconsoleConstructor).toHaveBeenCalledTimes(1)
  })

  it('test 环境默认注入，且只注入一次', async () => {
    env.isDev = false
    env.isTest = true

    await initVConsole()
    await initVConsole()

    expect(vconsoleConstructor).toHaveBeenCalledTimes(1)
    expect(vconsoleConstructor).toHaveBeenCalledWith({ theme: 'light' })
  })

  it('pre 环境需要 ?debug=1', async () => {
    env.isDev = false
    env.isTest = false
    env.isPre = true

    window.history.replaceState({}, '', '/?debug=0')
    await initVConsole()
    expect(vconsoleConstructor).not.toHaveBeenCalled()

    window.history.replaceState({}, '', '/?debug=1')
    await initVConsole()
    expect(vconsoleConstructor).toHaveBeenCalledTimes(1)
  })
})

describe('会话结束通知（设计文档 6.1 / 11.2：假名不跨账号）', () => {
  it('登出（applyAuthChange(null)）通知监控作废按用户派生的标识', () => {
    const markSessionEnd = vi.fn()
    setMonitorAdapter({ markSessionEnd })
    const auth = useAuthStore()
    auth.setToken('token-a', 1)

    applyAuthChange(null)

    expect(markSessionEnd).toHaveBeenCalledTimes(1)
    expect(auth.token).toBeNull()

    // 重复登出（登录态本来就是空）幂等：照旧通知一次，但不抛错
    expect(() => applyAuthChange(null)).not.toThrow()
    expect(markSessionEnd).toHaveBeenCalledTimes(2)
  })

  it('同一账号换 token（applyAuthChange 换非空 token）不通知会话结束', () => {
    const markSessionEnd = vi.fn()
    setMonitorAdapter({ markSessionEnd })
    useAuthStore().setToken('token-a', 1)

    applyAuthChange('token-b')

    expect(markSessionEnd).not.toHaveBeenCalled()
  })

  it('未注入监控 / 监控实现抛错时登出照常清空登录态', () => {
    expect(() => applyAuthChange(null)).not.toThrow()

    setMonitorAdapter({
      markSessionEnd: () => {
        throw new Error('monitor down')
      },
    })
    useAuthStore().setToken('token-a', 1)

    expect(() => applyAuthChange(null)).not.toThrow()
    expect(useAuthStore().token).toBeNull()
  })

  it('401 刷新换 token 走 setToken，不触发会话结束（同一用户保留假名）', async () => {
    const markSessionEnd = vi.fn()
    setMonitorAdapter({ markSessionEnd })
    useAuthStore().setToken('token-old', 0)
    configureMock({
      handlers: { 'auth.refreshToken': () => ({ token: 'token-new', expireAt: 1 }) },
    })

    const adapter: AxiosAdapter = async (config) => {
      const authorized = config.headers.get('Authorization') === 'Bearer token-new'
      const response: AxiosResponse = {
        data: authorized ? { code: 0, data: 'ok' } : { code: 401 },
        status: authorized ? 200 : 401,
        statusText: '',
        headers: {},
        config,
      }
      if (authorized) return response
      throw new AxiosError('status 401', '401', config, null, response)
    }

    await expect(request({ url: '/api/a', adapter, retry: 0 })).resolves.toBe('ok')

    expect(useAuthStore().token).toBe('token-new')
    expect(markSessionEnd).not.toHaveBeenCalled()
  })
})
