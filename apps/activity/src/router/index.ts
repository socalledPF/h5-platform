import { createRouter, createWebHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'

/**
 * 单页沉浸式活动页（设计文档 7.1）：`meta.nav = 'none'` 让原生不渲染导航栏、
 * H5 也不渲染，页面自己负责顶部安全区与返回按钮。
 * 导航模式优先级：URL 参数 `?nav=` > `meta.nav` > 应用默认（'none'）> 浏览器兜底（h5）。
 */
const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'activity-home',
    component: () => import('../views/Activity.vue'),
    meta: { title: '活动详情', nav: 'none' },
  },
  { path: '/:pathMatch(.*)*', redirect: '/' },
]

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
})

export default router
