---
layout: home

hero:
  name: Vue3 H5
  text: App WebView 工程文档
  tagline: pnpm monorepo + 每个业务一个独立 Vite 应用 + 共享平台层；业务代码不直接接触原生。
  actions:
    - theme: brand
      text: 架构设计方案
      link: /architecture.html
    - theme: alt
      text: 开发手册
      link: /development.html

features:
  - title: 线上加载（CDN）
    details: 不做离线包，缓存策略与发布回滚是重点；路由可以用 history 模式。
  - title: 每个业务独立入口
    details: 业务独立构建、独立发布、独立回滚；共享代码抽成包并做版本管理。
  - title: 双模式导航栏
    details: 原生导航栏与 H5 导航栏都可能出现，用一套由 URL 参数驱动的方案覆盖。
  - title: App 注入登录态
    details: H5 不做登录页；token 的获取与刷新统一走 JSBridge，浏览器下自动降级。
---

## 快速链接

| 文档                                  | 内容                                                                                               |
| ------------------------------------- | -------------------------------------------------------------------------------------------------- |
| [架构设计方案](./architecture.md)     | 原始设计文档：技术选型、工程结构、JSBridge、登录态、导航栏、适配、构建部署、性能、监控、规范、风险 |
| [开发手册](./development.md)          | 本地开发与真机联调、代码边界、提交规范、和客户端 / 后端的协作流程                                  |
| [JSBridge 协议](./bridge-protocol.md) | 协议唯一来源：方法、参数、错误码、最低 App 版本、双端负责人                                        |
| [发布手册](./deployment.md)           | URL 与目录规划、缓存头、灰度与回滚、共享包发布约束、`deploy.ts` 用法                               |

## 工程结构

```text
h5-platform/
├── apps/                  # 每个业务一个应用 = 一个独立入口 URL
│   ├── member/            # 会员中心，也是 pnpm create:app 的默认骨架
│   ├── activity/          # 活动页
│   └── bridge-playground/ # Bridge 调试页，客户端自测与回归用
├── packages/              # 平台层，业务只从这里取能力
│   ├── bridge/            # JSBridge：协议、Promise 封装、事件、浏览器 mock
│   ├── core/              # env、auth、request、navigation、storage、createH5App
│   ├── ui/                # NavBar、Page、Empty、Skeleton 等通用组件
│   ├── hooks/             # usePageShow、useKeyboard、useSafeArea 等
│   ├── monitor/           # 错误 / 性能 / 埋点上报
│   ├── styles/            # 主题变量、safe-area、1px 细线、reset
│   └── config/            # vite / tsconfig / eslint / postcss 共享配置
├── docs/                  # 本文档站（VitePress）
└── scripts/               # create-app.ts、deploy.ts
```

依赖方向是单向的：`apps → (ui | hooks | monitor) → core → bridge`，`bridge` 是最底层且是唯一允许访问 `window.webkit` / `window.H5Bridge` 的地方。

## 常用命令

```bash
pnpm dev                 # 启动所有应用的 dev server（member 在 http://localhost:5173）
pnpm build               # 构建所有应用到 apps/*/dist
pnpm test                # 仓库级单测 + 各包/应用的测试
pnpm create:app <name>   # 从 apps/member 复制骨架新建业务应用
pnpm deploy --app <name> # 发布到 CDN（默认 dry-run）
pnpm docs:dev            # 本地预览本文档站
```

提交前跑一遍：`pnpm typecheck && pnpm lint && pnpm lint:style && pnpm test && pnpm build`。
