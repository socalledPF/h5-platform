# Vue3 H5（App WebView）项目架构设计方案

Nov 13, 2026 · @xingyu

## 1. 背景、目标与约束

本方案采用 **pnpm monorepo + 每个业务一个独立 Vite 应用 + 共享平台层** 的结构：业务之间独立构建、独立发布，WebView 相关能力（JSBridge、登录、导航、适配）全部收敛到共享包，业务代码不直接接触原生。

已确定的前提：

| 维度 | 决定 | 对架构的影响 |
| --- | --- | --- |
| 加载方式 | 线上加载（CDN） | 缓存策略与发布回滚是重点；无需离线包，路由可用 history 模式 |
| 入口划分 | 每个业务一个独立入口 | 业务独立构建/发布；共享代码需抽成包并做版本管理 |
| 导航栏 | 原生或 H5 均可能 | 需要一套由 URL 参数驱动的双模式导航方案 |
| 登录 | App 注入登录态 | H5 不做登录页；token 获取与刷新统一走 JSBridge |

设计目标：

- 新业务从创建到上线只需关注业务页面，WebView 能力开箱即用。
- 同一套代码可在 App、普通浏览器（开发/分享场景）中运行，不在 App 时自动降级。
- 单个业务发布、回滚不影响其他业务。
- 首屏可度量、错误可追踪、问题可定位到 App 版本与机型。

待与客户端确认的开放问题：

- [ ] 最低支持的 iOS / Android 系统版本与 App 版本
- [ ] JSBridge 现有协议（若已有）及注入时机
- [ ] 原生导航栏可配置的范围（标题、右侧按钮、颜色、隐藏）
- [ ] 是否支持 WebView 预创建/预热

## 3. 技术选型

选型原则是主流、稳定、团队易上手；WebView 相关的特殊需求通过自研共享包解决，而不是引入重型框架。

| 领域 | 选择 | 理由 / 备注 |
| --- | --- | --- |
| 框架 | Vue 3（Composition API + `<script setup>`） | 既定 |
| 语言 | TypeScript（strict） | Bridge 协议、接口类型需要强约束 |
| 构建 | Vite | 多应用各自一份 vite 配置，共享一份 base 配置 |
| 仓库管理 | pnpm workspace + Turborepo | 共享包本地链接；按变更范围增量构建 |
| 状态管理 | Pinia | 每个业务独立 store；用户信息等全局状态放共享包 |
| 路由 | Vue Router 4，history 模式 | 线上加载可配 Nginx fallback；URL 干净，便于原生拼参数与分享 |
| UI 组件 | Vant 4（按需引入） | 移动端成熟；主题通过 CSS 变量与 App 视觉对齐 |
| 网络请求 | axios 封装 | 拦截器处理 token、刷新、错误码 |
| 移动适配 | postcss-px-to-viewport-8-plugin | 设计稿 375 宽，vw 方案 |
| 兼容 | @vitejs/plugin-legacy + browserslist | 按最低系统版本设定 target |
| 代码规范 | ESLint + Prettier + Stylelint + commitlint + lint-staged | 统一提交规范，支撑自动生成 changelog |
| 测试 | Vitest（单测）+ Playwright（关键流程，浏览器 mock 模式） | 共享包必须有单测 |
| 调试 | vConsole（非生产按需注入） | 生产不打包 |
| 监控 | Sentry（或公司自有监控平台） | 错误 + 性能 + 自定义 Bridge 失败上报 |

若团队更熟悉 NutUI 或公司已有组件库，可替换 Vant，不影响其余架构。

## 4. 工程结构

每个业务是 `apps/` 下的一个独立 Vite 应用，对应一个独立入口 URL；所有跨业务能力放在 `packages/`，业务只依赖包、不互相依赖。

