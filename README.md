# H5 多应用（App WebView）

在 App 内嵌 WebView 里运行的 Vue3 H5 集合：pnpm monorepo，**一个业务一个独立 Vite 应用**，独立构建、独立发布；WebView 相关能力（JSBridge、登录态、导航栏、屏幕适配、监控）全部收敛到 `packages/*`，业务代码不直接接触原生。

线上通过 CDN 加载，发布和回滚只切换某个业务的 `index.html`，业务之间互不影响。

## 技术栈

| 领域 | 选型                                                     | 说明                                                  |
| ---- | -------------------------------------------------------- | ----------------------------------------------------- |
| 框架 | Vue 3（Composition API + `<script setup>`）              | 组件统一 `<script setup lang="ts">`                   |
| 语言 | TypeScript（strict）                                     | Bridge 协议与接口类型需要强约束                       |
| 构建 | Vite 7                                                   | 每个应用一份 `vite.config.ts`，共享 `@h5/config/vite` |
| 路由 | Vue Router 4                                             | history 模式，靠 Nginx `try_files` 兜底               |
| 状态 | Pinia 3                                                  | 业务 store 各自维护，登录态等全局状态在共享包         |
| UI   | Vant 4（按需引入）                                       | 主题走 CSS 变量，与 App 视觉对齐                      |
| 请求 | axios                                                    | 拦截器处理 token、401 刷新、`{code,data,msg}` 解包    |
| 测试 | Vitest（单测）+ Playwright（E2E）                        | E2E 跑浏览器 mock 模式，不需要 App                    |
| 仓库 | pnpm workspace + Turborepo                               | 共享包本地链接，按变更范围增量构建                    |
| 规范 | ESLint + Prettier + Stylelint + commitlint + lint-staged | 提交即校验，支撑自动 changelog                        |

## 目录结构

```text
h5-platform/
├── apps/                        # 每个业务一个应用 = 一个独立入口 URL
│   ├── member/                  # 会员中心，也是 pnpm create:app 的默认骨架
│   ├── activity/                # 活动页
│   └── bridge-playground/       # Bridge 调试页，客户端自测与回归用
├── packages/
│   ├── bridge/                  # JSBridge：协议、Promise 封装、事件、浏览器 mock
│   ├── core/                    # env、auth、request、navigation、storage、createH5App
│   ├── ui/                      # 业务通用组件：NavBar、Page、Empty、Skeleton…
│   ├── hooks/                   # usePageShow、useKeyboard、useSafeArea…
│   ├── monitor/                 # 错误 / 性能 / 埋点上报
│   ├── styles/                  # 主题变量、safe-area、1px 细线、reset
│   └── config/                  # vite / tsconfig / eslint / postcss 共享配置
├── scripts/
│   ├── create-app.ts            # 脚手架：pnpm create:app <name>
│   └── deploy.ts                # 发布：pnpm run deploy --app <name>
├── tests/                       # 仓库级单测（tests/**/*.test.ts，jsdom 环境）
├── docs/                        # 文档站（VitePress）：协议与手册，见下方文档索引
├── turbo.json                   # 任务编排与缓存
├── tsconfig.base.json           # 根 tsconfig（共享包路径别名）
├── tsconfig.scripts.json        # 只覆盖 scripts/** 和 playwright.config.ts
├── pnpm-workspace.yaml          # workspace 范围：apps/* 与 packages/*
└── .github/workflows/ci.yml     # CI：typecheck → lint → lint:style → test → build → docs:build
```

## 快速开始

```bash
pnpm install      # 安装依赖并链接 workspace 包
pnpm dev          # 启动所有应用的 vite dev server（member 在 http://localhost:5173）
```

**日常开发不需要 App**：不在 App 环境时 `@h5/bridge` 自动走 mock 层，token、导航、Toast 都有浏览器实现，业务代码一行不改即可调试。原理见 [docs/development.md](docs/development.md)。

只想起一个应用：

```bash
pnpm --filter @h5/app-member dev
```

## 根脚本

以下全部来自根 `package.json` 的 `scripts`：

