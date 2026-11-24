import { expect, test } from '@playwright/test'

/**
 * 冒烟 E2E（设计文档 7.1 / 7.5）。
 *
 * 跑在 `createH5App` 的浏览器 mock 上。`playwright.config.ts` 同时启动两个 dev server：
 * member（baseURL 127.0.0.1:5273）与独立入口的 activity（127.0.0.1:5274），
 * 因此下面的 activity 用例不再探测、不再跳过——活动页必须真的被跑过。
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

/** activity 是独立入口，由 `playwright.config.ts` 的第二个 webServer 启动。 */
const ACTIVITY_BASE_URL = process.env.E2E_ACTIVITY_BASE_URL ?? 'http://127.0.0.1:5274'

test.describe('activity 活动页（独立入口）', () => {
  test('沉浸式头部渲染，且没有 H5 导航栏', async ({ page }) => {
    await page.goto(`${ACTIVITY_BASE_URL}/?id=A2026&title=春日会员日&nav=none`)

    await expect(page.getByTestId('activity-header')).toBeVisible()
    await expect(page.getByTestId('activity-title')).toHaveText('春日会员日')
    await expect(page.getByTestId('activity-cta')).toBeVisible()
    // 沉浸式：H5 不画导航栏（AppNavBar 在 none 模式下只留一个 display:none 的空节点）
    await expect(page.getByTestId('app-nav-bar-title')).toHaveCount(0)
  })
})