```text
h5-monorepo/
├── apps/                          # 每个业务一个应用 = 一个入口
│   ├── member/                    # 例：会员中心  →  https://h5.xxx.com/member/
│   │   ├── src/
│   │   │   ├── views/
│   │   │   ├── components/
│   │   │   ├── api/               # 本业务接口
│   │   │   ├── stores/
│   │   │   ├── router/index.ts
│   │   │   ├── App.vue
│   │   │   └── main.ts            # 调用 createH5App() 启动
│   │   ├── index.html
│   │   ├── vite.config.ts         # extends 共享配置，只写 base 等差异
│   │   └── package.json
│   └── activity/                  # 例：活动页
├── packages/
│   ├── bridge/                    # JSBridge：协议、Promise 封装、事件、mock
│   ├── core/                      # env、auth、request、navigation、storage、createH5App
│   ├── ui/                        # 业务通用组件：NavBar、Page、Empty、Skeleton…
│   ├── hooks/                     # usePageShow、useKeyboard、useSafeArea…
│   ├── monitor/                   # 错误/性能/埋点上报
│   ├── styles/                    # 主题变量、safe-area、1px、reset
│   └── config/                    # vite / tsconfig / eslint / postcss 共享配置
├── scripts/
│   ├── create-app.ts              # 脚手架：一键新建业务
│   └── deploy.ts                  # 按应用上传 CDN、刷新 HTML
├── turbo.json
└── pnpm-workspace.yaml
```

**统一启动入口**：每个业务的 `main.ts` 只调用一次 `createH5App`，由它完成环境识别、Bridge 就绪等待、登录态初始化、监控、vConsole、全局样式和导航栏模式初始化，保证所有业务行为一致。

```ts
// apps/member/src/main.ts
import { createH5App } from '@h5/core'
import App from './App.vue'
import router from './router'

createH5App(App, {
  appId: 'member',          // 用于监控、埋点、日志区分业务
  router,
  requireLogin: true,       // 启动时确保拿到 token
}).then(app => app.mount('#app'))
```

**依赖规则**（用 ESLint 的 import 规则强制）：

- `apps/*` 只能依赖 `packages/*`，禁止相互引用。
- 只有 `packages/bridge` 可以访问 `window` 上的原生对象。
- `packages/*` 之间单向依赖：`bridge` ← `core` ← `ui` / `hooks`。

**新增业务流程**：执行 `pnpm create:app <name>` → 生成模板应用 → 在路由中写页面 → 在部署配置里登记 `base` 路径 → 由客户端配置入口 URL。

## 5. JSBridge 设计

Bridge 采用"消息 + 回调 ID"的异步协议，前端封装为带超时的 Promise，并通过能力探测兼容旧版 App；业务只使用 `@h5/bridge` 导出的有类型 API。

### 5.1 通信协议

H5 → 原生（调用）：

```json
{ "method": "auth.getToken", "params": {}, "callbackId": "cb_1731470000000_3", "version": 1 }
```

原生 → H5（回调）：调用 `window.__H5Bridge.callback(callbackId, { code, data, msg })`。

原生 → H5（事件推送）：调用 `window.__H5Bridge.emit(event, data)`，如 `page.resume`、`network.change`、`nav.rightButtonClick`。

传输通道：iOS 使用 `window.webkit.messageHandlers.H5Bridge.postMessage(json)`；Android 使用 `window.H5Bridge.postMessage(json)`（`addJavascriptInterface`）。

统一错误码：

| code | 含义 | 前端处理 |
| --- | --- | --- |
| 0 | 成功 | resolve |
| 1001 | 方法不存在（App 版本过旧） | 走降级逻辑 |
| 1002 | 参数错误 | 上报 + reject |
| 1003 | 用户取消（如取消分享、取消授权） | reject，业务一般静默 |
| 1004 | 权限拒绝 | 提示引导 |
| -1 | 前端超时 | 上报 + reject |
| -2 | 不在 App 环境 | 走 mock 或降级 |

### 5.2 前端封装

