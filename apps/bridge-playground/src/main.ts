import { createH5App, setErrorNotifier } from '@h5/core'
import { toMonitorAdapter } from '@h5/monitor'
import { showToast } from 'vant'

import App from './App.vue'
import router from './router'

// 全局样式只能由 app 自己引入（设计文档 8.1）
import '@h5/styles'
// 函数式组件（Toast）样式需要手动引入
import 'vant/es/toast/style'

setErrorNotifier((message) => {
  showToast(message)
})

void createH5App(App, {
  appId: 'bridge-playground',
  router,
  // 调试页不强制登录：token 相关方法由页面显式调用，失败信息本身就是调试结果
  requireLogin: false,
  // 调试页始终用 H5 自绘导航栏：在 App 内也能看到标题与当前环境，便于截图反馈
  defaultNav: 'h5',
  monitor: toMonitorAdapter({ dsn: import.meta.env.VITE_SENTRY_DSN as string | undefined }),
  mock: {
    toast: (message) => {
      showToast(message)
    },
  },
}).then((app) => app.mount('#app'))
