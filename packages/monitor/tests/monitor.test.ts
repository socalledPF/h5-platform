import { configureMock } from '@h5/bridge'
import { useAuthStore } from '@h5/core'
import type { App } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toMonitorAdapter } from '../src/adapter'
import {
  captureError,
  installVueErrorHandlers,
  reportBridgeError,
  resetErrorHandlers,
} from '../src/error'
import { initMonitor, resetMonitorRuntime } from '../src/init'
import { markFirstScreen, reportPerf, resetPerf } from '../src/perf'
import { initSentry, isSentryReady, resetSentry, sentryCapture } from '../src/sentry'
import {
  collectedRecords,
  getState,
  pushRecentError,
  recentErrorText,
  resetMonitor,
} from '../src/state'
import type { MonitorOptions } from '../src/state'
import { trackEvent, trackPageView } from '../src/track'

const sentryInit = vi.hoisted(() => vi.fn())
const sentryCaptureMock = vi.hoisted(() => vi.fn())

vi.mock('@sentry/vue', () => ({
  init: sentryInit,
  captureException: sentryCaptureMock,
}))

const testEnv: MonitorOptions['env'] = {
  isApp: true,
  appId: 'member',
  appVersion: '5.6.0',
  os: 'ios',
  osVersion: '16.3',
  device: 'iPhone 14',
  isDev: false,
  isTest: false,
  isPre: false,
  isProd: true,
  buildTime: '2025-01-01T00:00:00.000Z',
  statusBarHeight: 44,
  safeAreaTop: 47,
  safeAreaBottom: 34,
  apiBaseUrl: 'https://api.example.com',
  cdnBase: 'https://cdn.example.com/member/',
}

function recordsOf(kind: string): Record<string, unknown>[] {
  return collectedRecords()
    .filter((entry) => entry.kind === kind)
    .map((entry) => entry.payload)
}

function initDefault(overrides: Partial<MonitorOptions> = {}): void {
  initMonitor({ appId: 'member', env: testEnv, ...overrides })
}

