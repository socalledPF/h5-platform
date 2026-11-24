import { configureMock, invoke, track } from '@h5/bridge'
// bridge 只导出 configureMock；resetMock 是其测试辅助（不从包入口导出），这里借来隔离用例。
// eslint-disable-next-line no-restricted-syntax -- resetMock 是 bridge 的测试辅助，未从 @h5/bridge 入口导出，用例需要它重置 mock 状态；对外入口不因测试而扩大
import { resetMock } from '../../bridge/src/mock'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRouter, createWebHistory } from 'vue-router'
import type { Router } from 'vue-router'
import { h } from 'vue'
import { useAuthStore } from '../src/auth'
import { createH5App, resetCreateAppState } from '../src/create-app'
import { env } from '../src/env'
import { markFirstScreen, resetMonitorState } from '../src/monitor'
import {
  installNavigation,
  navMode,
  resetNavigationState,
  resolveNavMode,
  routeStackDepth,
  setDefaultNavMode,
  syncCurrentRoute,
} from '../src/navigation'
import type { MonitorAdapter } from '../src/types'

/**
 * 每个用例都需要的监控桩：全部钩子都是 spy，便于断言 core 的调用点。
 * 每个 spy 都按 `MonitorAdapter` 的真实签名实例化，`mock.calls` 才能拿到带类型的参数
 * （无签名的 `vi.fn()` 会让 `calls[0][1]` 退化成隐式 any）。
 */
function createMonitorSpy() {
  return {
    init: vi.fn<Required<MonitorAdapter>['init']>(),
    captureError: vi.fn<Required<MonitorAdapter>['captureError']>(),
    reportBridgeError: vi.fn<Required<MonitorAdapter>['reportBridgeError']>(),
    trackEvent: vi.fn<Required<MonitorAdapter>['trackEvent']>(),
    markFirstScreen: vi.fn<Required<MonitorAdapter>['markFirstScreen']>(),
    reportPerf: vi.fn<Required<MonitorAdapter>['reportPerf']>(),
  }
}

const Root = {
  name: 'Root',
  render: () => h('div', { class: 'root' }, '内容'),
}

/** 渲染空内容：用于验证白屏检测。 */
const EmptyRoot = { name: 'EmptyRoot', render: () => null }

function createTestRouter(): Router {
  return createRouter({
    history: createWebHistory(),
    routes: [{ path: '/', component: { render: () => h('div') } }],
  })
}

function prepareDocument(): HTMLElement {
  document.body.innerHTML = '<div id="app"></div>'
  const element = document.querySelector<HTMLElement>('#app')
  if (element === null) throw new Error('缺少 #app 容器')
  return element
}

beforeEach(() => {
  resetMonitorState()
  useAuthStore().clear()
  env.cdnBase = ''
  // mock 先就绪，ready() 才不会等满 1 秒；createH5App 会按其 options 重新配置
  configureMock({})
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  resetMonitorState()
  resetCreateAppState()
  resetNavigationState()
  env.isApp = false
  document.title = ''
  // 必须保留 history.state：vue-router 依赖 state.position 记栈深度，清空会算出 NaN
  window.history.replaceState(window.history.state, '', '/')
  Reflect.deleteProperty(window.navigator, 'userAgent')
  document.body.innerHTML = ''
})

