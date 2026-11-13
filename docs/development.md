# 开发手册

面向日常写业务的人：怎么在浏览器里开发、怎么上真机、提交前会跑什么、代码要遵守哪些边界、和客户端 / 后端怎么对接。

## 1. 本地开发

```bash
pnpm install
pnpm dev                                # 所有应用
pnpm --filter @h5/app-member dev        # 只起一个应用，默认 http://localhost:5173
```

### 浏览器 mock 模式的原理

日常开发**不需要 App、不需要真机**：`@h5/bridge` 内置 mock 层。核心判断是 `env.isApp`——启动时 `bridge.ready()` 探测 `window.webkit.messageHandlers.H5Bridge`（iOS）与 `window.H5Bridge.postMessage`（Android）是否存在：

- **在 App 内**：`invoke()` 把 `{ method, params, callbackId, version }` 通过原生通道发出去，等 `window.__H5Bridge.callback()` 回调；超时 reject `-1`。
- **不在 App 内**：`invoke()` 直接路由到 mock 实现，返回同为 `{ code, data, msg }` 结构的数据：
  - `auth.getToken` 读本地 `.env.local` 里的假 token；`auth.login` 直接 resolve
  - `nav.open` / `nav.close` / `nav.back` 转成普通路由跳转或 `history.back()`
  - `ui.toast` / `ui.loading` / `ui.alert` 用 Vant 实现，观感与原生接近
  - `app.getInfo` 返回构造出来的 App 版本、系统、状态栏高度，方便验证适配分支

因为业务只调用 `@h5/bridge` 导出的有类型 API，**业务代码一行都不用改**就能在浏览器里跑通全流程；Playwright E2E 也跑在这套 mock 上（`pnpm e2e`，自带 member 的 dev server）。

要点：

- 业务禁止自己判断环境（见 §3 的 ESLint 规则），需要环境信息时用 `@h5/core` 的 `env`。
- mock 数据要跟真实 App 行为一致；新增 Bridge 方法时必须同步补 mock，否则浏览器开发会断。
- 需要真实接口时在 `.env.local` 里配 `VITE_API_BASE_URL`，vite 会把 `/api` 代理过去规避跨域。

## 2. 真机联调

| 手段                          | 适用                           | 前提                                                                                             |
| ----------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------ |
| Chrome `chrome://inspect`     | Android 真机                   | 测试包开启 `setWebContentsDebuggingEnabled(true)`；手机 USB 调试已授权                           |
| Safari 开发菜单               | iOS 真机                       | 测试包设置 `isInspectable = true`（iOS 16.4+）；Safari「设置 → 高级 → 显示网页开发者功能」已开启 |
| vConsole                      | 无法连电脑时、测试同学反馈问题 | test 环境默认注入；pre 环境在 URL 加 `?debug=1` 注入；prod 不打包                                |
| 浏览器 mock                   | 日常开发                       | `@h5/bridge` mock 层，见上一节                                                                   |
| 代理抓包（Charles / Whistle） | 接口与资源问题                 | 测试包信任代理证书；手机与电脑同网段并配置 HTTP 代理                                             |

排查顺序建议：先看 vConsole 里的错误 → 再看抓包是否 404 / 401 → 需要断点时才上 `chrome://inspect` / Safari。真机问题务必记下**机型 + 系统版本 + App 版本 + H5 版本**，监控里靠这四个字段聚合。

## 3. 代码规范（§12.1）

- 组件统一 `<script setup lang="ts">`；**页面放 `apps/<app>/src/views/`**，可复用逻辑抽成 `useXxx`（放 `packages/hooks` 或业务内 `composables/`）。
- **禁止在 `apps/*` 里直接访问原生对象**：`window.webkit`、`window.H5Bridge`、`navigator.userAgent`、`navigator.userAgentData`，以及解构它们，统一走 `@h5/bridge` 与 `@h5/core/env`。
  这条由 `packages/config/eslint.mjs` 的 `no-restricted-properties` / `no-restricted-syntax` 强制，**只有 `packages/bridge` 被豁免**。
