import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { env } from '../src/env'
import {
  firstScreenStages,
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
    reportPerf: vi.fn(),
  }
}

beforeEach(() => {
  resetMonitorState()
  resetVConsoleState()
  vconsoleConstructor.mockClear()
})

afterEach(() => {
  vi.restoreAllMocks()
  resetMonitorState()
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
  it('记录 js-start / 首屏接口 / 渲染完成三个阶段', () => {
    markFirstScreenApi()

    const stages = firstScreenStages().map(([stage]) => stage)

    expect(stages).toContain('js-start')
    expect(stages).toContain('first-screen-api')
    expect(stages).toContain('render-done')
  })

  it('未记录首屏接口时不上报该阶段', () => {
    const stages = firstScreenStages().map(([stage]) => stage)

    expect(stages).not.toContain('first-screen-api')
  })

  it('各阶段耗时都是非负数', () => {
    for (const [, duration] of firstScreenStages()) {
      expect(duration).toBeGreaterThanOrEqual(0)
      expect(Number.isInteger(duration)).toBe(true)
    }
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
