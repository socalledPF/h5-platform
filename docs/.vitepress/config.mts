import { defineConfig } from 'vitepress'

// 文档站部署在子路径（例如 https://cdn.example.com/h5-docs/）时，
// 构建前用 DOCS_BASE=/h5-docs/ 覆盖；默认部署在域名根路径。
const base = process.env.DOCS_BASE ?? '/'

export default defineConfig({
  lang: 'zh-CN',
  title: 'Vue3 H5 架构与规范',
  description:
    'Vue3 H5（App WebView）项目文档：pnpm monorepo + 每个业务一个独立入口 + 共享平台层，含架构方案、Bridge 协议、发布手册与开发规范。',
  base,
  // 产物保持 `foo.html` 形态：静态托管（OSS / CDN / nginx）不做任何 rewrite 也能访问。
  // 部署目标确定后若要干净 URL，改成 true 即可。
  cleanUrls: false,
  lastUpdated: true,

  themeConfig: {
    nav: [
      { text: '指南', link: '/' },
      { text: '架构方案', link: '/architecture.html' },
      { text: 'Bridge 协议', link: '/bridge-protocol.html' },
      { text: '部署', link: '/deployment.html' },
      { text: '开发', link: '/development.html' },
    ],

    sidebar: [
      {
        text: '概览',
        items: [{ text: '文档首页', link: '/' }],
      },
      {
        text: '架构',
        items: [{ text: '架构设计方案', link: '/architecture.html' }],
      },
      {
        text: '规范与协作',
        items: [{ text: '开发手册', link: '/development.html' }],
      },
      {
        text: '客户端',
        items: [{ text: 'JSBridge 协议', link: '/bridge-protocol.html' }],
      },
      {
        text: '运维',
        items: [{ text: '发布手册', link: '/deployment.html' }],
      },
    ],

    // 架构方案的 13 个章节（含 §3 起无 §2 的原始编号）由本页右侧大纲自动生成，
    // 不在这里手写第二份目录。
    outline: { level: [2, 3], label: '本页目录' },
    lastUpdated: { text: '最后更新于' },
    docFooter: { prev: '上一篇', next: '下一篇' },
    darkModeSwitchLabel: '主题',
    returnToTopLabel: '回到顶部',
    sidebarMenuLabel: '文档目录',

    search: {
      provider: 'local',
      options: {
        translations: {
          button: { buttonText: '搜索文档', buttonAriaLabel: '搜索文档' },
          modal: {
            noResultsText: '没有找到结果',
            resetButtonTitle: '清空',
            backButtonTitle: '返回',
            footer: {
              selectText: '选择',
              navigateText: '切换',
              closeText: '关闭',
            },
          },
        },
      },
    },

    footer: {
      message: '每个业务独立构建、独立发布；WebView 能力收敛到共享包。',
      copyright: '内部文档，以仓库 docs/ 为准',
    },
  },
})