describe('createH5App（设计文档 4 统一启动入口）', () => {
  it('识别环境、注入监控、初始化导航并返回未挂载的 App', async () => {
    const monitor = createMonitorSpy()
    const app = await createH5App(Root, { appId: 'member', router: createTestRouter(), monitor })

    expect(env.appId).toBe('member')
    expect(env.isApp).toBe(false)
    expect(monitor.init).toHaveBeenCalledTimes(1)
    expect(monitor.init.mock.calls[0][0]).toMatchObject({ appId: 'member' })

    expect(typeof app.mount).toBe('function')
    expect(document.body.textContent).not.toContain('内容')

    app.mount(prepareDocument())
    expect(document.body.textContent).toContain('内容')
  })

  it('不在 App 内时导航栏模式回退为 h5；App 内使用 defaultNav', async () => {
    const router = createTestRouter()
    const app = await createH5App(Root, { appId: 'member', router, defaultNav: 'native' })

    expect(app).toBeDefined()
    const { navMode, setDefaultNavMode } = await import('../src/navigation')
    expect(navMode.value).toBe('h5')

    env.isApp = true
    setDefaultNavMode('native')
    expect(navMode.value).toBe('native')
  })

  it('requireLogin 时用原生 token 初始化登录态（仅内存）', async () => {
    const router = createTestRouter()

    await createH5App(Root, {
      appId: 'member',
      router,
      requireLogin: true,
      mock: { getToken: () => ({ token: 'boot-token', expireAt: 7 }) },
    })

    expect(useAuthStore().token).toBe('boot-token')
    expect(window.localStorage.length).toBe(0)
    expect(window.sessionStorage.length).toBe(0)
  })

  it('浏览器里先装 mock，ready() 立即返回：不消耗 1 秒等待', async () => {
    // 回到“既没有原生通道，也没有已激活 mock”的浏览器初始态
    resetMock()
    vi.useFakeTimers()
    env.isApp = false
    const router = createTestRouter()

    let resolved = false
    const pending = createH5App(Root, { appId: 'member', router }).then((app) => {
      resolved = true
      return app
    })

    // 只排空微任务，一毫秒假时钟都不推进：旧实现要等 ready() 的 1000ms 才会返回
    for (let tick = 0; tick < 100 && !resolved; tick += 1) await Promise.resolve()

    expect(resolved).toBe(true)
    const app = await pending
    expect(typeof app.mount).toBe('function')
  })

  it('mock: false 时不注入浏览器 mock', async () => {
    resetMock()
    const router = createTestRouter()
    await createH5App(Root, { appId: 'member', router, mock: false })

    // 关掉 mock 后 bridge 退回真实通道，浏览器里调用以 -2 失败
    await expect(invoke('app.getInfo')).rejects.toMatchObject({ code: -2 })
  })

  it('注入的 mock 覆盖默认实现，未覆盖的仍用 bridge 默认行为', async () => {
    const toast = vi.fn()
    const router = createTestRouter()
    await createH5App(Root, { appId: 'member', router, mock: { toast } })

    await invoke('ui.toast', { message: 'hi' })
    expect(toast).toHaveBeenCalledWith('hi', {})

    await expect(invoke('nav.close')).resolves.toBeUndefined()
  })

  it('浏览器 mock 的埋点转发给监控实现', async () => {
    const monitor = createMonitorSpy()
    const router = createTestRouter()
    await createH5App(Root, { appId: 'member', router, monitor })

    await track.event('order_pay_click', { id: 'p1' })

    expect(monitor.trackEvent).toHaveBeenCalledWith('order_pay_click', { id: 'p1' })
  })

  it('Bridge 失败经 setBridgeErrorReporter 报到监控', async () => {
    const monitor = createMonitorSpy()
    const router = createTestRouter()
    await createH5App(Root, { appId: 'member', router, monitor })

    await expect(invoke('unknown.method')).rejects.toMatchObject({ code: 1001 })

    expect(monitor.reportBridgeError).toHaveBeenCalledWith(
      'unknown.method',
      1001,
      expect.anything(),
    )
  })

  it('Vue 渲染期错误进入监控', async () => {
    const monitor = createMonitorSpy()
    const app = await createH5App(Root, {
      appId: 'member',
      router: createTestRouter(),
      monitor,
    })

    const error = new Error('render failed')
    app.config.errorHandler?.(error, null, 'render function')
    expect(monitor.captureError).toHaveBeenCalledWith(error, {
      source: 'vue',
      info: 'render function',
    })
  })

  it('监控 init 抛错不影响启动', async () => {
    const monitor = createMonitorSpy()
    monitor.init.mockImplementation(() => {
      throw new Error('monitor down')
    })

    await expect(
      createH5App(Root, { appId: 'member', router: createTestRouter(), monitor }),
    ).resolves.toBeDefined()
  })

  it('默认 mock 分支把 nav.open 打到控制台', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    await createH5App(Root, { appId: 'member', router: createTestRouter(), mock: true })

    await invoke('nav.open', { url: 'https://cdn.example.com/activity/' })

    expect(info).toHaveBeenCalledWith(
      expect.stringContaining('[h5:core:mock] nav.open'),
      expect.objectContaining({ appId: 'member' }),
    )
  })

  it('未注入监控时 Vue 错误仍输出到 console', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const app = await createH5App(Root, { appId: 'member', router: createTestRouter() })

    app.config.errorHandler?.(new Error('no monitor'), null, 'render')

    expect(consoleError).toHaveBeenCalled()
  })
})