```ts
// packages/bridge/src/core.ts
type Result<T> = { code: number; data: T; msg?: string }
type Pending = { resolve: (v: any) => void; reject: (e: any) => void; timer: number }

const pending = new Map<string, Pending>()
const listeners = new Map<string, Set<(data: any) => void>>()
let seq = 0

export class BridgeError extends Error {
  constructor(public code: number, msg: string, public method: string) { super(msg) }
}

// 挂载给原生调用的全局对象
window.__H5Bridge = {
  callback(id: string, res: Result<any>) {
    const p = pending.get(id)
    if (!p) return
    clearTimeout(p.timer)
    pending.delete(id)
    res.code === 0 ? p.resolve(res.data) : p.reject(res)
  },
  emit(event: string, data: any) {
    listeners.get(event)?.forEach(fn => { try { fn(data) } catch (e) { console.error(e) } })
  },
}

function send(msg: string) {
  const w = window as any
  if (w.webkit?.messageHandlers?.H5Bridge) return w.webkit.messageHandlers.H5Bridge.postMessage(msg), true
  if (w.H5Bridge?.postMessage) return w.H5Bridge.postMessage(msg), true
  return false
}

export function invoke<T = unknown>(method: string, params: object = {}, timeout = 10_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const callbackId = `cb_${Date.now()}_${seq++}`
    const timer = window.setTimeout(() => {
      pending.delete(callbackId)
      reject(new BridgeError(-1, 'timeout', method))
    }, timeout)
    pending.set(callbackId, {
      resolve,
      reject: (r: Result<any>) => reject(new BridgeError(r.code, r.msg ?? '', method)),
      timer,
    })
    if (!send(JSON.stringify({ method, params, callbackId, version: 1 }))) {
      clearTimeout(timer)
      pending.delete(callbackId)
      reject(new BridgeError(-2, 'not in app', method))
    }
  })
}

export function on(event: string, fn: (data: any) => void) {
  if (!listeners.has(event)) listeners.set(event, new Set())
  listeners.get(event)!.add(fn)
  return () => listeners.get(event)!.delete(fn)
}
```

在 `core.ts` 之上按领域导出有类型 API，业务只用这一层：

```ts
// packages/bridge/src/api/auth.ts
export const auth = {
  getToken: () => invoke<{ token: string; expireAt: number }>('auth.getToken'),
  refreshToken: () => invoke<{ token: string; expireAt: number }>('auth.refreshToken'),
  login: () => invoke<void>('auth.login', {}, 120_000), // 唤起原生登录，超时放长
}
```

### 5.3 就绪、能力探测与版本兼容

- **就绪**：原生在 `documentStart` 时注入 Bridge 对象，并通过 UA 带上 `MyApp/5.6.0`。`createH5App` 启动时先 `await bridge.ready()`（检测注入对象，最多等待 1 秒），避免早期调用丢失。
- **能力探测**：启动时调用一次 `app.getCapabilities` 拿到可用方法列表并缓存；业务用 `bridge.canIUse('share.open')` 判断，不支持则降级（如隐藏分享按钮）。
- **版本兼容**：方法只增不改；需要改语义时新增方法名（如 `share.openV2`）。协议文档在仓库内维护，变更需客户端与前端双方评审。

### 5.4 浏览器 mock

`env.isApp === false` 时，`invoke` 路由到 `mock.ts`：token 读本地 `.env.local`、`nav.*` 转为普通路由跳转、`ui.toast` 用 Vant Toast。这样业务在 PC 浏览器中可完整开发和跑 E2E 测试。

### 5.5 首批 API 清单

| 领域 | 方法 | 用途 |
| --- | --- | --- |
| app | getCapabilities / getInfo | 能力列表；App 版本、系统、设备、状态栏高度、安全区 |
| auth | getToken / refreshToken / login / logout | 登录态 |
| nav | open / close / back / setTitle / setBar / setRightButtons / setBackInterceptor | 页面与导航栏 |
| ui | toast / loading / alert | 原生级弹层（需盖住原生导航栏时使用） |
| share | open | 分享 |
| device | getNetwork / getLocation / scan / vibrate | 设备能力 |
| media | chooseImage / previewImage / saveImage | 图片 |
| storage | get / set | 跨 WebView 共享的轻量数据 |
| event（原生推送） | page.resume / page.pause / network.change / nav.rightButtonClick / nav.backPress / auth.change | 生命周期与交互 |

## 6. 登录态与请求层

原生是登录态的唯一来源：H5 通过 Bridge 取 token、放在内存中使用，401 时请原生刷新，刷新失败再唤起原生登录；H5 不做登录页，也不持久化 token。

### 6.1 token 获取

