import { defineConfig, devices } from '@playwright/test'

const MEMBER_PORT = 5173
const ACTIVITY_PORT = 5174

/** member 是 e2e 的主入口，作为 baseURL。 */
const MEMBER_BASE_URL = `http://127.0.0.1:${MEMBER_PORT}`
/** activity 是独立入口的应用：必须一起起来，否则活动页用例会被跳过，等于没测。 */
const ACTIVITY_BASE_URL = `http://127.0.0.1:${ACTIVITY_PORT}`

/**
 * 浏览器渠道兜底：Playwright 1.65 已不支持在 macOS 12 上安装自带 chromium，
 * 本机可用 `PLAYWRIGHT_CHANNEL=chrome pnpm e2e` 复用系统 Chrome 跑同一套用例。
 * CI 不设该变量，仍然使用 Playwright 自带的 chromium，门禁强度不变。
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
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: `pnpm --filter @h5/app-activity exec vite --port ${ACTIVITY_PORT} --strictPort`,
      url: ACTIVITY_BASE_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
})