describe('落地路由同步（设计文档 7.2：首屏必须同步 title / navMode / 栈深度）', () => {
  const Page = { render: () => h('div') }

  function createLandingRouter(): Router {
    return createRouter({
      history: createWebHistory(),
      routes: [
        { path: '/', component: Page, meta: { title: '首页' } },
        { path: '/orders', component: Page, meta: { title: '我的订单', nav: 'native' } },
        { path: '/list', component: Page, meta: { title: '清单', nav: 'h5' } },
      ],
    })
  }

  it('初始导航先于钩子注册结算时，落地页仍同步 meta.title / navMode / 栈深度', async () => {
    window.history.replaceState(window.history.state, '', '/orders')
    document.title = '会员中心'
    const router = createLandingRouter()
    // 复现真实时序：落地导航在 createH5App 装钩子之前就已结算
    await router.push('/orders')
    await router.isReady()

    const app = await createH5App(Root, { appId: 'member', router })
    app.mount(prepareDocument())

    expect(document.title).toBe('我的订单')
    // meta.nav 必须压过「不在 App 内 → h5」的兜底
    expect(navMode.value).toBe('native')
    expect(navMode.value).toBe(resolveNavMode(router.currentRoute.value))
    expect(routeStackDepth.value).toBe(1)
  })

  it('落地页 meta.nav: h5 同样生效', async () => {
    window.history.replaceState(window.history.state, '', '/list')
    document.title = '会员中心'
    const router = createLandingRouter()
    await router.push('/list')
    await router.isReady()

    const app = await createH5App(Root, { appId: 'member', router, defaultNav: 'native' })
    app.mount(prepareDocument())

    expect(document.title).toBe('清单')
    expect(navMode.value).toBe('h5')
    expect(navMode.value).toBe(resolveNavMode(router.currentRoute.value))
    expect(routeStackDepth.value).toBe(1)
  })

  it('App 内 meta.nav: h5 由路由决定，而不是回落到 defaultNav', async () => {
    env.isApp = true
    setDefaultNavMode('native')
    const router = createLandingRouter()
    await router.push('/list')
    await router.isReady()

    installNavigation(router)
    syncCurrentRoute()

    expect(document.title).toBe('清单')
    expect(navMode.value).toBe('h5')
    expect(routeStackDepth.value).toBe(1)
  })

  it('同一 router 二次启动不叠加钩子：只同步一次，栈深度不翻倍', async () => {
    window.history.replaceState(window.history.state, '', '/')
    const router = createLandingRouter()
    await createH5App(Root, { appId: 'member', router })
    await createH5App(Root, { appId: 'member', router })

    const setTitle = vi.spyOn(Document.prototype, 'title', 'set')
    await router.push('/orders')

    expect(setTitle).toHaveBeenCalledTimes(1)
    expect(setTitle).toHaveBeenLastCalledWith('我的订单')
    expect(routeStackDepth.value).toBe(2)
  })

  it('全局 beforeEach 永不结算时启动不挂死，白屏检测仍然装上', async () => {
    vi.useFakeTimers()
    const monitor = createMonitorSpy()
    const router = createRouter({
      history: createWebHistory(),
      routes: [{ path: '/', component: Page }],
    })
    // 线上形态：全局守卫里 await 原生登录 / 远端配置，那个 Promise 一直不结算
    router.beforeEach(() => new Promise<boolean>(() => undefined))

    let resolved = false
    const pending = createH5App(EmptyRoot, {
      appId: 'member',
      router,
      monitor,
      firstScreenSelector: '#app',
    }).then((app) => {
      resolved = true
      return app
    })

    // 没有上限时这里永远不会 resolve：下面的断言就是回归点
    await vi.advanceTimersByTimeAsync(1_000)
    expect(resolved).toBe(true)

    const app = await pending
    app.mount(prepareDocument())

    // 白屏检测排在落地同步之后：挂死时它根本没被排上，白屏连遥测都没有
    await vi.advanceTimersByTimeAsync(3_000)
    expect(monitor.captureError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ source: 'white-screen', selector: '#app' }),
    )
  })
})