- 启动时 `createH5App` 调用 `auth.getToken()`，写入 `@h5/core` 中的 `useAuthStore`（仅内存）。
- 不写 localStorage：避免多个 WebView 之间 token 不一致，也避免原生已登出而 H5 仍持有旧 token。
- 订阅原生推送的 `auth.change` 事件（登录、登出、切换账号），收到后更新 store；账号切换时直接 `location.reload()`，避免残留上一个用户的数据。
- 若后端同时依赖 Cookie（如部分老接口），由原生在加载前写入 WebView Cookie，H5 不处理。

### 6.2 401 与并发刷新

多个请求同时 401 时只刷新一次，其余请求排队等待，刷新成功后统一重放：

```ts
// packages/core/src/request.ts（节选）
let refreshing: Promise<string> | null = null

async function refreshToken(): Promise<string> {
  if (!refreshing) {
    refreshing = bridge.auth.refreshToken()
      .then(r => r.token)
      .catch(async () => {
        await bridge.auth.login()          // 刷新失败 → 原生登录页
        return (await bridge.auth.getToken()).token
      })
      .finally(() => { refreshing = null })
  }
  return refreshing
}

instance.interceptors.request.use(cfg => {
  const token = useAuthStore().token
  if (token) cfg.headers.Authorization = `Bearer ${token}`
  cfg.headers['X-App-Version'] = env.appVersion
  cfg.headers['X-H5-App'] = env.appId
  return cfg
})

instance.interceptors.response.use(
  res => unwrap(res),                      // 按后端约定解包 { code, data, msg }
  async err => {
    const cfg = err.config
    if (err.response?.status === 401 && !cfg._retried) {
      cfg._retried = true
      useAuthStore().token = await refreshToken()
      return instance(cfg)
    }
    return Promise.reject(normalizeError(err))
  },
)
```

### 6.3 请求层约定

- 统一返回 `{ code, data, msg }`，`unwrap` 在 `code !== 0` 时抛出 `ApiError`。
- 错误提示策略可按请求配置：`silent`（静默）、`toast`（默认）、`custom`（业务自行处理）。
- 超时默认 15 秒；GET 请求在网络错误时自动重试 1 次。
- 页面卸载时通过 `AbortController` 取消未完成请求，防止返回后写入已销毁的组件。
- 接口按业务放在各自 `apps/*/src/api`，类型从后端 OpenAPI 文档生成（如 openapi-typescript）。

## 7. 导航栏双模式与页面导航

导航栏模式由打开页面的一方通过 URL 参数决定，H5 侧用一个 `<AppNavBar>` 组件统一处理：原生模式下它不渲染，只把标题和按钮同步给原生；H5 模式下它自己渲染导航栏。业务页面写法完全相同。

### 7.1 模式决定规则

| 优先级 | 来源 | 示例 | 说明 |
| --- | --- | --- | --- |
| 1 | URL 参数 | `?nav=native` / `?nav=h5` / `?nav=none` | 打开方指定，原生和 H5 互相打开时都带上 |
| 2 | 路由 meta | `meta: { nav: 'none' }` | 页面级覆盖，如沉浸式活动页 |
| 3 | 应用默认 | `createH5App({ defaultNav: 'native' })` | 业务入口默认值 |
| 4 | 环境兜底 | 不在 App 内 → `h5` | 浏览器打开时总要有返回和标题 |

`nav=none` 表示原生不显示导航栏、H5 也不显示（全屏沉浸），页面自己负责顶部安全区和返回按钮。

### 7.2 组件与 API

```vue
<!-- 业务页面：两种模式写法相同 -->
<AppNavBar title="我的订单" :right="[{ id: 'help', text: '帮助' }]" @right-click="onHelp" />
```

- **原生模式**：组件在 `onMounted` 与路由切换时调用 `nav.setTitle`、`nav.setRightButtons`，并订阅 `nav.rightButtonClick` 转为 `right-click` 事件；组件本身渲染为空。
- **H5 模式**：渲染固定在顶部的导航栏，高度 44px + 状态栏高度。状态栏高度优先取 `env(safe-area-inset-top)`，取不到时用 `app.getInfo()` 返回的 `statusBarHeight`（需原生把 WebView 铺到状态栏下方）。
- 页面标题变化（如动态拉取商品名）只需更新 `title` prop，组件负责同步。
- 同时设置 `document.title`，兼顾浏览器场景和部分原生按 `document.title` 取标题的旧实现。

