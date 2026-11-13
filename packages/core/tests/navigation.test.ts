import { configureMock } from '@h5/bridge'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter, createWebHistory } from 'vue-router'
import type { RouteLocationNormalized, RouteRecordRaw, RouteLocationRaw, Router } from 'vue-router'
import { env } from '../src/env'
import {
  goBack,
  handleBackPress,
  installNavigation,
  navigate,
  navMode,
  registerBackHandler,
  requestBack,
  resetNavigationState,
  resolveNavMode,
  routeStackDepth,
  setDefaultNavMode,
} from '../src/navigation'
import { resetMonitorState } from '../src/monitor'

const routes: RouteRecordRaw[] = [
  { path: '/', component: { template: '<div />' } },
  { path: '/detail', component: { template: '<div />' }, meta: { title: '详情', nav: 'h5' } },
  { path: '/immersive', component: { template: '<div />' }, meta: { nav: 'none' } },
  { path: '/native', component: { template: '<div />' }, meta: { title: '原生页' } },
]

/** 桥接 mock：记录 nav.* 的调用参数，避免依赖原生通道。 */
function installNavMock(): {
  opens: Record<string, unknown>[]
  closes: number
  titles: unknown[]
} {
  const state = { opens: [] as Record<string, unknown>[], closes: 0, titles: [] as unknown[] }
  configureMock({
    handlers: {
      'nav.open': (params: Record<string, unknown>) => {
        state.opens.push(params)
        return undefined
      },
      'nav.close': () => {
        state.closes += 1
        return undefined
      },
      'nav.setTitle': (params: Record<string, unknown>) => {
        state.titles.push(params.title)
        return undefined
      },
      'nav.setBackInterceptor': () => undefined,
    },
  })
  return state
}

/** 构造只带 meta / query 的“路由对象”，用于单测优先级。 */
function routeLike(partial: {
  meta?: Record<string, unknown>
  query?: Record<string, unknown>
}): RouteLocationNormalized | RouteLocationRaw {
  return partial as unknown as RouteLocationNormalized
}

/**
 * 改写地址栏。state 必须保持 vue-router 的结构（position 等），
 * 否则会破坏后续用例里 history.state.position 的语义。
 */