- 依赖边界（同样由 ESLint 强制）：
  - `apps/*` 只能依赖 `packages/*`，禁止相互引用（`@h5/app-*` 与跨 app 相对路径都在禁止列表里）。
  - `packages/*` 禁止依赖 `apps/*`。
  - 层序单向：`bridge` ← `core` ← `ui` / `hooks` / `monitor`；`bridge` 是最底层，不能反向依赖。
  - 禁止引用包内部路径（`@h5/*/src/**`），只能用包入口 `@h5/core` 这种写法。
- 样式用 `<style scoped>` + CSS 变量主题；**颜色、字号、间距只用 `@h5/styles` 里定义的变量**，不要在业务里写死色值。
- 提交遵循 Conventional Commits，**scope 用业务目录名**：`feat(member): 新增积分明细`、`fix(activity): 修复倒计时`、`chore(scripts): …`。

## 4. 提交与 pre-commit

husky 装了两个钩子（`pnpm install` 时 `prepare` 自动安装）：

| 钩子         | 实际执行                           | 作用                                                                                                                                                                                                |
| ------------ | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pre-commit` | `pnpm exec lint-staged`            | 只处理**暂存区**文件：`*.{ts,tsx,mts,vue,js,mjs,cjs}` → `eslint --fix` + `prettier --write`；`*.{css,scss,less}` → `stylelint --fix` + `prettier --write`；`*.{json,yml,yaml}` → `prettier --write` |
| `commit-msg` | `pnpm exec commitlint --edit "$1"` | 校验提交信息符合 `@commitlint/config-conventional`，`header-max-length` 100，`subject-case` 不限制                                                                                                  |

因此：

- 提交前**不需要手动跑格式化**，钩子会改；但改动完成后必须**重新 `git add`**，否则修复没进这次提交。
- 提交信息写不对会直接被拒，例如 `fix: 修复` 可以，`修复了xx` 不行（缺 type）；scope 建议写业务名。
- 紧急情况下 `HUSKY=0 git commit …` 可以跳过钩子，但 CI 会重新检查一遍（`pnpm lint` 带 `--max-warnings 0`），跳过只会在 CI 挂。

## 5. 质量门禁

本地提交 PR 前跑一遍：

```bash
pnpm typecheck && pnpm lint && pnpm lint:style && pnpm test && pnpm build
```

- CI（`.github/workflows/ci.yml`）顺序相同：Install（`--frozen-lockfile`）→ Typecheck → Lint → Lint styles → Test → Build，node 24 + pnpm 12。
- `pnpm lint` 带 `--max-warnings 0`，**warning 也算失败**。
- **共享包单测覆盖率 ≥ 80%**（§12.4）：改了 `packages/*` 必须补测试，覆盖率按包看。
- 包体积预算：`ANALYZE=1 pnpm --filter @h5/app-xxx build` 产出 `dist/stats.html`，入口体积超预算时在评审里说明（预算数值由各业务在评审时确定）。
- 修改 `packages/*` 的 PR 需要至少一名平台负责人审批。
- 发布前在 test 环境用双端测试包各走一遍关键流程：打开、登录态、导航返回、分享。

## 6. 与客户端协作（§12.2）

Bridge 协议文档是唯一来源：`docs/bridge-protocol.md`，每个方法必须写明**参数、返回、错误码、最低 App 版本、双端负责人**。

新增方法的流程固定为五步：

1. 前端提需求（方法名、参数、返回、使用场景、期望的最低 App 版本）。
2. 双方评审文档，在 `docs/bridge-protocol.md` 落稿后再动代码。
3. 客户端实现，并在测试包里提供可调用版本。
4. 前端在 `@h5/bridge` 中接入 API，**同时补 mock 实现**（否则浏览器开发会断）。
5. 标注最低版本，并用 `bridge.canIUse('<method>')` 做能力探测 + 降级。

另外：`apps/bridge-playground` 是独立的 Bridge 调试页，可逐个调用所有方法并查看返回，客户端自测和回归都用它。协议变更（尤其是改语义）只走"新增方法名"这条路（如 `share.openV2`），老方法不删不改。

## 7. 与后端协作（§12.3）

- 统一返回结构 `{ code, data, msg }`：`code !== 0` 时 `@h5/core` 的 `unwrap` 抛 `ApiError`，业务只处理成功分支。
- **401 语义**：由原生刷新 token；多个请求同时 401 只刷新一次，其余排队等待后重放；刷新失败才唤起原生登录。H5 不做登录页、不持久化 token。
- 错误提示策略按请求配置：`silent`（静默）/ `toast`（默认）/ `custom`（业务自行处理）。
- 超时默认 15s，GET 在网络错误时自动重试 1 次；页面卸载时用 `AbortController` 取消未完成请求。
- 接口类型由后端 OpenAPI 文档生成（如 `openapi-typescript`），**后端变更后前端重新生成**，类型不一致在编译期暴露。
- 接口按业务放 `apps/<app>/src/api`，不放到共享包。

## 8. 屏幕适配约定（§8.1）

- 设计稿宽度 **375**，代码按设计稿写 `px`，由 `postcss-px-to-viewport-8-plugin` 转成 `vw`（`@h5/config/postcss.mjs`：`viewportWidth: 375`，`propList: ['*']`，`minPixelValue: 1`）。`node_modules/vant` 也按 375 基准转换。
- **需要固定像素时用大写 `PX`**（插件只匹配小写 `px`）：1px 细线、平板上限宽等场景。
- 也可以用 `selectorBlackList` 里的 `.ignore-vw` / `.no-vw` class 让整个选择器跳过转换。
- 平板 / 折叠屏：根容器 `max-width: 600px; margin: 0 auto`，避免内容被无限放大——**注意 `600px` 会被转成 vw 而失效，这种固定尺寸要写成 `600PX` 或加 `.ignore-vw`**。
- 1px 细线统一用伪元素 + `transform: scaleY(0.5)` 的 mixin，不要直接写 border。
- 安全区用 CSS 变量：`--safe-top: env(safe-area-inset-top, 0px)`、`--safe-bottom: env(safe-area-inset-bottom, 0px)`；底部固定按钮 / Tabbar 统一 `padding-bottom: var(--safe-bottom)`。Android 个别机型 `env()` 不生效，用 `app.getInfo().statusBarHeight` 兜底。
- `viewport` meta 固定为 `width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover`。

## 9. 新增 Bridge 方法 checklist

前端部分：

- [ ] 需求已写清方法名 / 参数 / 返回 / 错误码 / 期望最低 App 版本，并在 `docs/bridge-protocol.md` 评审通过
- [ ] `@h5/bridge` 中按领域新增有类型 API（`packages/bridge/src/api/*.ts`），不直接暴露 `invoke`
- [ ] 同步补 mock 实现（浏览器开发 + E2E 依赖它）
- [ ] 标注最低版本，调用处用 `bridge.canIUse()` 探测并给降级方案（隐藏入口 / 提示升级 / 走 H5 实现）
- [ ] 错误码按协议处理：`1001` 降级、`1003` 静默、`1004` 引导、`-1/-2` 上报
- [ ] 在 `apps/bridge-playground` 中加一条可调用用例，客户端可自测
- [ ] 该方法失败/成功的监控上报已加（`@h5/monitor`）
- [ ] 单测覆盖：参数透传、超时、错误码映射、mock 分支（共享包覆盖率 ≥ 80%）
- [ ] 客户端已在测试包提供实现，双端各走一遍真机

## 10. 常见问题

**改完 `packages/*` 业务没生效？**
走 `workspace:*` 本地链接，源码即产物，重启对应 dev server 即可；如果 turbo 缓存了旧结果，用 `pnpm --filter @h5/app-xxx dev` 单独起。

**`pnpm typecheck` 过了但 `vite build` 报 `__APP_ID__` 未定义？**
这些常量由 `@h5/config/vite` 注入，应用的 `vite.config.ts` 必须调用 `createAppViteConfig({ appId: '<name>' })`；脚手架已经生成好，手写配置时容易漏。

**新增应用后 `pnpm dev` 找不到？**
`pnpm-workspace.yaml` 的范围是 `apps/*`，新目录建好后跑一次 `pnpm install` 让 pnpm 建立链接。

**为什么我的 `px` 没被转成 vw？**
大写 `PX` 会跳过转换；另外 `minPixelValue: 1` 意味着小于 1px 的值不转，选择器命中 `.ignore-vw` / `.no-vw` 时整个选择器都不转。