### 7.3 返回逻辑

一个入口内是 SPA，返回需要区分"路由内返回"和"关闭 WebView"：

1. H5 维护入口内的路由栈深度（在 `router.afterEach` 中按 push / replace / back 记录）。
2. 点击返回（H5 导航栏按钮、原生导航栏返回、Android 物理返回键）时：栈深度 > 1 → `router.back()`；否则 → `nav.close()` 关闭当前 WebView。
3. 原生导航栏与物理返回键：H5 启动时调用 `nav.setBackInterceptor(true)`，原生收到返回操作后不直接关闭，而是推送 `nav.backPress` 事件交给 H5 决定；H5 未响应（超时 300ms）时原生按默认行为返回，避免页面卡死无法退出。
4. 业务可注册拦截（如表单未保存提示）：`useBackGuard(() => confirm('放弃编辑？'))`。

### 7.4 页面跳转规则

| 场景 | 方式 | 理由 |
| --- | --- | --- |
| 同一业务内 | `router.push` | 快，无需新建 WebView |
| 跨业务入口 | `nav.open({ url, nav })` 新开 WebView | 业务隔离，返回自然回到上一业务 |
| 打开原生页面 | `nav.open({ route: 'native://order/detail?id=1' })` | 由原生路由处理 |
| 外部链接 | `nav.open({ url, external: true })` | 原生决定用内置浏览器还是系统浏览器 |

封装为统一函数 `navigate(target)`，由它判断目标属于哪一类，业务不感知。

### 7.5 页面可见性

从原生页面或另一个 WebView 返回时，Vue 生命周期不会重新触发。`usePageShow(fn)` 同时监听原生推送的 `page.resume` 和浏览器的 `visibilitychange`，去重后回调，用于刷新列表、订单状态等数据。

## 8. 屏幕适配与兼容性

以 375 宽设计稿 + vw 自动换算为基础，安全区统一用 CSS `env()` 处理，键盘与 iOS/Android 差异封装在 `@h5/hooks` 和 `@h5/styles` 中，业务不重复处理。

### 8.1 viewport 与尺寸

```html
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
```

- 设计稿 375 宽，代码按设计稿写 px，由 postcss 转为 vw；`node_modules/vant` 按 375 基准单独配置。
- 需要固定像素的场景（如 1px 边框、平板上限宽）用大写 `PX` 或注释跳过转换。
- 平板/折叠屏：根容器 `max-width: 600px; margin: 0 auto`，避免内容被无限放大。
- 1px 细线：统一用伪元素 + `transform: scaleY(0.5)` 的 mixin。

### 8.2 安全区与沉浸式

- 全局 CSS 变量：`--safe-top: env(safe-area-inset-top, 0px)`、`--safe-bottom: env(safe-area-inset-bottom, 0px)`。
- 底部固定按钮、Tabbar 统一 `padding-bottom: var(--safe-bottom)`。
- `nav=h5` 或 `nav=none` 时需原生将 WebView 铺满到状态栏下（沉浸式），否则 H5 导航栏上方会多出一块空白；Android 部分机型 `env()` 不生效，用 `app.getInfo().statusBarHeight` 写入 `--safe-top` 兜底。

### 8.3 键盘

- iOS：键盘收起后页面可能不回弹，`useKeyboard` 在输入框 blur 时执行 `window.scrollTo(0, 0)`。
- Android：键盘弹出时视口高度变化，底部固定元素会被顶起；监听 `visualViewport.resize`，键盘弹起期间隐藏底部固定栏。
- 输入框被遮挡时调用 `el.scrollIntoView({ block: 'center' })`。

### 8.4 常见差异清单