beforeEach(() => {
  resetMonitor()
  resetPerf()
  resetSentry()
  resetMonitorRuntime()
  resetErrorHandlers()
  useAuthStore().clear()
  window.history.replaceState({}, '', '/member/order?id=1')
  configureMock({
    handlers: { 'track.event': () => undefined, 'device.getNetwork': () => ({ type: 'wifi' }) },
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
  resetErrorHandlers()
  resetMonitor()
})

describe('initMonitor（设计文档 11.2）', () => {
  it('没有 dsn 时仍然记录，只是不加载 Sentry', async () => {
    initDefault()

    captureError(new Error('boom'))

    expect(collectedRecords()).toHaveLength(1)
    expect(collectedRecords()[0]).toMatchObject({ kind: 'error', name: 'js_error', sampled: true })
  })

  it('enabled: false 时整体静默', () => {
    initDefault({ enabled: false })

    captureError(new Error('boom'))
    reportPerf('render', 10)
    reportBridgeError('share.open', 1001, 'not found')
    trackEvent('click')

    expect(collectedRecords()).toHaveLength(0)
  })

  it('公共字段齐全（appId / 版本 / 系统 / 机型 / 网络 / 路由 / 脱敏 uid）', () => {
    useAuthStore().setToken('abcdefgh')
    initDefault()

    captureError(new Error('boom'), { extra: 1 })

    const [payload] = recordsOf('error')
    expect(payload).toMatchObject({
      appId: 'member',
      appVersion: '5.6.0',
      os: 'ios 16.3',
      device: 'iPhone 14',
      route: '/member/order?id=1',
      uid: 'ab***gh',
      message: 'boom',
      extra: 1,
    })
    // 未注入 __APP_VERSION__ 时降级，而不是静默上报一个假版本
    expect(payload.h5Version).toBe('0.0.0')
    expect(typeof payload.network).toBe('string')
  })

  it('h5Version 取构建期注入的 __APP_VERSION__（设计文档 11.2 / 9.4）', () => {
    vi.stubGlobal('__APP_VERSION__', '1.4.2')
    initDefault()

    captureError(new Error('boom'))
    trackEvent('click')
    reportPerf('render', 10)

    expect(recordsOf('error')[0].h5Version).toBe('1.4.2')
    expect(recordsOf('track')[0].h5Version).toBe('1.4.2')
    expect(recordsOf('perf')[0].h5Version).toBe('1.4.2')
  })

  it('__APP_VERSION__ 为空串时不被当成有效版本', () => {
    vi.stubGlobal('__APP_VERSION__', '')
    initDefault()

    captureError(new Error('boom'))

    expect(recordsOf('error')[0].h5Version).toBe('0.0.0')
  })

  it('未登录时 uid 记为 anon', () => {
    initDefault()

    captureError(new Error('boom'))

    expect(recordsOf('error')[0].uid).toBe('anon')
  })

  it('toMonitorAdapter 暴露 core 需要的全部钩子，init 转接到 initMonitor', () => {
    const adapter = toMonitorAdapter()

    expect(Object.keys(adapter).sort()).toEqual([
      'captureError',
      'init',
      'markFirstScreen',
      'reportBridgeError',
      'reportPerf',
      'trackEvent',
    ])

    adapter.init?.({ appId: 'activity', env: testEnv })
    captureError(new Error('boom'))
    expect(recordsOf('error')[0].appId).toBe('activity')
  })

  it('toMonitorAdapter({ dsn }) 在 init 时把 dsn 交给 Sentry', async () => {
    const adapter = toMonitorAdapter({ dsn: 'https://x@y/z' })

    adapter.init?.({ appId: 'member', env: testEnv })

    await vi.waitFor(() => {
      expect(sentryInit).toHaveBeenCalledTimes(1)
    })
    expect(sentryInit).toHaveBeenCalledWith(
      expect.objectContaining({ dsn: 'https://x@y/z', environment: 'prod' }),
    )
    expect(isSentryReady()).toBe(true)
  })

  it('toMonitorAdapter() 不带参数时行为不变：不加载 Sentry 但仍记录', async () => {
    const adapter = toMonitorAdapter()

    expect(() => adapter.init?.({ appId: 'member', env: testEnv })).not.toThrow()
    captureError(new Error('boom'))
    await Promise.resolve()

    expect(sentryInit).not.toHaveBeenCalled()
    expect(recordsOf('error')[0]).toMatchObject({ appId: 'member', message: 'boom' })
  })

  it('toMonitorAdapter 的 sampleRate / enabled 与 core 传入的 appId / env 合并', () => {
    const adapter = toMonitorAdapter({ enabled: false })

    adapter.init?.({ appId: 'activity', env: testEnv })
    trackEvent('click')
    reportPerf('render', 10)

    expect(collectedRecords()).toHaveLength(0)
    expect(getState()).toMatchObject({
      appId: 'activity',
      enabled: false,
      sampleRate: 0.15,
    })
  })
})

describe('采样（设计文档 11.2：错误全量、性能 10%–20%）', () => {
  it('错误恒为全量，即使随机数落在采样区间外', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999)
    initDefault({ sampleRate: 0.1 })

    captureError(new Error('boom'))

    expect(collectedRecords()[0].sampled).toBe(true)
  })

  it('性能按采样率丢弃：随机数大于采样率时不命中', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.9)
    initDefault({ sampleRate: 0.15 })

    reportPerf('render', 12)

    expect(collectedRecords()[0]).toMatchObject({ kind: 'perf', sampled: false })
  })

  it('性能命中采样时上报，耗时取整且非负', async () => {
    const sent: Record<string, unknown>[] = []
    configureMock({
      handlers: {
        'track.event': (params: Record<string, unknown>) => {
          sent.push(params)
          return undefined
        },
      },
    })
    vi.spyOn(Math, 'random').mockReturnValue(0.01)
    initDefault({ sampleRate: 0.15 })

    reportPerf('render', 12.6)
    await Promise.resolve()

    expect(collectedRecords()[0]).toMatchObject({ kind: 'perf', sampled: true })
    expect(collectedRecords()[0].payload.durationMs).toBe(13)
    expect(sent[0]).toMatchObject({ name: 'perf' })
  })

  it('性能未命中采样时不走上报通道', async () => {
    const sent: Record<string, unknown>[] = []
    configureMock({
      handlers: {
        'track.event': (params: Record<string, unknown>) => {
          sent.push(params)
          return undefined
        },
      },
    })
    vi.spyOn(Math, 'random').mockReturnValue(0.99)
    initDefault({ sampleRate: 0.15 })

    reportPerf('render', 12)
    await Promise.resolve()

    expect(sent).toHaveLength(0)
  })

  it('sampleRate 为 0 / 1 的边界', () => {
    const random = vi.spyOn(Math, 'random')

    initDefault({ sampleRate: 0 })
    reportPerf('a', 1)
    expect(collectedRecords()[0].sampled).toBe(false)

    resetMonitor()
    initDefault({ sampleRate: 1 })
    reportPerf('b', 1)
    expect(collectedRecords()[0].sampled).toBe(true)
    expect(random).not.toHaveBeenCalled()
  })
})

