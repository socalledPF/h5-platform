import { defineConfig, devices } from '@playwright/test'

const MEMBER_PORT = 5273
const ACTIVITY_PORT = 5274

/**
 * member 是 e2e 的主入口，作为 baseURL。
 *
 * 端口刻意避开 5173/5174：那是各 app 日常 `pnpm dev` 的默认端口，很容易被本机其它项目占着。
 * 若复用已占用端口，Playwright 会静默连上**别人家的应用**，测试绿/红都失去意义（真实踩过）。
 */
const MEMBER_BASE_URL = `http://127.0.0.1:${MEMBER_PORT}`
/** activity 是独立入口的应用：必须一起起来，否则活动页用例会被跳过，等于没测。 */
const ACTIVITY_BASE_URL = `http://127.0.0.1:${ACTIVITY_PORT}`

/**
 * 浏览器渠道兜底（可选，默认不需要）。
 *
 * 版本选择：`@playwright/test` 固定在 1.61.x —— 1.60/1.61 自带的 chromium（1223/1228）
 * 二进制最低要求 macOS 12.0，因此 macOS 12 的机器也能装、也能跑；1.62 起 Playwright
 * 不再为 macOS 12 发布 chromium 产物（安装直接报 "does not support chromium on mac12"）。
 * 也就是说本地与 CI 用的是**同一个**自带浏览器，不存在"本地系统 Chrome、CI 自带 chromium"的差异。
 *
 * 若某台机器仍要复用系统浏览器（例如自带 chromium 下载受限），可用
 * `PLAYWRIGHT_CHANNEL=chrome pnpm e2e` 显式切换；CI 不设该变量。
 */
const CHANNEL = process.env.PLAYWRIGHT_CHANNEL
const channel =
  CHANNEL === 'chrome' || CHANNEL === 'chrome-beta' || CHANNEL === 'msedge' ? CHANNEL : undefined

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: MEMBER_BASE_URL,
    trace: 'on-first-retry',
    ...(channel === undefined ? {} : { channel }),
  },
  projects: [{ name: 'mobile-chrome', use: { ...devices['Pixel 5'] } }],
  // dev server 的首次请求要现做依赖预构建与全量转译（实测冷启动单条用例 9s+），
  // 默认 5s 的断言超时会让 CI 一上来就假红，这里按实测放大等待窗口（断言本身不变）。
  expect: { timeout: 15_000 },
  // 两个 app 各起一个 dev server：端口写死并加 strictPort，
  // 避免 activity 因 5173 被占用而被顶到随机端口、导致活动页用例形同虚设。
  webServer: [
    {
      command: `pnpm --filter @h5/app-member exec vite --port ${MEMBER_PORT} --strictPort`,
      url: MEMBER_BASE_URL,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: `pnpm --filter @h5/app-activity exec vite --port ${ACTIVITY_PORT} --strictPort`,
      url: ACTIVITY_BASE_URL,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
})
