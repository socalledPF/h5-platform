import { expect, test } from '@playwright/test'

/**
 * 冒烟 E2E（设计文档 7.1 / 7.5）。
 *
 * 跑在 `createH5App` 的浏览器 mock 上：`playwright.config.ts` 只启动 `@h5/app-member` 的
 * dev server（baseURL 127.0.0.1:5173），因此 member 的页面直接可用；
 * 独立入口的应用（activity / bridge-playground）各有自己的 dev server，见文件末尾的 activity 用例。
 *
 * 约定：只用 role / test-id 定位，断言等待交给 Playwright 的自动重试，不写 waitForTimeout。
 */

test.describe('member 会员中心', () => {
  test('首页渲染 H5 导航栏标题与应用根节点', async ({ page }) => {
    await page.goto('/')

    await expect(page.getByTestId('app-root')).toBeVisible()
    await expect(page.getByTestId('member-home')).toBeVisible()

    const navTitle = page.getByTestId('app-nav-bar-title')
    // 浏览器里 env.isApp === false，导航模式按 7.1 规则 4 回退为 h5，导航栏由 H5 自绘
    await expect(navTitle).toBeVisible()
    await expect(navTitle).toHaveText('会员中心')
  })

  test('进入订单列表页渲染列表容器与 H5 导航栏', async ({ page }) => {
    await page.goto('/orders')

    await expect(page.getByTestId('order-list')).toBeVisible()
    await expect(page.getByTestId('app-nav-bar-title')).toHaveText('我的订单')
  })

  test('订单详情页渲染 H5 导航栏右侧按钮', async ({ page }) => {
    // 直接进详情页：浏览器里没有后端，页面按演示数据渲染（App 内走真实接口）
    await page.goto('/orders/A1001')

    await expect(page.getByTestId('order-detail')).toBeVisible()
    await expect(page.getByTestId('app-nav-bar-right-help')).toBeVisible()
  })
})

test.describe('沉浸式（nav=none）', () => {
  test('nav=none 时不渲染 H5 导航栏', async ({ page }) => {
    // 设计文档 7.1 规则 1：URL 参数优先级最高；AppNavBar 在 none 模式下不渲染标题
    await page.goto('/?nav=none')

    await expect(page.getByTestId('app-root')).toHaveAttribute('data-nav-mode', 'none')
    await expect(page.getByTestId('member-home')).toBeVisible()
    await expect(page.getByTestId('app-nav-bar-title')).toHaveCount(0)
  })
})

/**
 * activity 是独立入口，`playwright.config.ts` 的 webServer 不会启动它。
 * 这里探测它的 dev server（同时跑 member 时活动页会落在 5174）：探测不到就跳过，
 * 探测到就按验收要求断言「沉浸式头部存在、H5 导航栏标题不存在」。
 */
const ACTIVITY_BASE_URL = process.env.E2E_ACTIVITY_BASE_URL ?? 'http://127.0.0.1:5174'

test.describe('activity 活动页（独立入口）', () => {
  test('沉浸式头部渲染，且没有 H5 导航栏', async ({ page }) => {
    const probe = await page.request.get(`${ACTIVITY_BASE_URL}/`).catch(() => null)
    test.skip(
      probe === null || !probe.ok(),
      `未探测到 activity dev server（${ACTIVITY_BASE_URL}）：先运行 pnpm --filter @h5/app-activity dev`,
    )

    await page.goto(`${ACTIVITY_BASE_URL}/?id=A2026&title=春日会员日&nav=none`)

    await expect(page.getByTestId('activity-header')).toBeVisible()
    await expect(page.getByTestId('activity-title')).toHaveText('春日会员日')
    await expect(page.getByTestId('activity-cta')).toBeVisible()
    // 沉浸式：H5 不画导航栏（AppNavBar 在 none 模式下只留一个 display:none 的空节点）
    await expect(page.getByTestId('app-nav-bar-title')).toHaveCount(0)
  })
})
