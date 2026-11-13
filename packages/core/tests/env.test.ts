import { configureMock } from '@h5/bridge'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { env, initEnv } from '../src/env'

afterEach(() => {
  Reflect.deleteProperty(window.navigator, 'userAgent')
  vi.unstubAllEnvs()
})

describe('env 默认值', () => {
  it('不在 App 内时给出 web 兜底', async () => {
    await initEnv({ appId: 'member' })

    expect(env.isApp).toBe(false)
    expect(env.appId).toBe('member')
    expect(env.os).toBe('web')
    expect(env.device).toBe('desktop')
    expect(env.appVersion).toBe('')
    expect(env.statusBarHeight).toBe(0)
    expect(env.safeAreaTop).toBe(0)
    expect(env.safeAreaBottom).toBe(0)
  })

  it('默认环境为 dev，且四个环境开关互斥', async () => {
    await initEnv({ appId: 'member' })

    expect(env.isDev).toBe(true)
    expect(env.isTest).toBe(false)
    expect(env.isPre).toBe(false)
    expect(env.isProd).toBe(false)
  })

  it('env 始终是同一个对象（就地更新，业务引用不失效）', async () => {
    const snapshot = env
    await initEnv({ appId: 'activity' })

    expect(env).toBe(snapshot)
    expect(env.appId).toBe('activity')
  })

  it('显式 overrides 覆盖环境开关与接口域名', async () => {
    await initEnv({
      appId: 'member',
      isDev: false,
      isProd: true,
      apiBaseUrl: 'https://api.example.com',
      cdnBase: 'https://cdn.example.com/member/',
    })

    expect(env.isDev).toBe(false)
    expect(env.isProd).toBe(true)
    expect(env.apiBaseUrl).toBe('https://api.example.com')
    expect(env.cdnBase).toBe('https://cdn.example.com/member/')
  })

  it('VITE_APP_ENV 决定环境开关', async () => {
    vi.stubEnv('VITE_APP_ENV', 'test')
    await initEnv({ appId: 'member' })
    expect(env.isTest).toBe(true)
    expect(env.isDev).toBe(false)

    vi.stubEnv('VITE_APP_ENV', 'pre')
    await initEnv({ appId: 'member' })
    expect(env.isPre).toBe(true)
    expect(env.isTest).toBe(false)

    vi.stubEnv('VITE_APP_ENV', 'prod')
    await initEnv({ appId: 'member' })
    expect(env.isProd).toBe(true)
    expect(env.isPre).toBe(false)
  })

  it('接口与 CDN 域名来自构建变量', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://dev-api.example.com')
    vi.stubEnv('VITE_CDN_BASE', 'https://cdn.example.com/member/')

    await initEnv({ appId: 'member' })

    expect(env.apiBaseUrl).toBe('https://dev-api.example.com')
    expect(env.cdnBase).toBe('https://cdn.example.com/member/')
  })

  it('App 内优先采用原生 app.getInfo 的状态栏与安全区', async () => {
    configureMock({
      handlers: {
        'app.getInfo': () => ({
          appVersion: '5.7.0',
          os: 'android',
          osVersion: '13',
          device: 'Pixel 8',
          statusBarHeight: 24.6,
          safeAreaTop: 30,
          safeAreaBottom: 16,
        }),
      },
    })

    await initEnv({ appId: 'member', isApp: true })

    expect(env.appVersion).toBe('5.7.0')
    expect(env.os).toBe('android')
    expect(env.device).toBe('Pixel 8')
    expect(env.statusBarHeight).toBe(24.6)
    expect(env.safeAreaTop).toBe(30)
    expect(env.safeAreaBottom).toBe(16)
  })

  it('原生返回空字段时保留 UA 结果，负值安全区归零', async () => {
    configureMock({
      handlers: {
        'app.getInfo': () => ({
          appVersion: '',
          os: 'web',
          osVersion: '',
          device: '',
          statusBarHeight: 0,
          safeAreaTop: -1,
          safeAreaBottom: -1,
        }),
      },
    })

    await initEnv({ appId: 'member', isApp: true })

    expect(env.os).toBe('web')
    expect(env.safeAreaTop).toBe(0)
    expect(env.safeAreaBottom).toBe(0)
  })

  it('app.getInfo 只有 { code: 0 } 没有 data 时降级，不抛错', async () => {
    configureMock({ handlers: { 'app.getInfo': () => undefined } })

    await expect(initEnv({ appId: 'member', isApp: true })).resolves.toBe(env)

    expect(env.isApp).toBe(true)
    expect(env.os).toBe('web')
    expect(env.device).toBe('desktop')
    expect(env.appVersion).toBe('')
    expect(env.statusBarHeight).toBe(0)
    expect(env.safeAreaBottom).toBe(0)
  })

  it('app.getInfo 返回 null 时同样降级', async () => {
    configureMock({ handlers: { 'app.getInfo': () => null } })

    await expect(initEnv({ appId: 'member', isApp: true })).resolves.toBe(env)

    expect(env.os).toBe('web')
    expect(env.device).toBe('desktop')
    expect(env.statusBarHeight).toBe(0)
  })

  it('部分可用的载荷照常采用，缺的字段保留原值', async () => {
    configureMock({ handlers: { 'app.getInfo': () => ({ appVersion: '5.7.1', os: 'ios' }) } })

    await initEnv({ appId: 'member', isApp: true })

    expect(env.appVersion).toBe('5.7.1')
    expect(env.os).toBe('ios')
    expect(env.device).toBe('desktop')
    expect(env.osVersion).toBe('')
    expect(env.statusBarHeight).toBe(0)
    expect(env.safeAreaTop).toBe(0)
  })

  it('App 内从 UA 解析系统与机型（原生信息不可用时）', async () => {
    // mock 在文件内是模块级状态，显式声明“原生取不到信息”，避免用例相互影响
    configureMock({
      handlers: {
        'app.getInfo': () => {
          throw new Error('native unavailable')
        },
      },
    })
    Object.defineProperty(window.navigator, 'userAgent', {
      value:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 16_3 like Mac OS X) AppleWebKit/605.1.15 MyApp/5.6.0',
      configurable: true,
    })

    await initEnv({ appId: 'member', isApp: true })

    expect(env.isApp).toBe(true)
    expect(env.os).toBe('ios')
    expect(env.osVersion).toBe('16.3')
    expect(env.device).toBe('iPhone')
    expect(env.appVersion).toBe('5.6.0')
  })
})