describe('Bridge 失败上报（设计文档 11.2）', () => {
  it('用户取消（1003）与成功（0）不上报', () => {
    initDefault()

    reportBridgeError('share.open', 1003, 'canceled')
    reportBridgeError('share.open', 0, 'ok')

    expect(collectedRecords()).toHaveLength(0)
  })

  it('方法不存在（1001）记录方法名与错误码', () => {
    initDefault()

    reportBridgeError('device.scan', 1001, 'not found')

    const records = collectedRecords()
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({ kind: 'bridge', name: 'device.scan' })
    expect(records[0].payload).toMatchObject({
      method: 'device.scan',
      code: 1001,
      msg: 'not found',
    })
  })
})

describe('埋点（设计文档 11.3）', () => {
  it('trackEvent 记录并发给原生 track.event', async () => {
    const sent: Record<string, unknown>[] = []
    configureMock({
      handlers: {
        'track.event': (params: Record<string, unknown>) => {
          sent.push(params)
          return undefined
        },
      },
    })
    initDefault()

    trackEvent('order_pay_click', { id: 'p1' })
    await Promise.resolve()

    expect(sent[0]).toMatchObject({ name: 'order_pay_click' })
    expect(recordsOf('track')[0]).toMatchObject({ appId: 'member', id: 'p1' })
  })

  it('trackPageView 上报 page_view', () => {
    initDefault()

    trackPageView('/member/order')

    expect(collectedRecords()[0]).toMatchObject({ kind: 'track', name: 'page_view' })
    expect(collectedRecords()[0].payload.path).toBe('/member/order')
  })
})

describe('首屏打点（设计文档 10.1）', () => {
  it('markFirstScreen 记录各阶段且只执行一次', () => {
    initDefault()

    markFirstScreen()
    const count = collectedRecords().length
    markFirstScreen()

    const stages = collectedRecords()
      .filter((entry) => entry.kind === 'perf')
      .map((entry) => entry.name)
    expect(stages).toContain('js-start')
    expect(stages).toContain('render-done')
    expect(collectedRecords().length).toBe(count)
  })

  it('非法阶段名与非法耗时被安全处理', () => {
    initDefault()

    reportPerf('', 10)
    reportPerf('stage', Number.NaN)

    expect(collectedRecords()).toHaveLength(1)
    expect(collectedRecords()[0].payload.durationMs).toBe(0)
  })
})

