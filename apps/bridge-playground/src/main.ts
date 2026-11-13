import { createApp } from 'vue'

import App from './App.vue'
import router from './router'

// 骨架占位：Task B 落地 @h5/core 的 createH5App() 后改为统一入口。
createApp(App).use(router).mount('#app')