describe('白屏检测（设计文档 11.2）', () => {
  it('根节点 3 秒后仍无内容时上报最近错误', async () => {
    vi.useFakeTimers()
    const monitor = createMonitorSpy()
    const router = createTestRouter()
    const app = await createH5App(EmptyRoot, {
      appId: 'member',
      router,
      monitor,
      firstScreenSelector: '#app',
    })
    app.mount(prepareDocument())

    await vi.advanceTimersByTimeAsync(3_000)

    expect(monitor.captureError).toHaveBeenCalledTimes(1)
    expect(monitor.captureError.mock.calls[0][1]).toMatchObject({
      source: 'white-screen',
      selector: '#app',
    })
  })

  it('根节点不存在时同样上报', async () => {
    vi.useFakeTimers()
    const monitor = createMonitorSpy()
    const app = await createH5App(EmptyRoot, {
      appId: 'member',
      router: createTestRouter(),
      monitor,
      firstScreenSelector: '#missing',
    })
    app.mount(prepareDocument())

    await vi.advanceTimersByTimeAsync(3_000)

    expect(monitor.captureError.mock.calls[0][1]).toMatchObject({ selector: '#missing' })
  })

  it('根节点有内容时保持安静', async () => {
    vi.useFakeTimers()
    const monitor = createMonitorSpy()
    const app = await createH5App(Root, {
      appId: 'member',
      router: createTestRouter(),
      monitor,
      firstScreenSelector: '#app',
    })
    app.mount(prepareDocument())

    await vi.advanceTimersByTimeAsync(3_000)

    expect(monitor.captureError).not.toHaveBeenCalled()
  })
})

describe('首屏打点（设计文档 10.1）', () => {
  it('markFirstScreen 只触发一次监控打点，core 不再逐阶段 reportPerf', async () => {
    const monitor = createMonitorSpy()
    await createH5App(Root, { appId: 'member', router: createTestRouter(), monitor })

    markFirstScreen()
    markFirstScreen()

    // 阶段的属主是监控实现：core 触发一次、由它一次性产出整套阶段并共用一个采样结果。
    expect(monitor.markFirstScreen).toHaveBeenCalledTimes(1)
    expect(monitor.reportPerf).not.toHaveBeenCalled()
  })
})

describe('storage（Bridge 跨 WebView 存储）', () => {
  it('set / get / remove 走 bridge.storage', async () => {
    const { storage } = await import('../src/storage')
    configureMock({})

    await storage.set('order', { id: 1 })
    await expect(storage.get('order')).resolves.toEqual({ id: 1 })

    await storage.remove('order')
    await expect(storage.get('order')).resolves.toBeNull()
  })

  it('存储失败时读取返回 null，写入不抛出', async () => {
    const { storage } = await import('../src/storage')
    configureMock({ handlers: { 'storage.get': () => Promise.reject(new Error('boom')) } })

    await expect(storage.get('missing')).resolves.toBeNull()
    await expect(storage.set('k', 1)).resolves.toBeUndefined()
  })
})

describe('App 内启动（存在原生通道）', () => {
  it('不装 mock，调用走原生通道，ready() 由通道立即满足', async () => {
    resetMock()
    vi.useFakeTimers()
    // prod 分支跳过 vConsole 注入，避免这条用例去加载真实 vconsole
    vi.stubEnv('VITE_APP_ENV', 'prod')

    const received: string[] = []
    const bridgeWindow = window as unknown as {
      H5Bridge?: { postMessage: (payload: string) => void }
      __H5Bridge?: { callback?: (id: string, result: unknown) => void }
    }
    bridgeWindow.H5Bridge = {
      postMessage(payload: string): void {
        const message = JSON.parse(payload) as { method: string; callbackId: string }
        received.push(message.method)
        bridgeWindow.__H5Bridge?.callback?.(message.callbackId, {
          code: 0,
          data: nativeDataFor(message.method),
        })
      },
    }

    try {
      const app = await createH5App(Root, { appId: 'member', router: createTestRouter() })

      expect(env.isApp).toBe(true)
      // 请求落到通道而不是 mock：说明 App 内没有注入浏览器 mock
      expect(received).toContain('auth.getToken')
      expect(received).toContain('app.getInfo')
      expect(useAuthStore().token).toBe('native-token')
      expect(typeof app.mount).toBe('function')
    } finally {
      delete bridgeWindow.H5Bridge
    }

    function nativeDataFor(method: string): unknown {
      if (method === 'auth.getToken') return { token: 'native-token', expireAt: 1 }
      if (method === 'app.getInfo') {
        return {
          appVersion: '5.6.0',
          os: 'ios',
          osVersion: '16.3',
          device: 'iPhone',
          statusBarHeight: 44,
        }
      }
      return undefined
    }
  })
})