| 问题 | 平台 | 处理 |
| --- | --- | --- |
| 页面整体可回弹、露出底色 | iOS | 根容器 `overscroll-behavior: none`，滚动放在内部容器 |
| 点击出现灰色高亮 | iOS/Android | `-webkit-tap-highlight-color: transparent` |
| 长按弹出系统菜单 | iOS | 非文本区域 `-webkit-touch-callout: none` |
| 日期 `new Date('2026-11-13 10:00')` 返回 Invalid | iOS | 统一用 dayjs 解析 |
| `position: fixed` 在键盘弹出时错位 | iOS | 见 8.3 |
| 视频自动全屏 | iOS | `playsinline webkit-playsinline` |
| 老内核不支持新语法 | Android 低版本 | plugin-legacy + 按最低版本设 browserslist |
| 音视频需要用户手势才能播放 | 双端 | 交互后再播放，或由原生配置 WebView 允许自动播放 |

## 9. 构建、部署与缓存

每个业务独立构建、独立发布：静态资源带 hash 上 CDN 并长期缓存，`index.html` 不缓存；发布和回滚都只是切换该业务的 `index.html`，秒级生效且互不影响。

### 9.1 URL 与目录规划

| 内容 | 地址 | 缓存头 |
| --- | --- | --- |
| 业务入口 HTML | `https://h5.xxx.com/<app>/` | `Cache-Control: no-cache`（每次协商） |
| 业务静态资源 | `https://cdn.xxx.com/h5/<app>/<version>/assets/*.[hash].js` | `max-age=31536000, immutable` |
| 公共依赖（可选） | `https://cdn.xxx.com/h5/vendor/vue-3.x.js` | 长期缓存 |

- 入口 HTML 走自有域名（便于 Nginx history fallback 和 App 白名单），资源走 CDN。
- Nginx 对每个业务配置 `location /<app>/ { try_files $uri /<app>/index.html; }` 支持 history 模式。
- 资源路径中带版本号目录，旧版本资源保留至少 30 天，确保已打开的页面懒加载 chunk 不会 404。

### 9.2 构建

- `turbo run build --filter=...[origin/main]` 只构建有变更的业务及受共享包影响的业务。
- Vite `base` 设为 `https://cdn.xxx.com/h5/<app>/<version>/`，版本号 = 业务 package.json 版本 + git 短 hash。
- 构建时注入 `__APP_ID__`、`__APP_VERSION__`、`__BUILD_TIME__`，用于监控和问题定位。
- 产物上传 Sentry sourcemap 后从 CDN 产物中删除 `.map` 文件。

### 9.3 环境

| 环境 | 入口域名 | 用途 | 调试工具 |
| --- | --- | --- | --- |
| dev | localhost（浏览器 mock） | 本地开发 | Vue DevTools |
| test | h5-test.xxx.com | 测试包 App 联调 | vConsole 默认开启 |
| pre | h5-pre.xxx.com | 预发验证，连生产数据 | vConsole 按参数开启 |
| prod | h5.xxx.com | 线上 | 无 |

App 的测试包提供环境切换开关，将 `h5.xxx.com` 映射到 test/pre 域名，前端无需改代码。

### 9.4 发布、灰度与回滚

1. CI 构建 → 上传静态资源到 CDN（新版本目录，不覆盖旧文件）。
2. 上传新 `index.html` 为 `index.<version>.html`，此时线上无影响。
3. 灰度：Nginx 根据用户 ID 尾号或请求头（App 带上的 uid / 版本）把一部分流量指向新版 HTML。
4. 全量：把 `index.html` 指向新版本。
5. 回滚：把 `index.html` 指回上一版本，无需重新构建。

每次发布记录"业务 / 版本 / commit / 发布人 / 时间"，监控面板按版本对比错误率，异常时一键回滚。

### 9.5 共享包版本

共享包在 monorepo 内以 `workspace:*` 引用，修改后由 turbo 识别受影响的业务一并构建。对破坏性修改（尤其是 `@h5/bridge`）要求：同一 PR 内修复所有业务的用法，并由每个受影响业务的负责人确认后再发布。

## 10. 性能优化

线上加载的首屏耗时主要由三段构成：WebView 初始化、HTML 与 JS 下载、首屏接口；前端负责后两段，第一段需要客户端配合，因此先建立分段打点，再按数据优化。

### 10.1 指标与打点