| 脚本                     | 命令                                                                         | 用途                                                                                   |
| ------------------------ | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `pnpm dev`               | `turbo run dev`                                                              | 并行启动所有应用的 dev server，改代码热更新                                            |
| `pnpm build`             | `turbo run build`                                                            | 构建所有应用（先跑依赖包的 typecheck），产物在 `apps/*/dist`                           |
| `pnpm typecheck`         | `turbo run typecheck && pnpm typecheck:scripts && pnpm typecheck:workspaces` | 全仓库类型检查，含 `scripts/**`；末尾的计数断言确保没有 workspace 被静默跳过           |
| `pnpm typecheck:scripts` | `tsc -p tsconfig.scripts.json`                                               | 只检查 `scripts/**` 与 `playwright.config.ts`                                          |
| `pnpm lint`              | `eslint . --max-warnings 0`                                                  | JS/TS/Vue 规范与依赖边界检查，任何 warning 都算失败                                    |
| `pnpm lint:style`        | `stylelint "**/*.{css,vue}" --max-warnings 0`                                | 样式规范检查                                                                           |
| `pnpm test`              | `vitest run && turbo run test`                                               | 先跑仓库级单测，再跑各包/应用的测试                                                    |
| `pnpm test:coverage`     | `vitest run --coverage && pnpm coverage:packages`                            | 带覆盖率跑仓库级单测 + 五个共享包的 80% 阈值                                           |
| `pnpm e2e`               | `playwright test`                                                            | Playwright 关键流程，自带 member/activity 两个 dev server（mock 模式，端口 5273/5274） |
| `pnpm format`            | `prettier --write .`                                                         | 按 `.prettierrc.json` 全量格式化                                                       |
| `pnpm format:check`      | `prettier --check .`                                                         | 只检查不修改，CI 风格                                                                  |
| `pnpm clean`             | `rm -rf node_modules coverage .turbo apps/*/dist …`                          | 清理依赖与产物（不删源码）                                                             |
| `pnpm create:app <name>` | `node --experimental-strip-types scripts/create-app.ts`                      | 新建业务应用（见下节）                                                                 |
| `pnpm run deploy`        | `node --experimental-strip-types scripts/deploy.ts`                          | 发布到 CDN（默认 dry-run，见 [docs/deployment.md](docs/deployment.md)）                |
| `pnpm docs:dev`          | `vitepress dev docs`                                                         | 本地预览文档站，`docs/` 就是站点根目录                                                 |
| `pnpm docs:build`        | `vitepress build docs`                                                       | 构建静态文档站到 `docs/.vitepress/dist`（含死链检查）                                  |
| `pnpm docs:preview`      | `vitepress preview docs`                                                     | 本地预览 `docs:build` 的产物                                                           |
| `pnpm prepare`           | `husky`                                                                      | 安装 git hooks（`prepare` 后自动执行）                                                 |

## 新建业务

```bash
pnpm create:app order            # 从 apps/member 复制骨架到 apps/order
pnpm create:app order --dry-run  # 只看文件计划与文案替换，不写文件
```

脚手架会复制骨架（排除 `node_modules`、`dist`、`coverage`、`.turbo`、`*.tsbuildinfo`），并把包名改成 `@h5/app-order`、vite `appId` 改成 `order`、`index.html` 的 `<title>` 改成占位名。

生成后还要做 5 件事：

1. **路由**：在 `apps/order/src/router/index.ts` 里加页面，页面文件放 `src/views/`。
2. **base 路径**：在部署配置里登记 `base` 路径 `/order/`，并配 `try_files $uri /order/index.html`（见 [docs/deployment.md](docs/deployment.md)）。
3. **入口 URL**：由客户端在 App 里配置 `https://h5.xxx.com/order/`（test/pre 域名不同）。
4. **依赖边界**：`apps/*` 只能依赖 `packages/*`，禁止 app 之间互相 import（ESLint 已拦截）。
5. **`pnpm install`**：让 pnpm 链接新的 workspace 包，然后 `pnpm dev` 开发。

其他参数：`--from <app>` 换骨架来源；目标目录已存在时必须 `--force --overwrite` 才会覆盖（写入失败只回滚本次写入，绝不删除原有目录），`--help` 看帮助。

## 发布与回滚

