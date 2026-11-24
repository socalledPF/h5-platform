import { Button, Field } from 'vant'
import { createApp, nextTick } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, describe, expect, it } from 'vitest'

import Activity from '../src/views/Activity.vue'

/**
 * jsdom 没有 visualViewport：给它一个可控替身，让断言走 useKeyboard 的真实链路
 * （改视觉视口高度 → 派发 resize → 页面隐藏底部固定栏），而不是把 hook mock 掉。
 */
class FakeVisualViewport extends EventTarget {
  height = 0
  offsetTop = 0
}

const KEYBOARD_HEIGHT = 300

/** 已挂载的页面：用例失败也要卸载，否则倒计时的 interval 会留在进程里。 */
const mounted: (() => void)[] = []
let viewport: FakeVisualViewport | undefined
let originalDescriptor: PropertyDescriptor | undefined

function installVisualViewport(): FakeVisualViewport {
  originalDescriptor = Object.getOwnPropertyDescriptor(window, 'visualViewport')
  viewport = new FakeVisualViewport()
  viewport.height = window.innerHeight
  Object.defineProperty(window, 'visualViewport', { value: viewport, configurable: true })
  return viewport
}

/** 键盘弹起 / 收起：视觉视口变矮（键盘占高）再派发 resize。 */
async function setKeyboard(open: boolean): Promise<void> {
  if (viewport === undefined) throw new Error('visualViewport 未装入')
  viewport.height = open ? window.innerHeight - KEYBOARD_HEIGHT : window.innerHeight
  viewport.dispatchEvent(new Event('resize'))
  await nextTick()
}

/** 真实 router + 最小 vant 注册挂载页面：不需要 @vue/test-utils，也不需要 pinia。 */
async function mountActivity(query: Record<string, string>): Promise<HTMLElement> {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/activity', component: { template: '<div />' } }],
  })
  await router.push({ path: '/activity', query })
  await router.isReady()

  const host = document.createElement('div')
  document.body.appendChild(host)

  const app = createApp(Activity)
  app.use(router)
  app.component('VanButton', Button)
  app.component('VanField', Field)
  app.mount(host)
  mounted.push(() => {
    app.unmount()
    host.remove()
  })

  return host
}

describe('Activity 页面渲染', () => {
  afterEach(() => {
    while (mounted.length > 0) mounted.pop()?.()
    if (originalDescriptor === undefined) Reflect.deleteProperty(window, 'visualViewport')
    else Object.defineProperty(window, 'visualViewport', originalDescriptor)
    viewport = undefined
    originalDescriptor = undefined
  })

  it('结束时间解析失败时渲染「时间无效」，且不再显示倒计时', async () => {
    installVisualViewport()
    const host = await mountActivity({ endAt: '2026-11-13 10:00:00-05:0x' })

    const invalid = host.querySelector('[data-testid="activity-countdown-invalid"]')
    expect(invalid?.textContent?.trim()).toBe('时间无效')
    expect(host.querySelector('[data-testid="activity-countdown"]')).toBeNull()
    expect(host.querySelector('[data-testid="activity-hint"]')?.textContent).toContain(
      '结束时间无法解析',
    )
    // 页面其余部分照常渲染，不是白屏
    expect(host.querySelector('[data-testid="activity-title"]')).not.toBeNull()
    expect(host.querySelector('[data-testid="activity-cta"]')).not.toBeNull()
  })

  it('结束时间合法时渲染四段倒计时', async () => {
    installVisualViewport()
    const host = await mountActivity({ endAt: '2099-11-13 10:00:00' })

    expect(host.querySelector('[data-testid="activity-countdown-invalid"]')).toBeNull()
    expect(host.querySelectorAll('.activity__unit')).toHaveLength(4)
    expect(host.querySelector('[data-testid="activity-hint"]')?.textContent).toContain(
      '距离活动结束',
    )
  })

  it('键盘弹起时隐藏底部固定 CTA，键盘收起后恢复（设计文档 8.3）', async () => {
    installVisualViewport()
    const host = await mountActivity({ endAt: '2099-11-13 10:00:00' })

    const cta = host.querySelector('[data-testid="activity-cta"]')
    const join = host.querySelector<HTMLElement>('[data-testid="activity-join"]')
    expect(cta).not.toBeNull()
    expect(join).not.toBeNull()
    expect(cta?.classList.contains('activity__cta--hidden')).toBe(false)
    expect(cta?.getAttribute('aria-hidden')).toBe('false')
    expect(cta?.hasAttribute('inert')).toBe(false)

    await setKeyboard(true)
    expect(cta?.classList.contains('activity__cta--hidden')).toBe(true)
    expect(cta?.getAttribute('aria-hidden')).toBe('true')
    // aria-hidden 只把 CTA 从无障碍树里摘掉，键盘焦点照样落进 van-button 并能回车触发，
    // 所以隐藏期间必须真的 inert（jsdom 不实现 inert / 样式表，失效由属性 + .activity__cta--hidden
    // 里的 visibility: hidden 保证，这里钉住属性这一侧）
    expect(cta?.hasAttribute('inert')).toBe(true)

    await setKeyboard(false)
    expect(cta?.classList.contains('activity__cta--hidden')).toBe(false)
    expect(cta?.getAttribute('aria-hidden')).toBe('false')
    expect(cta?.hasAttribute('inert')).toBe(false)
    // 键盘收起后 CTA 恢复可交互：焦点能回到按钮上
    join?.focus()
    expect(document.activeElement).toBe(join)
  })
})