describe('全局错误采集（设计文档 11.2）', () => {
  function stubApp(): App {
    return { config: {} } as App
  }

  it('app.config.errorHandler 采集 Vue 错误', () => {
    initDefault()
    const app = stubApp()
    installVueErrorHandlers(app)

    app.config.errorHandler?.(new Error('render failed'), null, 'render function')

    expect(recordsOf('error')[0]).toMatchObject({ message: 'render failed', source: 'vue' })
  })

  it('window error 事件采集脚本错误', () => {
    initDefault()
    installVueErrorHandlers(stubApp())

    window.dispatchEvent(
      new ErrorEvent('error', {
        error: new Error('window boom'),
        message: 'window boom',
        filename: 'app.js',
        lineno: 12,
        colno: 3,
      }),
    )

    expect(recordsOf('error')[0]).toMatchObject({
      message: 'window boom',
      source: 'window.onerror',
      filename: 'app.js',
      lineno: 12,
    })
  })

  it('资源加载失败在捕获阶段被采集', () => {
    initDefault()
    installVueErrorHandlers(stubApp())
    const image = document.createElement('img')
    document.body.appendChild(image)

    image.dispatchEvent(new Event('error', { bubbles: true }))

    expect(recordsOf('error')[0]).toMatchObject({ source: 'resource' })
    image.remove()
  })

  it('unhandledrejection 采集未处理的 Promise 异常', () => {
    initDefault()
    installVueErrorHandlers(stubApp())
    const event = new Event('unhandledrejection') as Event & { reason?: unknown }
    Object.defineProperty(event, 'reason', { value: new Error('promise boom') })

    window.dispatchEvent(event)

    expect(recordsOf('error')[0]).toMatchObject({
      message: 'promise boom',
      source: 'unhandledrejection',
    })
  })
})

describe('initMonitor 自带窗口级错误监听', () => {
  it('只调 initMonitor 也能采集 window.onerror', () => {
    initDefault()

    window.dispatchEvent(
      new ErrorEvent('error', { error: new Error('no vue install'), message: 'x' }),
    )

    expect(recordsOf('error')[0]).toMatchObject({
      message: 'no vue install',
      source: 'window.onerror',
    })
  })
})

describe('Sentry 懒加载（设计文档 11.2）', () => {
  it('没有 dsn 时不加载 Sentry', async () => {
    initDefault()
    await Promise.resolve()

    expect(sentryInit).not.toHaveBeenCalled()
    expect(isSentryReady()).toBe(false)
  })

  it('dev 环境即使有 dsn 也不加载', async () => {
    initMonitor({
      appId: 'member',
      env: { ...testEnv, isProd: false, isDev: true },
      dsn: 'https://example.com/1',
    })
    await Promise.resolve()

    expect(sentryInit).not.toHaveBeenCalled()
  })

  it('线上且配置 dsn 时动态加载并初始化', async () => {
    initMonitor({ appId: 'member', env: testEnv, dsn: 'https://key@sentry.example.com/1' })

    await vi.waitFor(() => {
      expect(sentryInit).toHaveBeenCalledTimes(1)
    })
    expect(sentryInit).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: 'https://key@sentry.example.com/1',
        environment: 'prod',
        release: 'member@5.6.0',
      }),
    )
    expect(isSentryReady()).toBe(true)
  })

  it('Sentry 就绪后错误会同步过去', async () => {
    initMonitor({ appId: 'member', env: testEnv, dsn: 'https://key@sentry.example.com/1' })
    await vi.waitFor(() => {
      expect(isSentryReady()).toBe(true)
    })

    const error = new Error('captured by sentry')
    captureError(error)

    expect(sentryCaptureMock).toHaveBeenCalledWith(
      error,
      expect.objectContaining({ extra: expect.anything() }),
    )
  })

  it('未就绪时 sentryCapture 静默', () => {
    expect(() => sentryCapture(new Error('no sentry'))).not.toThrow()
    expect(sentryCaptureMock).not.toHaveBeenCalled()
  })

  it('initSentry 的 dsn 为空 / 环境为 dev 时直接返回', async () => {
    await expect(
      initSentry({ dsn: '', environment: 'prod', release: 'x' }),
    ).resolves.toBeUndefined()
    await expect(
      initSentry({ dsn: 'https://x/1', environment: 'dev', release: 'x' }),
    ).resolves.toBeUndefined()
    expect(sentryInit).not.toHaveBeenCalled()
  })
})

