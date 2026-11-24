import { configureMock } from '@h5/bridge'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { env, initEnv } from '../src/env'

afterEach(() => {
  Reflect.deleteProperty(window.navigator, 'userAgent')
  document.documentElement.removeAttribute('style')
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
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

  it('appVersion 不回退 __APP_VERSION__（那是 H5 版本，两个字段不能撞成同一个值）', async () => {
    vi.stubGlobal('__APP_VERSION__', '1.4.2')
    configureMock({ handlers: { 'app.getInfo': () => undefined } })

    await expect(initEnv({ appId: 'member', isApp: true })).resolves.toBe(env)

    // 拿不到 App 版本就留空：request 层把它映射成 X-App-Version: unknown，
    // 而 §11.2 的 h5Version 才用 __APP_VERSION__，两个字段必须能区分
    expect(env.appVersion).toBe('')
    expect(env.appVersion).not.toBe('1.4.2')
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

describe('Android 安全区兜底（设计文档 8.2）', () => {
  const rootStyle = (): CSSStyleDeclaration => document.documentElement.style

  it('env() 失效的机型用 statusBarHeight 兜底写回 --safe-top', async () => {
    configureMock({
      handlers: {
        'app.getInfo': () => ({
          os: 'android',
          statusBarHeight: 24,
          safeAreaTop: 0,
          safeAreaBottom: 0,
        }),
      },
    })

    await initEnv({ appId: 'activity', isApp: true })

    expect(rootStyle().getPropertyValue('--safe-top')).toBe('24px')
    // 底部为 0 时不写，保留 CSS 里的 env() 兜底
    expect(rootStyle().getPropertyValue('--safe-bottom')).toBe('')
  })

  it('原生给出 safeAreaTop / safeAreaBottom 时优先采用', async () => {
    configureMock({
      handlers: {
        'app.getInfo': () => ({ statusBarHeight: 24, safeAreaTop: 44, safeAreaBottom: 34 }),
      },
    })

    await initEnv({ appId: 'activity', isApp: true })

    expect(rootStyle().getPropertyValue('--safe-top')).toBe('44px')
    expect(rootStyle().getPropertyValue('--safe-bottom')).toBe('34px')
  })

  it('量测值全为 0 时一个变量都不写（浏览器不能盖掉 env() 兜底）', async () => {
    configureMock({
      handlers: {
        'app.getInfo': () => ({ statusBarHeight: 0, safeAreaTop: 0, safeAreaBottom: 0 }),
      },
    })

    await initEnv({ appId: 'activity', isApp: true })

    expect(rootStyle().getPropertyValue('--safe-top')).toBe('')
    expect(rootStyle().getPropertyValue('--safe-bottom')).toBe('')
  })

  it('二次 init 归零时删掉变量，而不是留着上一次的 44px', async () => {
    configureMock({
      handlers: {
        'app.getInfo': () => ({ statusBarHeight: 44, safeAreaTop: 44, safeAreaBottom: 34 }),
      },
    })
    await initEnv({ appId: 'activity', isApp: true })
    expect(rootStyle().getPropertyValue('--safe-top')).toBe('44px')
    expect(rootStyle().getPropertyValue('--safe-bottom')).toBe('34px')

    // 同一个页面第二次 initEnv（二次 createH5App / 微前端重挂）：量测值归零
    configureMock({
      handlers: {
        'app.getInfo': () => ({ statusBarHeight: 0, safeAreaTop: 0, safeAreaBottom: 0 }),
      },
    })
    await initEnv({ appId: 'activity', isApp: true })

    // 必须删掉而不是写 0px：残留的 44px 会顶开所有 padding-top: var(--safe-top) 的头部，
    // 而写 0px 又会盖住 CSS 的 env() 兜底
    expect(rootStyle().getPropertyValue('--safe-top')).toBe('')
    expect(rootStyle().getPropertyValue('--safe-bottom')).toBe('')
  })
})
