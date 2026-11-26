import { CODE, configureMock, isReportableBridgeFailure } from '@h5/bridge'
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

  it('公共字段齐全（appId / 版本 / 系统 / 机型 / 网络 / 路由 / 会话级假名 uid）', () => {
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
      uidSource: 'token-hash',
      message: 'boom',
      extra: 1,
    })
    // uid 不再是 token 片段，而是定长、不可逆的登录区间级假名
    expect(payload.uid).toBe('u_76daaa8d')
    // 未注入 __APP_VERSION__ 时降级，而不是静默上报一个假版本
    expect(payload.h5Version).toBe('0.0.0')
    // 两个版本字段来源不同：h5Version 不得拿 appVersion 兜底（反之亦然）
    expect(payload.h5Version).not.toBe(payload.appVersion)
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

  it('env.appVersion 缺失或为未知标记时，h5Version 仍是真实构建版本且两者可区分', () => {
    vi.stubGlobal('__APP_VERSION__', '1.4.2')

    // core 会把“原生 appInfo 缺失/超时”显式标成未知值（'unknown' 或空串）；
    // monitor 只依赖 h5Version 自身，不依赖该标记的具体写法，两者也不得互相兜底。
    for (const appVersion of ['', 'unknown']) {
      resetMonitor()
      initMonitor({ appId: 'member', env: { ...testEnv, appVersion } })

      captureError(new Error('boom'))

      const payload = recordsOf('error').at(-1)
      expect(payload?.h5Version).toBe('1.4.2')
      expect(payload?.appVersion).toBe(appVersion)
      expect(payload?.h5Version).not.toBe(payload?.appVersion)
    }
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
      'markFirstScreenApi',
      'markSessionEnd',
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
  it.each([
    { label: '成功（0）', code: 0 },
    { label: '用户取消（1003）', code: 1003 },
    { label: '不在 App 内（-2）', code: -2 },
  ])('不上报、也不进 Sentry：$label', async ({ code }) => {
    initMonitor({ appId: 'member', env: testEnv, dsn: 'https://key@sentry.example.com/1' })
    await vi.waitFor(() => {
      expect(isSentryReady()).toBe(true)
    })
    sentryCaptureMock.mockClear()

    reportBridgeError('share.open', code, 'not a failure')

    expect(collectedRecords()).toHaveLength(0)
    expect(sentryCaptureMock).not.toHaveBeenCalled()
  })

  it.each([1001, 1002, 1004, -1, 1099])('上报失败码 %i：记录 method / code / msg', (code) => {
    initDefault()

    reportBridgeError('device.scan', code, 'boom')

    const records = collectedRecords()
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({ kind: 'bridge', name: 'device.scan' })
    expect(records[0].payload).toMatchObject({ method: 'device.scan', code, msg: 'boom' })
  })

  it('bridge 的判定与 monitor 的上报行为逐码一致（同一份实现，无需内部符号）', () => {
    const codes = [0, 1003, -2, 1001, 1002, 1004, -1, 1099]
    const reported: number[] = []
    for (const code of codes) {
      resetMonitor()
      initDefault()
      reportBridgeError('device.scan', code, 'boom')
      if (collectedRecords().length > 0) reported.push(code)
    }

    // 判定说“不报”的码，reportBridgeError 就一定不产生记录；反之亦然
    expect(reported).toEqual(codes.filter((code) => isReportableBridgeFailure(code)))
    // 再把排除集显式钉死：bridge 侧哪天把 -2 放回来，这里立刻变红
    expect(reported).toEqual([1001, 1002, 1004, -1, 1099])
    expect(CODE.NOT_IN_APP).toBe(-2)
  })

  it('监控关闭时 Bridge 失败静默', () => {
    initDefault({ enabled: false })

    reportBridgeError('device.scan', 1001, 'boom')

    expect(collectedRecords()).toHaveLength(0)
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
    // release 口径：H5 构建版本（可部署/可回滚的那个），不是 testEnv.appVersion 5.6.0
    vi.stubGlobal('__APP_VERSION__', '1.4.2')
    initMonitor({ appId: 'member', env: testEnv, dsn: 'https://key@sentry.example.com/1' })

    await vi.waitFor(() => {
      expect(sentryInit).toHaveBeenCalledTimes(1)
    })
    expect(sentryInit).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: 'https://key@sentry.example.com/1',
        environment: 'prod',
        release: 'member@1.4.2',
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

describe('启动期（Sentry 未就绪）的上报补发（M1）', () => {
  const DSN = 'https://key@sentry.example.com/1'

  function capturedExtras(): Record<string, unknown>[] {
    return sentryCaptureMock.mock.calls.map(
      (call) => (call[1] as { extra: Record<string, unknown> }).extra,
    )
  }

  it('未初始化时入队，init 后按真实 appId / env 补发，且只发一次', async () => {
    // core 现在在上报器装好之后才 initEnv：启动期的 app.getInfo 失败会在
    // state.env === null、Sentry 未初始化时到达这里。
    expect(() => reportBridgeError('app.getInfo', 1001, 'old client')).not.toThrow()
    expect(sentryCaptureMock).not.toHaveBeenCalled()

    initDefault({ dsn: DSN })
    await vi.waitFor(() => {
      expect(sentryCaptureMock).toHaveBeenCalledTimes(1)
    })

    // 公共字段在 flush 时重算：不是入队那一刻的空值
    expect(capturedExtras()[0]).toMatchObject({
      appId: 'member',
      appVersion: '5.6.0',
      os: 'ios 16.3',
      device: 'iPhone 14',
      method: 'app.getInfo',
      code: 1001,
      msg: 'old client',
    })
    expect(capturedExtras()[0].appId).not.toBe('')

    // flush 幂等：二次 initMonitor 不会把同一条错误再报一次
    initDefault({ dsn: DSN })
    await Promise.resolve()
    await Promise.resolve()
    expect(sentryCaptureMock).toHaveBeenCalledTimes(1)
  })

  it('待上报队列有界：超过 50 条丢弃最旧的，且从不抛错', async () => {
    for (let index = 0; index < 55; index += 1) {
      expect(() => captureError(new Error(`early-${index}`))).not.toThrow()
    }
    expect(sentryCaptureMock).not.toHaveBeenCalled()

    initDefault({ dsn: DSN })
    await vi.waitFor(() => {
      expect(sentryCaptureMock).toHaveBeenCalledTimes(50)
    })

    const messages = sentryCaptureMock.mock.calls.map((call) => (call[0] as Error).message)
    expect(messages[0]).toBe('early-5')
    expect(messages.at(-1)).toBe('early-54')
  })

  it('resetMonitor 会清空待上报队列，不会在下次 init 时补发', async () => {
    reportBridgeError('app.getInfo', 1001, 'dropped')
    resetMonitor()

    initDefault({ dsn: DSN })
    await vi.waitFor(() => {
      expect(isSentryReady()).toBe(true)
    })
    await Promise.resolve()

    captureError(new Error('after init'))
    expect(sentryCaptureMock).toHaveBeenCalledTimes(1)
    expect(capturedExtras()[0].message).toBe('after init')
  })

  it('确定不会加载 Sentry 时不再累积待上报队列（本地记录照旧）', async () => {
    initDefault()
    await Promise.resolve()

    reportBridgeError('app.getInfo', 1001, 'no dsn')

    expect(collectedRecords()).toHaveLength(1)
    expect(sentryCaptureMock).not.toHaveBeenCalled()
  })

  it('enabled: false 时排队的事件也不补发（关闭上报必须整体静默）', async () => {
    // 入队那一刻 enabled 还是缺省 true，真正的开关只在 initMonitor 时才知道
    reportBridgeError('app.getInfo', 1001, 'quiet')

    initDefault({ dsn: DSN, enabled: false })
    await vi.waitFor(() => {
      expect(isSentryReady()).toBe(true)
    })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(sentryCaptureMock).not.toHaveBeenCalled()
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
    // 短 token 同样走哈希：不再出现 '***' 这种“看起来脱敏、实际按长度泄露”的分支
    expect(recordsOf('error')[0].uid).toBe('u_4d2505ca')

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

describe('uid：登录区间级假名（M1 修复：不再上报 token 片段，刷新不换名）', () => {
  // 真实 JWT 形状的 token：哈希已实测不含其任何 2 字符片段。
  const TOKEN_A = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1LTQyIn0.sig_7dQ4w9WgXcQ'
  const TOKEN_B = 'token-beta-2'

  function uidWithToken(token: string): string {
    resetMonitor()
    initDefault()
    useAuthStore().setToken(token)
    captureError(new Error('boom'))
    return String(recordsOf('error')[0].uid)
  }

  // core 在登录态转为“无会话”时调用 adapter 的 `markSessionEnd`（core/src/auth.ts 的
  // notifySessionEnd）；这里通过 adapter 原样调用，顺带证明 adapter 的接线。
  function sessionEnd(): void {
    toMonitorAdapter().markSessionEnd?.()
  }

  it('同一 token 恒定：同一用户的多次上报落在同一个 uid 上', () => {
    expect(uidWithToken(TOKEN_A)).toBe(uidWithToken(TOKEN_A))
    // 取值定死：算法若变动会让线上用户整体重新分桶，必须显式改测试
    expect(uidWithToken(TOKEN_A)).toBe('u_8229f1ff')
  })

  it('不同登录区间（各自从 null 开始）产生不同假名：换账号不串号', () => {
    expect(uidWithToken(TOKEN_A)).not.toBe(uidWithToken(TOKEN_B))
  })

  it('token 被就地替换（模拟 401 刷新）时假名保持稳定：§11.2 的按用户聚合因此成立', () => {
    initDefault()
    useAuthStore().setToken(TOKEN_A)
    captureError(new Error('before refresh'))
    const before = recordsOf('error')[0].uid

    // core/src/request.ts:86-87：refreshToken() 拿到新 token 后直接 setToken(newToken)，
    // 中间不经过 null，monitor 只看到 token 变了 —— 这正是刷新与换账号同形的场景。
    useAuthStore().setToken(TOKEN_B)
    captureError(new Error('after refresh'))
    const after = recordsOf('error')[1].uid

    // 假名派生自**首个** token（u_8229f1ff 是 TOKEN_A 的派升值），刷新不重新派生
    expect(after).toBe(before)
    expect(after).toBe('u_8229f1ff')
    // 与“直接拿新 token 派生”不同，证明缓存确实生效（否则这里会变红）
    expect(after).not.toBe(uidWithToken(TOKEN_B))
  })

  it('token → null 记为 anon；登出窗口内有上报点后换账号，不沿用旧假名', () => {
    initDefault()
    useAuthStore().setToken(TOKEN_A)
    captureError(new Error('logged in'))
    expect(recordsOf('error')[0].uid).toBe('u_8229f1ff')

    // 登出：登录页的页面埋点就是登出窗口里的上报点，缓存在这里被丢弃
    useAuthStore().setToken(null)
    trackPageView('/login')
    expect(recordsOf('track')[0]).toMatchObject({ uid: 'anon', uidSource: 'anon' })

    // 同一账号重新登录：同一 token 仍派生同一假名（哈希只依赖 token 本身）
    useAuthStore().setToken(TOKEN_A)
    captureError(new Error('back'))
    expect(recordsOf('error')[1].uid).toBe('u_8229f1ff')

    // 换账号登录：缓存已丢弃，必须换新假名
    useAuthStore().setToken(null)
    trackPageView('/login')
    useAuthStore().setToken(TOKEN_B)
    captureError(new Error('another account'))
    expect(recordsOf('error')[2].uid).not.toBe('u_8229f1ff')
    expect(recordsOf('error')[2].uid).toMatch(/^u_[0-9a-f]{8}$/)
  })

  it('markSessionEnd 后换账号：新假名，且等于新 token 单独派生的值（不再串号）', () => {
    const expectedB = uidWithToken(TOKEN_B)

    resetMonitor()
    initDefault()
    useAuthStore().setToken(TOKEN_A)
    captureError(new Error('account A'))
    const uidA = String(recordsOf('error')[0].uid)
    expect(uidA).toBe('u_8229f1ff')

    // A 登出（core/src/auth.ts 的 applyAuthChange(null) 只 store.clear()，不 reload）
    // → B 登录：previous === null，reload 分支不触发，只能靠 markSessionEnd 断开会话
    useAuthStore().setToken(null)
    sessionEnd()
    useAuthStore().setToken(TOKEN_B)
    captureError(new Error('account B'))

    const uidB = String(recordsOf('error')[1].uid)
    expect(uidB).not.toBe(uidA)
    expect(uidB).toBe(expectedB)
  })

  it('同一 token 替换序列：只有中间经过 markSessionEnd 才换假名（刷新保持 / 换账号切换）', () => {
    // 无 markSessionEnd = 401 刷新：同一用户保持同一假名
    initDefault()
    useAuthStore().setToken(TOKEN_A)
    captureError(new Error('before refresh'))
    useAuthStore().setToken(TOKEN_B)
    captureError(new Error('after refresh'))
    expect(recordsOf('error')[1].uid).toBe(recordsOf('error')[0].uid)

    // 有 markSessionEnd = 换账号：必须换假名
    resetMonitor()
    initDefault()
    useAuthStore().setToken(TOKEN_A)
    captureError(new Error('account A'))
    sessionEnd()
    useAuthStore().setToken(TOKEN_B)
    captureError(new Error('account B'))
    expect(recordsOf('error')[1].uid).not.toBe(recordsOf('error')[0].uid)
  })

  it('已记录的取舍：没有 markSessionEnd 信号时，两次上报之间的 A → null → B 观察不到', () => {
    initDefault()
    useAuthStore().setToken(TOKEN_A)
    captureError(new Error('logged in'))

    // 中间没有任何上报点、也没有会话结束信号（例如还没升级到会调 markSessionEnd 的 core）：
    // monitor 只在采集时读 token，看不到这段 null 窗口
    useAuthStore().setToken(null)
    useAuthStore().setToken(TOKEN_B)
    captureError(new Error('switched silently'))

    // 语义取舍的代价（见 state.ts resolveUid）：宁可不换名（少计用户），也不因刷新换名（多计）
    expect(recordsOf('error')[1].uid).toBe('u_8229f1ff')
  })

  it('整条上报里不含 token 的任何 ≥2 字符片段', () => {
    initDefault()
    useAuthStore().setToken(TOKEN_A)

    captureError(new Error('boom'))
    trackEvent('click', { from: 'home' })
    reportPerf('render', 10)
    reportBridgeError('share.open', 1001, 'not found')

    const payloads = collectedRecords().map((entry) => entry.payload)
    const full = JSON.stringify(payloads)

    // 整条 payload（含 stack、路由、版本号等原文）：token 的 ≥4 字符片段一旦出现就是泄露。
    for (let index = 0; index + 4 <= TOKEN_A.length; index += 1) {
      expect(full).not.toContain(TOKEN_A.slice(index, index + 4))
    }

    // 2 字符口径：token 唯一可能流入的地方是 uid / uidSource。其余字段是业务与环境字面量
    // （"0.0.0"、"ios 16.3" 之类），本身就可能含有 token 的某个 2 字符组合，对它们断言只会
    // 随机变红，反而掩护真正的泄露点。
    for (const payload of payloads) {
      const derived = JSON.stringify({ uid: payload.uid, uidSource: payload.uidSource })
      for (let index = 0; index + 2 <= TOKEN_A.length; index += 1) {
        expect(derived).not.toContain(TOKEN_A.slice(index, index + 2))
      }
      // 非空校验放在最后：先让“含 token 片段”这件事自己变红，而不是被形状断言顺手盖住
      expect(derived).toContain('u_')
    }
  })

  it('没有 token 时为 anon，且 uidSource 标为 anon', () => {
    initDefault()

    captureError(new Error('boom'))

    const payload = recordsOf('error')[0]
    expect(payload.uid).toBe('anon')
    expect(payload.uidSource).toBe('anon')
  })

  it('假名定长：u_ + 8 位十六进制，与 token 长度无关', () => {
    for (const token of ['a', 'ab', TOKEN_A, 'x'.repeat(2_048)]) {
      expect(uidWithToken(token)).toMatch(/^u_[0-9a-f]{8}$/)
    }
  })
})