describe('网络信息（公共字段）', () => {
  it('启动时拉取一次网络类型', async () => {
    configureMock({ handlers: { 'device.getNetwork': () => ({ type: 'wifi' }) } })
    initDefault()

    await vi.waitFor(() => {
      captureError(new Error('probe'))
      expect(recordsOf('error').at(-1)?.network).toBe('wifi')
    })
  })

  it('原生 network.change 推送更新网络类型', () => {
    initDefault()
    const bridgeWindow = window as unknown as {
      __H5Bridge?: { emit?: (event: string, data?: unknown) => void }
    }

    bridgeWindow.__H5Bridge?.emit?.('network.change', { type: '5g' })
    captureError(new Error('probe'))

    expect(recordsOf('error')[0].network).toBe('5g')
  })

  it('重复 initMonitor 仍能正常接收网络变化', () => {
    initDefault()
    initDefault()
    const bridgeWindow = window as unknown as {
      __H5Bridge?: { emit?: (event: string, data?: unknown) => void }
    }

    bridgeWindow.__H5Bridge?.emit?.('network.change', { type: '4g' })
    captureError(new Error('probe'))

    expect(recordsOf('error')).toHaveLength(1)
    expect(recordsOf('error')[0].network).toBe('4g')
  })
})

describe('资源与兜底分支', () => {
  function stubApp(): App {
    return { config: {} } as App
  }

  it('link 用 href 作为资源地址；无地址的资源也能上报', () => {
    initDefault()
    installVueErrorHandlers(stubApp())
    const link = document.createElement('a')
    link.href = 'https://cdn.example.com/app.css'
    const div = document.createElement('div')
    document.body.append(link, div)

    link.dispatchEvent(new Event('error', { bubbles: true }))
    div.dispatchEvent(new Event('error', { bubbles: true }))

    const urls = recordsOf('error').map((payload) => payload.url)
    expect(urls).toContain('https://cdn.example.com/app.css')
    expect(urls).toContain('')
    link.remove()
    div.remove()
  })

  it('window 上的无信息 error 事件使用兜底文案', () => {
    initDefault()
    installVueErrorHandlers(stubApp())

    window.dispatchEvent(new Event('error'))

    expect(recordsOf('error')[0]).toMatchObject({
      message: 'window error',
      source: 'window.onerror',
    })
  })

  it('兜底文案：短 token 与非 JSON 可序列化值', async () => {
    initDefault()
    useAuthStore().setToken('ab')
    captureError(new Error('short token'))
    expect(recordsOf('error')[0].uid).toBe('***')

    const circular: Record<string, unknown> = {}
    circular.self = circular
    const { errorMessage } = await import('../src/state')
    expect(errorMessage(circular)).toBe(String(circular))
  })
})

describe('失败兜底', () => {
  it('埋点上报失败不影响业务', async () => {
    configureMock({
      handlers: {
        'track.event': () => {
          throw new Error('track down')
        },
      },
    })
    initDefault()

    expect(() => trackEvent('click')).not.toThrow()
    await Promise.resolve()
    expect(collectedRecords()[0]).toMatchObject({ kind: 'track', name: 'click' })
  })

  it('网络类型非字符串时回退 unknown', async () => {
    configureMock({ handlers: { 'device.getNetwork': () => ({ type: 123 }) } })
    initDefault()

    await vi.waitFor(() => {
      captureError(new Error('probe'))
      expect(recordsOf('error').at(-1)?.network).toBe('unknown')
    })
  })

  it('监控关闭时 markFirstScreen 也不记录', () => {
    initDefault({ enabled: false })

    markFirstScreen()

    expect(collectedRecords()).toHaveLength(0)
  })
})

describe('HTML 到达阶段（navigation timing 可用时）', () => {
  it('从 PerformanceNavigationTiming 读取 html-ready', () => {
    const original = performance.getEntriesByType.bind(performance)
    vi.spyOn(performance, 'getEntriesByType').mockImplementation((type: string) =>
      type === 'navigation'
        ? ([{ responseEnd: 120.4 }] as unknown as PerformanceEntryList)
        : original(type),
    )
    initDefault()

    markFirstScreen()

    const htmlReady = collectedRecords().find((entry) => entry.name === 'html-ready')
    expect(htmlReady?.payload.durationMs).toBe(120)
  })
})

describe('错误缓冲', () => {
  it('只保留最近 10 条，最新错误在最后', () => {
    initDefault()
    for (let index = 0; index < 12; index += 1) pushRecentError(`err-${index}`)

    captureError(new Error('last'))

    const entries = recentErrorText().split(' | ')
    expect(entries).toHaveLength(10)
    expect(entries.at(-1)).toBe('last')
    expect(entries).not.toContain('err-0')
  })
})