describe('App 内通道晚到', () => {
  it('UA 表明在 App 内时不预装 mock，ready() 等到通道出现再继续', async () => {
    resetMock()
    vi.useFakeTimers()
    vi.stubEnv('VITE_APP_ENV', 'prod')
    Object.defineProperty(window.navigator, 'userAgent', {
      value:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 16_3 like Mac OS X) AppleWebKit/605.1.15 MyApp/5.6.0',
      configurable: true,
    })

    const received: string[] = []
    const bridgeWindow = window as unknown as {
      H5Bridge?: { postMessage: (payload: string) => void }
      __H5Bridge?: { callback?: (id: string, result: unknown) => void }
    }
    const installChannel = (): void => {
      bridgeWindow.H5Bridge = {
        postMessage(payload: string): void {
          const message = JSON.parse(payload) as { method: string; callbackId: string }
          received.push(message.method)
          bridgeWindow.__H5Bridge?.callback?.(message.callbackId, {
            code: 0,
            data: nativeDataFor(message.method),
          })
        },
      }
    }

    try {
      let resolved = false
      const pending = createH5App(Root, { appId: 'member', router: createTestRouter() }).then(
        (app) => {
          resolved = true
          return app
        },
      )

      // 通道还没注入：这里必须仍在等待，而不是已经装好 mock 直接返回
      await vi.advanceTimersByTimeAsync(100)
      expect(resolved).toBe(false)

      installChannel()
      await vi.advanceTimersByTimeAsync(40)

      const app = await pending
      expect(env.isApp).toBe(true)
      expect(received).toContain('auth.getToken')
      expect(typeof app.mount).toBe('function')
    } finally {
      delete bridgeWindow.H5Bridge
    }

    function nativeDataFor(method: string): unknown {
      if (method === 'auth.getToken') return { token: 'native-token', expireAt: 1 }
      if (method === 'app.getInfo') {
        return {
          appVersion: '5.6.0',
          os: 'ios',
          osVersion: '16.3',
          device: 'iPhone',
          statusBarHeight: 44,
        }
      }
      return undefined
    }
  })
})

describe('原生载荷异常时的启动韧性', () => {
  it('app.getInfo 没有 data 时 createH5App 仍能 resolve（不再永久白屏）', async () => {
    resetMock()
    vi.stubEnv('VITE_APP_ENV', 'prod')

    const bridgeWindow = window as unknown as {
      H5Bridge?: { postMessage: (payload: string) => void }
      __H5Bridge?: { callback?: (id: string, result: unknown) => void }
    }
    bridgeWindow.H5Bridge = {
      postMessage(payload: string): void {
        const message = JSON.parse(payload) as { callbackId: string }
        // 原生答“成功但没有数据”：data 缺失
        bridgeWindow.__H5Bridge?.callback?.(message.callbackId, { code: 0 })
      },
    }

    try {
      const app = await createH5App(Root, { appId: 'member', router: createTestRouter() })

      expect(env.isApp).toBe(true)
      expect(env.os).toBe('web')
      expect(env.statusBarHeight).toBe(0)
      expect(typeof app.mount).toBe('function')
    } finally {
      delete bridgeWindow.H5Bridge
    }
  })
})

describe('启动期 Bridge 失败上报（设计文档 11.2：兼容性指标不能漏掉最老客户端）', () => {
  function installOldAppChannel(): () => void {
    const bridgeWindow = window as unknown as {
      H5Bridge?: { postMessage: (payload: string) => void }
      __H5Bridge?: { callback?: (id: string, result: unknown) => void }
    }
    bridgeWindow.H5Bridge = {
      postMessage(payload: string): void {
        const message = JSON.parse(payload) as { callbackId: string }
        // 老版本 App 没有任何新方法：一律答 1001（方法不存在）
        bridgeWindow.__H5Bridge?.callback?.(message.callbackId, {
          code: 1001,
          msg: 'method not found',
        })
      },
    }
    return () => {
      delete bridgeWindow.H5Bridge
    }
  }

  it('app.getInfo 答 1001 时上报器已就位，第一次 Bridge 调用不被丢弃', async () => {
    resetMock()
    vi.stubEnv('VITE_APP_ENV', 'prod')
    const monitor = createMonitorSpy()
    const removeChannel = installOldAppChannel()

    try {
      const app = await createH5App(Root, {
        appId: 'member',
        router: createTestRouter(),
        monitor,
      })

      expect(monitor.reportBridgeError).toHaveBeenCalledWith('app.getInfo', 1001, expect.anything())
      expect(typeof app.mount).toBe('function')
    } finally {
      removeChannel()
    }
  })

  it('二次启动未注入监控时不继承上一轮的 reporter', async () => {
    const stale = createMonitorSpy()
    await createH5App(Root, { appId: 'member', router: createTestRouter(), monitor: stale })

    await createH5App(Root, { appId: 'member', router: createTestRouter() })
    await expect(invoke('unknown.method')).rejects.toMatchObject({ code: 1001 })

    expect(stale.reportBridgeError).not.toHaveBeenCalled()
  })
})