function setUrl(url: string): void {
  window.history.replaceState(
    { back: null, current: url, forward: null, replaced: true, position: 0, scroll: null },
    '',
    url,
  )
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

beforeEach(() => {
  resetNavigationState()
  resetMonitorState()
  setUrl('/')
  env.isApp = false
})

afterEach(() => {
  resetNavigationState()
  vi.restoreAllMocks()
})

describe('resolveNavMode（设计文档 7.1 四级优先级）', () => {
  it('第 1 级：URL 参数 ?nav= 覆盖一切', () => {
    env.isApp = true
    setDefaultNavMode('native')
    setUrl('/?nav=none')

    expect(resolveNavMode()).toBe('none')

    setUrl('/?nav=h5')
    expect(resolveNavMode(routeLike({ meta: { nav: 'native' } }))).toBe('h5')
  })

  it('第 2 级：路由 meta.nav', () => {
    env.isApp = true
    setDefaultNavMode('native')
    setUrl('/detail')

    expect(resolveNavMode(routeLike({ query: {}, meta: { nav: 'none' } }))).toBe('none')
  })

  it('第 3 级：应用默认值', () => {
    env.isApp = true
    setUrl('/')

    expect(resolveNavMode()).toBe('native')

    setDefaultNavMode('h5')
    expect(resolveNavMode()).toBe('h5')
    expect(navMode.value).toBe('h5')
  })

  it('第 4 级：不在 App 内时回退为 h5', () => {
    env.isApp = false
    setDefaultNavMode('native')
    setUrl('/')

    expect(resolveNavMode()).toBe('h5')
  })

  it('非法的 nav 参数被忽略，继续走下一级', () => {
    env.isApp = true
    setDefaultNavMode('native')
    setUrl('/?nav=xxx')

    expect(resolveNavMode()).toBe('native')
  })

  it('hash 路由里的 nav 参数同样生效', () => {
    env.isApp = true
    setDefaultNavMode('native')
    setUrl('/#/order?nav=none')

    expect(resolveNavMode()).toBe('none')
  })
})

describe('路由栈深度（设计文档 7.3）', () => {
  function createWebRouter(): Router {
    const router = createRouter({ history: createWebHistory(), routes })
    installNavigation(router)
    return router
  }

  it('push 递增、replace 不变、back 递减', async () => {
    const router = createWebRouter()
    await router.push('/')
    expect(routeStackDepth.value).toBe(1)

    await router.push('/detail')
    expect(routeStackDepth.value).toBe(2)

    await router.push('/immersive')
    expect(routeStackDepth.value).toBe(3)

    await router.replace('/detail')
    expect(routeStackDepth.value).toBe(3)

    router.back()
    await vi.waitFor(() => {
      expect(routeStackDepth.value).toBe(2)
    })
  })

  it('深度为 1 时返回关闭 WebView，深度大于 1 时走路由返回', async () => {
    const bridge = installNavMock()
    const router = createWebRouter()
    const backSpy = vi.spyOn(router, 'back')

    await router.push('/')
    goBack()
    expect(backSpy).not.toHaveBeenCalled()
    await flush()
    expect(bridge.closes).toBe(1)

    await router.push('/detail')
    goBack()
    expect(backSpy).toHaveBeenCalledTimes(1)
  })

  it('无 router 且深度大于 1 时退化为浏览器 history.back', async () => {
    const backSpy = vi.spyOn(window.history, 'back').mockImplementation(() => undefined)
    resetNavigationState()
    routeStackDepth.value = 2

    goBack()

    expect(backSpy).toHaveBeenCalledTimes(1)
  })

  it('拿不到 history.position 时（memory history）保持初始深度', async () => {
    const router = createRouter({ history: createMemoryHistory(), routes })
    installNavigation(router)

    await router.push('/detail')
    expect(routeStackDepth.value).toBe(1)
  })
})

describe('返回拦截（设计文档 7.3）', () => {
  it('后注册的先执行，返回 true 消费本次返回', async () => {
    installNavMock()
    const calls: string[] = []

    registerBackHandler(() => {
      calls.push('first')
      return true
    })
    registerBackHandler(() => {
      calls.push('second')
      return true
    })

    await handleBackPress()
    expect(calls).toEqual(['second'])
  })

  it('都不消费时执行默认返回', async () => {
    const bridge = installNavMock()
    registerBackHandler(() => false)

    await handleBackPress()
    await flush()
    expect(bridge.closes).toBe(1)
  })

  it('拦截器抛错不影响后续拦截器与默认返回', async () => {
    const bridge = installNavMock()
    registerBackHandler(() => {
      throw new Error('boom')
    })

    await handleBackPress()
    await flush()
    expect(bridge.closes).toBe(1)
  })

  it('取消注册后不再参与拦截', async () => {
    installNavMock()
    let called = false
    const unsubscribe = registerBackHandler(() => {
      called = true
      return true
    })
    unsubscribe()

    await handleBackPress()
    expect(called).toBe(false)
  })

  it('原生 nav.backPress 事件触发拦截链路', async () => {
    const bridge = installNavMock()
    const router = createWebRouterForBackPress()
    await router.push('/')

    const emit = (window as unknown as { __H5Bridge?: { emit?: (e: string, d?: unknown) => void } })
      .__H5Bridge
    emit?.emit?.('nav.backPress', undefined)
    await flush()

    expect(bridge.closes).toBe(1)
  })

  it('H5 导航栏返回（goBack）也先询问拦截器：返回 true 时不执行默认返回', async () => {
    const bridge = installNavMock()
    const guard = vi.fn(() => true)
    registerBackHandler(guard)

    goBack()
    await flush()

    expect(guard).toHaveBeenCalledTimes(1)
    expect(bridge.closes).toBe(0)
  })

  it('拦截器返回 false 时 goBack 照常执行默认返回，且每次返回只问一遍', async () => {
    const bridge = installNavMock()
    const guard = vi.fn(() => false)
    registerBackHandler(guard)

    goBack()
    await flush()

    expect(guard).toHaveBeenCalledTimes(1)
    expect(bridge.closes).toBe(1)
  })

  it('goBack 的拦截顺序同样是后注册先执行', async () => {
    const bridge = installNavMock()
    const calls: string[] = []
    registerBackHandler(() => {
      calls.push('first')
      return false
    })
    registerBackHandler(() => {
      calls.push('second')
      return true
    })

    goBack()
    await flush()

    expect(calls).toEqual(['second'])
    expect(bridge.closes).toBe(0)
  })

  it('深度大于 1 时拦截器消费返回则不回退路由，未消费才 router.back', async () => {
    installNavMock()
    const router = createWebRouterForBackPress()
    const backSpy = vi.spyOn(router, 'back')
    await router.push('/')
    await router.push('/detail')
    expect(routeStackDepth.value).toBe(2)

    const unsubscribe = registerBackHandler(() => true)
    goBack()
    await flush()
    expect(backSpy).not.toHaveBeenCalled()

    unsubscribe()
    goBack()
    expect(backSpy).toHaveBeenCalledTimes(1)
  })

  it('requestBack 返回本次返回是否被拦截器消费', async () => {
    installNavMock()
    const unsubscribe = registerBackHandler(() => true)
    await expect(requestBack()).resolves.toBe(true)

    unsubscribe()
    await expect(requestBack()).resolves.toBe(false)
  })

  function createWebRouterForBackPress(): Router {
    const router = createRouter({ history: createWebHistory(), routes })
    installNavigation(router)
    return router
  }
})

describe('navigate（设计文档 7.4 跳转表）', () => {
  async function setup(): Promise<{
    router: Router
    opens: Record<string, unknown>[]
    titles: unknown[]
  }> {
    const bridge = installNavMock()
    const router = createRouter({ history: createWebHistory(), routes })
    installNavigation(router)
    await router.push('/')
    return { router, opens: bridge.opens, titles: bridge.titles }
  }

  it('站内路径走 router.push', async () => {
    const { router, opens } = await setup()

    await navigate('/detail')

    expect(router.currentRoute.value.path).toBe('/detail')
    expect(opens).toHaveLength(0)
  })

  it('native:// 交给原生路由', async () => {
    const { opens } = await setup()

    await navigate('native://order/detail?id=1')

    expect(opens[0]).toEqual({ route: 'native://order/detail?id=1' })
  })

  it('外部链接标记 external', async () => {
    const { opens, router } = await setup()

    await navigate('https://example.com/promo')

    expect(opens[0]).toMatchObject({ url: 'https://example.com/promo', external: true })
    expect(router.currentRoute.value.path).toBe('/')
  })

  it('同源但属于其他 apps 入口时带上 nav 模式新开 WebView', async () => {
    const { opens } = await setup()
    env.cdnBase = '/member/'
    const target = `${location.origin}/activity/index.html?nav=native`

    await navigate(target)

    expect(opens[0]).toEqual({ url: target, nav: 'h5' })
    env.cdnBase = ''
  })

  it('NavTarget 对象：url 走站内、route 走原生', async () => {
    const { opens, router } = await setup()

    await navigate({ url: '/immersive' })
    expect(router.currentRoute.value.path).toBe('/immersive')
    expect(opens).toHaveLength(0)

    await navigate({ route: 'native://order/list' })
    expect(opens[0]).toEqual({ route: 'native://order/list' })
  })

  it('空目标回到入口首页', async () => {
    const { router } = await setup()

    await navigate('')

    expect(router.currentRoute.value.path).toBe('/')
  })

  it('协议相对地址与非法 URL 按外部链接处理', async () => {
    const { opens } = await setup()

    await navigate('//cdn.example.com/h5/index.html')
    await navigate('http://[invalid')
    await navigate('mailto:hi@example.com')

    expect(opens).toHaveLength(3)
    for (const open of opens) expect(open.external).toBe(true)
  })

  it('router 未安装时 navigate 不抛错', async () => {
    installNavMock()
    resetNavigationState()

    await expect(navigate('/detail')).resolves.toBeUndefined()
  })

  it('路由 meta.title 同步到 document.title 与原生标题', async () => {
    env.isApp = true
    const { router, titles } = await setup()

    await router.push('/detail')
    expect(document.title).toBe('详情')

    await router.push('/native')
    await flush()
    expect(titles).toContain('原生页')
  })
})
