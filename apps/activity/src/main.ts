import { createH5App, setErrorNotifier } from '@h5/core'
import { toMonitorAdapter } from '@h5/monitor'
import { showToast } from 'vant'

import App from './App.vue'
import router from './router'

// 全局样式只能由 app 自己引入：@h5/ui、@h5/hooks 都不注入 CSS（设计文档 8.1）
import '@h5/styles'
// 函数式组件（Toast）不在模板里，样式必须手动引入
import 'vant/es/toast/style'

setErrorNotifier((message) => {
  showToast(message)
})

void createH5App(App, {
  appId: 'activity',
  router,
  // 活动页不强制登录：未登录也要能看活动（需要登录的动作在点击时再唤起）
  requireLogin: false,
  // 沉浸式：默认就没有导航栏，页面自绘头部并处理安全区（设计文档 7.1 / 8.2）
  defaultNav: 'none',
  monitor: toMonitorAdapter(),
  mock: {
    toast: (message) => {
      showToast(message)
    },
  },
}).then((app) => app.mount('#app'))
