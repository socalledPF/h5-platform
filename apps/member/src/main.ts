import { createH5App, setErrorNotifier } from '@h5/core'
import { toMonitorAdapter } from '@h5/monitor'
import { showToast } from 'vant'

import App from './App.vue'
import router from './router'

// 统一入口的全局样式：@h5/ui、@h5/hooks 都不注入 CSS，必须由 app 自己引入（设计文档 8.1）
import '@h5/styles'
// Vant 组件样式由 @vant/auto-import-resolver 按需注入；函数式组件（Toast/Dialog）不在模板里，
// 必须手动引入它们的样式入口，否则调用 showToast / showConfirmDialog 时没有样式。
import 'vant/es/toast/style'
import 'vant/es/dialog/style'

// core 不依赖任何 UI 包：由业务把统一错误提示注入进来（设计文档 6.3）
setErrorNotifier((message) => {
  showToast(message)
})

void createH5App(App, {
  appId: 'member',
  router,
  requireLogin: true,
  // 业务入口默认原生导航栏；不在 App 内时 core 按 7.1 规则 4 回退为 h5
  defaultNav: 'native',
  monitor: toMonitorAdapter({ dsn: import.meta.env.VITE_SENTRY_DSN as string | undefined }),
  // 浏览器 mock：原生 Toast 用 Vant 落地，其余 mock 行为沿用 core 的默认实现（设计文档 5.4）
  mock: {
    toast: (message) => {
      showToast(message)
    },
  },
}).then((app) => app.mount('#app'))
