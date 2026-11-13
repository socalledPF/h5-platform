import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  app,
  auth,
  CODE,
  configureMock,
  device,
  invoke,
  METHOD_LIST,
  media,
  nav,
  setBridgeErrorReporter,
  share,
  storage,
  track,
  ui,
} from '../src/index'
import { resetBridgeState, setNavigatorProperty } from './helpers'

beforeEach(() => {
  resetBridgeState()
  vi.spyOn(console, 'info').mockImplementation(() => undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
  resetBridgeState()
})

const mockCalls: Array<() => Promise<unknown>> = [
  () => app.getInfo(),
  () => app.getCapabilities(),
  () => auth.getToken(),
  () => auth.refreshToken(),
  () => auth.login(),
  () => auth.logout(),
  () => nav.open({ url: '/member/order' }),
  () => nav.open({ route: '/activity/home' }),
  () => nav.open({}),
  () => nav.close(),
  () => nav.back(),
  () => nav.setTitle('会员中心'),
  () => nav.setBar({ title: '会员中心', hidden: false }),
  () => nav.setRightButtons([{ id: 'share', text: '分享' }]),
  () => nav.setBackInterceptor(true),
  () => ui.toast('保存成功', { duration: 2000 }),
  () => ui.toast('无参数'),
  () => ui.loading(true, '加载中'),
  () => ui.loading(false),
  () => ui.alert({ title: '提示', message: '确定？', confirmText: '好', cancelText: '取消' }),
  () => ui.alert({ message: '只有文案' }),
  () => share.open({ link: 'https://h5.example.com/member', title: '会员' }),
  () => share.open({ link: '' }),
  () => device.getNetwork(),
  () => device.getLocation(),
  () => device.scan({ onlyFromCamera: true }),
  () => device.vibrate(),
  () => device.vibrate(50),
  () => media.chooseImage({ count: 2, sourceType: 'album' }),
  () => media.previewImage({ paths: ['a.png'], index: 0 }),
  () => media.saveImage({ path: 'a.png' }),
  () => storage.set('demo', { a: 1 }),
  () => storage.get('demo'),
  () => track.event('order_pay_click', { id: 1 }),
  () => track.event('page_view'),
]

describe('浏览器 mock', () => {
  it('未注入任何能力时全部方法都能跑通（console / localStorage 兜底）', async () => {
    configureMock({})

    let resolved = 0
    for (const call of mockCalls) {
      await call()
      resolved += 1
    }

    expect(resolved).toBe(mockCalls.length)
    await expect(storage.get('demo')).resolves.toEqual({ a: 1 })
    await expect(storage.get('missing-key')).resolves.toBeNull()
    expect(localStorage.getItem('h5:bridge:mock:demo')).toBe('{"a":1}')
    expect(console.info).toHaveBeenCalled()
  })

  it('默认 getInfo 走 UA 解析结果', async () => {
    configureMock({})

    await expect(app.getInfo()).resolves.toMatchObject({
      appVersion: 'mock',
      os: 'web',
      device: 'desktop',
      statusBarHeight: 0,
    })
  })

  it('未注入 capabilities 时返回全部已定义方法', async () => {
    configureMock({})

    await expect(app.getCapabilities()).resolves.toEqual([...METHOD_LIST])
  })

  it('注入 toast / token / storage / 埋点 / 分享 / 导航后优先使用注入实现', async () => {
    const toast = vi.fn()
    const trackEvent = vi.fn()
    const shareHandler = vi.fn()
    const openHandler = vi.fn()
    const alertHandler = vi.fn()
    const store = new Map<string, string>()
    configureMock({
      toast,
      alert: alertHandler,
      trackEvent,
      share: shareHandler,
      open: openHandler,
      capabilities: ['share.open'],
      getToken: () => ({ token: 'from-core', expireAt: 42 }),
      location: { latitude: 31.23, longitude: 121.47, address: '上海市' },
      storage: {
        getItem: (key) => store.get(key) ?? null,
        setItem: (key, value) => {
          store.set(key, value)
        },
      },
    })

    await ui.toast('保存成功', { duration: 1500 })
    expect(toast).toHaveBeenCalledWith('保存成功', { duration: 1500 })

    await ui.alert({ title: '提示', message: '确定？', confirmText: '好' })
    expect(alertHandler).toHaveBeenCalledWith({
      title: '提示',
      message: '确定？',
      confirmText: '好',
    })

    await share.open({ link: 'https://h5.example.com/member', desc: '来玩' })
    expect(shareHandler).toHaveBeenCalledWith({
      link: 'https://h5.example.com/member',
      desc: '来玩',
    })

    await nav.open({ route: '/member/home', nav: 'h5' })
    expect(openHandler).toHaveBeenCalledWith({ route: '/member/home', nav: 'h5' })

    await track.event('pay', { id: 1 })
    expect(trackEvent).toHaveBeenCalledWith('pay', { id: 1 })

    await expect(auth.getToken()).resolves.toEqual({ token: 'from-core', expireAt: 42 })
    await expect(app.getCapabilities()).resolves.toEqual(['share.open'])
    await expect(device.getLocation()).resolves.toEqual({
      latitude: 31.23,
      longitude: 121.47,
      address: '上海市',
    })

    await storage.set('token', 'abc')
    expect(store.get('token')).toBe('"abc"')
    await expect(storage.get('token')).resolves.toBe('abc')
  })

  it('token 提供者返回 null 时以 1004 拒绝', async () => {
    configureMock({ getToken: () => null })

    await expect(auth.getToken()).rejects.toMatchObject({
      code: CODE.DENIED,
      method: 'auth.getToken',
    })
  })

  it('未知方法以 1001 拒绝并上报监控', async () => {
    const reporter = vi.fn()
    setBridgeErrorReporter(reporter)
    configureMock({})

    await expect(invoke('legacy.method')).rejects.toMatchObject({
      code: CODE.NOT_FOUND,
      method: 'legacy.method',
    })
    expect(reporter).toHaveBeenCalledWith('legacy.method', CODE.NOT_FOUND, expect.any(String))
  })

  it('handlers 逃生舱为任意方法注入实现', async () => {
    configureMock({
      handlers: {
        'custom.echo': (params) => ({ echo: params.key }),
      },
    })

    await expect(invoke('custom.echo', { key: 'k' })).resolves.toEqual({ echo: 'k' })
  })

  it('默认网络信息按 navigator 推断', async () => {
    configureMock({})
    await expect(device.getNetwork()).resolves.toEqual({ type: 'unknown' })

    setNavigatorProperty('connection', { effectiveType: '4g' })
    await expect(device.getNetwork()).resolves.toEqual({ type: 'unknown', effectiveType: '4g' })

    setNavigatorProperty('onLine', false)
    await expect(device.getNetwork()).resolves.toEqual({ type: 'none' })
  })

  it('未开启 mock 时仍走原生分支（不在 App 内以 -2 拒绝）', async () => {
    await expect(nav.close()).rejects.toMatchObject({ code: CODE.NOT_IN_APP })
  })
})