- 原生在 URL 上带 `__t0`（用户点击时刻）或通过 `app.getInfo` 返回 WebView 创建、开始加载的时间点。
- H5 记录：HTML 到达（`performance.timing`）、JS 执行开始、首屏接口返回、首屏渲染完成（业务在首屏数据渲染后调用 `markFirstScreen()`）。
- 上报字段：业务、版本、App 版本、系统、网络类型、各阶段耗时；监控按 P50 / P90 观察。
- 目标值需基于首批数据设定，建议以 "点击到首屏可见" 的 P90 为核心指标。

### 10.2 前端优化手段

- **入口体积**：每个业务独立入口，天然只加载本业务代码；路由级懒加载；Vant 按需引入；设置入口 JS 体积预算，CI 中用 `rollup-plugin-visualizer` 产出报告，超预算告警。
- **并行请求首屏数据**：在 `index.html` 中内联一小段脚本，向原生同步取 token 后立即发出首屏接口，结果存入 `window.__PREFETCH__`，Vue 挂载后直接读取，节省 JS 下载与执行期间的等待。
- **骨架屏**：直接写在 `index.html` 中，HTML 一到达就显示，不依赖 Vue 挂载。
- **资源**：图片走 CDN 图片处理（按屏宽裁剪、WebP/AVIF）；首屏关键图片 `preload`，非首屏图片懒加载。
- **缓存**：利用 9.1 的强缓存策略，二次打开只需协商 `index.html`；公共依赖固定版本单独打包可跨业务复用缓存。
- **DNS 与连接**：`<link rel="preconnect">` 到 CDN 与 API 域名。

### 10.3 需要客户端配合

- **WebView 预创建/复用池**：App 启动空闲时预先创建 WebView，省去打开时的初始化耗时，通常是收益最大的一项。
- **启动时同步提供基础信息**：通过 UA 或注入的全局变量提供 App 版本、状态栏高度、token，减少 H5 启动时的 Bridge 往返。
- **HTTP 缓存**：确认 WebView 未禁用磁盘缓存。

## 11. 调试、监控与埋点

开发期靠真机远程调试和 vConsole，线上靠统一的 `@h5/monitor` 上报错误、性能、Bridge 失败和埋点，所有上报都带上业务、版本和 App 环境信息，保证问题能定位到具体版本和机型。

### 11.1 调试

| 手段 | 适用 | 前提 |
| --- | --- | --- |
| Chrome `chrome://inspect` | Android 真机 | 测试包开启 `setWebContentsDebuggingEnabled(true)` |
| Safari 开发菜单 | iOS 真机 | 测试包设置 `isInspectable = true`（iOS 16.4+） |
| vConsole | 无法连电脑时、测试同学反馈问题 | test 环境默认注入；pre 环境 URL 加 `?debug=1` 注入 |
| 浏览器 mock | 日常开发 | Bridge mock，见 5.4 |
| 代理抓包（Charles / Whistle） | 接口与资源问题 | 测试包信任代理证书 |

### 11.2 监控上报

- **JS 错误**：`app.config.errorHandler`、`window.onerror`、`unhandledrejection`；资源加载失败（`error` 事件捕获阶段）。
- **白屏检测**：挂载后 3 秒检查根节点是否有有效内容，没有则上报并附带最近的错误。
- **Bridge 失败**：`invoke` 内对非 0 且非用户取消的结果统一上报方法名与错误码，用于发现客户端兼容问题。
- **接口异常**：HTTP 失败、业务错误码、超时，按接口聚合。
- **性能**：见 10.1。
- **公共字段**：appId、H5 版本、App 版本、系统及版本、机型、网络、uid（脱敏）、页面路由。
- 采样：错误全量，性能按 10%–20% 采样，可通过远程配置调整。

### 11.3 埋点

- 优先使用 App 的埋点 SDK（通过 `track.event` Bridge 方法），保证与原生埋点在同一用户会话中、口径一致。
- 页面曝光在 `router.afterEach` 与 `usePageShow` 中自动上报；点击埋点用指令 `v-track="{ id: 'order_pay_click' }"`。
- 不在 App 内时降级到 Web 埋点上报接口。

## 12. 开发规范与协作

规范的重点是守住边界：业务不碰原生、共享包变更有评审、Bridge 协议有唯一文档来源。

### 12.1 代码规范

