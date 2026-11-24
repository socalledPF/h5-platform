import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initMonitor, resetMonitorRuntime } from '../src/init'
import { captureError } from '../src/error'
import { collectedRecords, pushRecentError, resetMonitor } from '../src/state'
import type { MonitorOptions } from '../src/state'
import { startWhiteScreenCheck, stopWhiteScreenCheck } from '../src/whitescreen'

const testEnv: MonitorOptions['env'] = {
  isApp: true,
  appId: 'member',
  appVersion: '5.6.0',
  os: 'android',
  osVersion: '13',
  device: 'Pixel 8',
  isDev: false,
  isTest: false,
  isPre: false,
  isProd: true,
  buildTime: '',
  statusBarHeight: 24,
  safeAreaTop: 0,
  safeAreaBottom: 0,
  apiBaseUrl: '',
  cdnBase: '',
}

function prepareBody(html: string): void {
  document.body.innerHTML = html
}

function whiteScreenReports(): Record<string, unknown>[] {
  return collectedRecords()
    .filter((entry) => entry.kind === 'error')
    .map((entry) => entry.payload)
    .filter((payload) => payload.source === 'white-screen')
}

beforeEach(() => {
  vi.useFakeTimers()
  resetMonitor()
  resetMonitorRuntime()
  initMonitor({ appId: 'member', env: testEnv })
})

afterEach(() => {
  stopWhiteScreenCheck()
  vi.useRealTimers()
  vi.restoreAllMocks()
  resetMonitor()
  document.body.innerHTML = ''
})

describe('白屏检测（设计文档 11.2）', () => {
  it('根节点为空时 3 秒后上报，并带上最近错误', async () => {
    prepareBody('<div id="app"></div>')
    pushRecentError('earlier boom')

    startWhiteScreenCheck('#app')
    await vi.advanceTimersByTimeAsync(3_000)

    const reports = whiteScreenReports()
    expect(reports).toHaveLength(1)
    expect(reports[0]).toMatchObject({ selector: '#app' })
    // 断言数组形态：用 String() 包一层会让数组和拼接字符串同时通过，string[] 的对齐就白改了
    expect(reports[0].recentErrors).toEqual(['earlier boom'])
  })

  it('根节点有文本或子元素时保持安静', async () => {
    prepareBody('<div id="app"><span>页面内容</span></div>')

    startWhiteScreenCheck('#app')
    await vi.advanceTimersByTimeAsync(3_000)

    expect(whiteScreenReports()).toHaveLength(0)
  })

  it('仅渲染空标签（无文本）不算白屏', async () => {
    prepareBody('<div id="app"><div></div></div>')

    startWhiteScreenCheck('#app')
    await vi.advanceTimersByTimeAsync(3_000)

    expect(whiteScreenReports()).toHaveLength(0)
  })

  it('根节点不存在时同样上报', async () => {
    prepareBody('<div id="root"></div>')

    startWhiteScreenCheck('#missing')
    await vi.advanceTimersByTimeAsync(3_000)

    expect(whiteScreenReports()[0]).toMatchObject({ selector: '#missing' })
  })

  it('数字入参表示延迟毫秒数', async () => {
    prepareBody('<div id="app"></div>')

    startWhiteScreenCheck(1_000)
    await vi.advanceTimersByTimeAsync(999)
    expect(whiteScreenReports()).toHaveLength(0)

    await vi.advanceTimersByTimeAsync(1)
    expect(whiteScreenReports()).toHaveLength(1)
  })

  it('重复调用只保留最后一次计时', async () => {
    prepareBody('<div id="app"></div>')

    startWhiteScreenCheck('#app')
    startWhiteScreenCheck('#app')
    await vi.advanceTimersByTimeAsync(3_000)

    expect(whiteScreenReports()).toHaveLength(1)
  })

  it('stopWhiteScreenCheck 取消计时后再也不会误报', async () => {
    prepareBody('<div id="app"></div>')

    startWhiteScreenCheck('#app')
    stopWhiteScreenCheck()
    await vi.advanceTimersByTimeAsync(5_000)

    expect(whiteScreenReports()).toHaveLength(0)
  })

  it('监控关闭时不检测', async () => {
    resetMonitor()
    resetMonitorRuntime()
    initMonitor({ appId: 'member', env: testEnv, enabled: false })
    prepareBody('<div id="app"></div>')

    startWhiteScreenCheck('#app')
    await vi.advanceTimersByTimeAsync(3_000)

    expect(collectedRecords()).toHaveLength(0)
  })
})

describe('captureError 与白屏的协作', () => {
  it('白屏前的 JS 错误会被白屏报告引用', async () => {
    prepareBody('<div id="app"></div>')

    captureError(new Error('首屏接口失败'), { source: 'window.onerror' })
    startWhiteScreenCheck('#app')
    await vi.advanceTimersByTimeAsync(3_000)

    expect(whiteScreenReports()[0].recentErrors).toEqual(['首屏接口失败'])
  })
})
