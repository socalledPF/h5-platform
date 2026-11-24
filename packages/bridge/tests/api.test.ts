import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  app,
  auth,
  device,
  METHOD_LIST,
  METHODS,
  media,
  nav,
  share,
  storage,
  track,
  ui,
} from '../src/index'
import { installFakeAndroid, resetBridgeState } from './helpers'

beforeEach(() => {
  resetBridgeState()
})

afterEach(() => {
  vi.restoreAllMocks()
  resetBridgeState()
})

interface ApiCase {
  name: string
  method: string
  call: () => Promise<unknown>
}

const apiCases: ApiCase[] = [
  { name: 'app.getInfo', method: METHODS.app.getInfo, call: () => app.getInfo() },
  {
    name: 'app.getCapabilities',
    method: METHODS.app.getCapabilities,
    call: () => app.getCapabilities(),
  },
  { name: 'auth.getToken', method: METHODS.auth.getToken, call: () => auth.getToken() },
  { name: 'auth.refreshToken', method: METHODS.auth.refreshToken, call: () => auth.refreshToken() },
  { name: 'auth.login', method: METHODS.auth.login, call: () => auth.login() },
  { name: 'auth.logout', method: METHODS.auth.logout, call: () => auth.logout() },
  { name: 'nav.open', method: METHODS.nav.open, call: () => nav.open({ url: '/member/home' }) },
  { name: 'nav.close', method: METHODS.nav.close, call: () => nav.close() },
  { name: 'nav.back', method: METHODS.nav.back, call: () => nav.back() },
  { name: 'nav.setTitle', method: METHODS.nav.setTitle, call: () => nav.setTitle('会员中心') },
  { name: 'nav.setBar', method: METHODS.nav.setBar, call: () => nav.setBar({ hidden: true }) },
  {
    name: 'nav.setRightButtons',
    method: METHODS.nav.setRightButtons,
    call: () => nav.setRightButtons([{ id: 'share', text: '分享' }]),
  },
  {
    name: 'nav.setBackInterceptor',
    method: METHODS.nav.setBackInterceptor,
    call: () => nav.setBackInterceptor(true),
  },
  { name: 'ui.toast', method: METHODS.ui.toast, call: () => ui.toast('保存成功') },
  { name: 'ui.loading', method: METHODS.ui.loading, call: () => ui.loading(true, '加载中') },
  {
    name: 'ui.alert',
    method: METHODS.ui.alert,
    call: () => ui.alert({ message: '确定删除？', confirmText: '删除' }),
  },
  {
    name: 'share.open',
    method: METHODS.share.open,
    call: () => share.open({ link: 'https://h5.example.com/member', title: '会员' }),
  },
  {
    name: 'device.getNetwork',
    method: METHODS.device.getNetwork,
    call: () => device.getNetwork(),
  },
  {
    name: 'device.getLocation',
    method: METHODS.device.getLocation,
    call: () => device.getLocation(),
  },
  { name: 'device.scan', method: METHODS.device.scan, call: () => device.scan() },
  { name: 'device.vibrate', method: METHODS.device.vibrate, call: () => device.vibrate(30) },
  {
    name: 'media.chooseImage',
    method: METHODS.media.chooseImage,
    call: () => media.chooseImage({ count: 3 }),
  },
  {
    name: 'media.previewImage',
    method: METHODS.media.previewImage,
    call: () => media.previewImage({ paths: ['a.png'], index: 0 }),
  },
  {
    name: 'media.saveImage',
    method: METHODS.media.saveImage,
    call: () => media.saveImage({ path: 'a.png' }),
  },
  { name: 'storage.get', method: METHODS.storage.get, call: () => storage.get('demo') },
  { name: 'storage.set', method: METHODS.storage.set, call: () => storage.set('demo', 1) },
  { name: 'track.event', method: METHODS.track.event, call: () => track.event('pay') },
]

describe('方法名常量', () => {
  it.each(apiCases)('$name 发送协议方法名 $method', async ({ method, call }) => {
    // app.getCapabilities 只接受数组载荷：畸形载荷按「能力未知」以 1002 拒绝（设计文档 6 规则 2），
    // 这里应答一个合法空数组，其余方法照旧应答 null（本用例只关心发出的方法名）。
    const native = installFakeAndroid((message, respond) =>
      respond({ code: 0, data: message.method === METHODS.app.getCapabilities ? [] : null }),
    )

    await call()

    expect(native.sent.map((message) => message.method)).toContain(method)
  })

  it('METHOD_LIST 覆盖所有领域 API', () => {
    const methods = apiCases.map((item) => item.method)
    for (const method of methods) expect(METHOD_LIST).toContain(method)
    expect(new Set(METHOD_LIST).size).toBe(METHOD_LIST.length)
  })

  it('按协议字段拼装参数', async () => {
    const native = installFakeAndroid((_message, respond) => respond({ code: 0, data: {} }))

    await ui.toast('保存成功', { duration: 1500 })
    await ui.loading(true)
    await ui.loading(false)
    await nav.setTitle('会员中心')
    await nav.setRightButtons([{ id: 'share', text: '分享' }])
    await nav.setBackInterceptor(true)
    await device.vibrate()
    await device.vibrate(80)
    await storage.set('demo', { a: 1 })
    await track.event('pay', { id: 1 })
    await nav.open({ url: '/member/detail', nav: 'native' })

    expect(native.sent.map((message) => [message.method, message.params])).toEqual([
      ['ui.toast', { message: '保存成功', duration: 1500 }],
      ['ui.loading', { show: true }],
      ['ui.loading', { show: false }],
      ['nav.setTitle', { title: '会员中心' }],
      ['nav.setRightButtons', { buttons: [{ id: 'share', text: '分享' }] }],
      ['nav.setBackInterceptor', { enabled: true }],
      ['device.vibrate', {}],
      ['device.vibrate', { durationMs: 80 }],
      ['storage.set', { key: 'demo', value: { a: 1 } }],
      ['track.event', { name: 'pay', params: { id: 1 } }],
      ['nav.open', { url: '/member/detail', nav: 'native' }],
    ])
  })
})