- 组件统一 `<script setup lang="ts">`；页面放 `views/`，可复用逻辑抽为 `useXxx`。
- 禁止在 `apps/*` 中直接访问 `window.webkit`、`window.H5Bridge`、`navigator.userAgent`（ESLint `no-restricted-properties` 拦截），统一走 `@h5/bridge` 与 `@h5/core/env`。
- 样式用 scoped + CSS 变量主题；颜色、字号、间距只用 `@h5/styles` 中定义的变量。
- 提交遵循 Conventional Commits，按业务目录作为 scope，如 `feat(member): 新增积分明细`。

### 12.2 与客户端协作

- Bridge 协议文档放在仓库 `docs/bridge-protocol.md`，每个方法写明：参数、返回、错误码、最低 App 版本、双端负责人。
- 新增方法流程：前端提需求 → 双方评审文档 → 客户端实现并在测试包提供 → 前端在 `@h5/bridge` 中接入并补 mock → 标注最低版本。
- 维护一个 **Bridge 调试页**（独立入口 `apps/bridge-playground`），可逐个调用所有方法并查看返回，客户端自测和回归都使用它。

### 12.3 与后端协作

- 接口返回结构、错误码、401 语义统一约定（见 6.3）。
- 接口类型由 OpenAPI 文档生成，后端变更后前端重新生成，类型不一致在编译期暴露。

### 12.4 质量门禁

- PR 必须通过：类型检查、lint、单测（共享包覆盖率 ≥ 80%）、构建、包体积预算。
- 修改 `packages/*` 的 PR 需至少一名平台负责人审批。
- 每次发布前在 test 环境用双端测试包各走一遍关键流程（打开、登录态、导航返回、分享）。

## 13. 风险、取舍与演进

最大的长期风险是 Bridge 协议失控与共享包变更波及所有业务；这两点通过协议文档、能力探测和变更评审控制。其余取舍在当前规模下都偏向简单。

### 13.1 主要取舍

| 决定 | 换来的 | 付出的 | 何时重新评估 |
| --- | --- | --- | --- |
| monorepo 多应用，而非单 SPA 多路由 | 业务独立发布、首屏更小、故障隔离 | 共享依赖重复下载；跨业务跳转需新开 WebView | 业务数 > 15 或跨业务跳转频繁时 |
| monorepo，而非微前端/多仓库 | 共享包修改即时生效、统一规范 | 仓库变大；共享包改动影响面广 | 团队 > 3 个独立小组、需要独立技术栈时 |
| 线上加载，不做离线包 | 发布简单、即时生效、无客户端开发量 | 首屏依赖网络；弱网体验一般 | 首屏 P90 达不到目标且瓶颈在下载时 |
| token 仅存内存 | 与原生登录态始终一致 | 每次打开需一次 Bridge 调用 | 一般无需改变 |
| 导航栏双模式 | 兼容不同页面诉求 | 组件与适配复杂度增加 | 若最终统一为一种模式，可删掉另一套实现 |

### 13.2 风险清单

| 风险 | 影响 | 应对 |
| --- | --- | --- |
| 线上 H5 被旧版 App 打开，调用了不存在的方法 | 功能异常或报错 | 能力探测 + 降级；方法标注最低版本 |
| Bridge 注入时机晚于 H5 调用 | 启动期调用丢失 | `bridge.ready()` 等待；原生在 documentStart 注入 |
| `index.html` 被中间层缓存 | 用户看不到新版本 | `no-cache` + 发布后校验；必要时 HTML 带版本查询参数 |
| 共享包破坏性修改 | 多个业务同时出问题 | 同 PR 修复所有调用方 + 平台负责人审批 + 按业务灰度 |
| Android 碎片化内核兼容问题 | 部分机型白屏 | plugin-legacy；白屏检测按机型聚合告警 |

### 13.3 演进路线

1. **第一阶段（基础设施）**：monorepo 骨架、`@h5/bridge`、`@h5/core`、`AppNavBar`、脚手架、CI/CD、监控接入；用一个真实业务做试点。
2. **第二阶段（推广）**：迁移/新建其余业务；完善 Bridge 调试页和协议文档；建立首屏性能基线。
3. **第三阶段（按数据优化）**：根据性能数据推动 WebView 预热；若仍不达标，再评估离线包或资源预加载。