`pnpm run deploy --app <app>` 默认 dry-run：解析版本与 commit、校验产物、打印缓存头策略和发布/回滚 5 步，只有 `--execute --yes` 且配置了 `UPLOAD_CMD` 才真的上传。完整流程（URL 规划、灰度、回滚、旧资源保留 30 天）见 **[docs/deployment.md](docs/deployment.md)**。

## 环境变量

全部来自 `.env.example`，复制成 `.env.local` 后按需修改（`.env*` 不进仓库，`.env.example` 除外）：

| 变量                | 说明                                                                                                                           |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `VITE_APP_ENV`      | 环境标识：`dev` / `test` / `pre` / `prod`。只影响前端行为分支（vConsole、日志级别、mock 开关），不改变构建产物结构             |
| `VITE_API_BASE_URL` | 接口域名，只在本地 dev 生效：vite 以此为 `/api` 的代理目标，规避跨域。test/pre/prod 由 Nginx 与 App WebView 直接回源，通常留空 |
| `VITE_CDN_BASE`     | 静态资源域名，构建时作为 vite `base`，例如 `https://cdn.xxx.com/h5/member/0.1.0/`；留空则用根路径 `/`                          |
| `VITE_APP_ID`       | 应用 ID，构建时注入为 `__APP_ID__`，用于监控 / 埋点 / 日志区分业务；留空回落到 `vite.config.ts` 里的 `appId`                   |
| `ANALYZE`           | 设为 `1` 或 `true` 时构建额外产出 `dist/stats.html`（包体积分析），默认关闭                                                    |

## 质量门禁

本地与 CI 必须全绿：

```bash
pnpm typecheck && pnpm lint && pnpm lint:style && pnpm test && pnpm build && pnpm size:check && pnpm docs:build
```

CI 在 `.github/workflows/ci.yml`，顺序为 Install（`--frozen-lockfile`）→ Typecheck → Lint → Lint styles → Test → Build → Docs build。PR 还要求：共享包单测覆盖率 ≥ 80%、修改 `packages/*` 需平台负责人审批（见 [docs/development.md](docs/development.md)）。

## 文档索引

| 文档                                               | 内容                                                                       |
| -------------------------------------------------- | -------------------------------------------------------------------------- |
| [docs/bridge-protocol.md](docs/bridge-protocol.md) | JSBridge 协议：方法、参数、错误码、最低 App 版本、双端负责人               |
| [docs/development.md](docs/development.md)         | 本地开发与真机联调、代码规范、提交规范、与客户端/后端的协作流程            |
| [docs/deployment.md](docs/deployment.md)           | URL 与目录规划、缓存头、灰度与回滚、共享包发布约束、`deploy.ts` 用法       |
| [docs/index.md](docs/index.md)                     | 文档站首页：定位、四条硬约束、工程结构、常用命令。`pnpm docs:dev` 本地预览 |

## 常见问题

**不在 App 里怎么开发？**
直接 `pnpm dev`，浏览器打开 `http://localhost:5173`。此时 `env.isApp === false`，`@h5/bridge` 把调用路由到 mock 层（token 来自 mock 会话、`nav.*` 转普通路由跳转、`ui.toast` 走 `console.info`，由 core 注入），业务代码不需要任何改动。

**怎么打开 vConsole？**
test 环境默认注入；pre 环境在 URL 上加 `?debug=1` 注入；prod 不打包 vConsole。详见 [docs/deployment.md](docs/deployment.md) 的四环境对照表。

**真机怎么调试？**
Android 用 Chrome `chrome://inspect`，iOS 用 Safari「开发」菜单；连不上电脑时用 vConsole，接口问题用 Charles / Whistle 抓包。每项的**前提条件**（如测试包要开启 `setWebContentsDebuggingEnabled` / `isInspectable`）见 [docs/development.md](docs/development.md)。

**新增 Bridge 方法要改哪些地方？**
提需求 → 评审 `docs/bridge-protocol.md` → 客户端在测试包实现 → 前端在 `@h5/bridge` 接入并补 mock → 标注最低 App 版本。checklist 见 [docs/development.md](docs/development.md)。

**为什么资源要放在版本目录里？**
旧版本资源保留至少 30 天，已经打开的页面懒加载 chunk 时才不会 404；回滚只需要切 `index.html`，不用重新构建。
