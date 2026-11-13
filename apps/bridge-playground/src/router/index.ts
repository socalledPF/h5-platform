import { createRouter, createWebHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'

/** 单页调试工具（设计文档 12.2）：一个入口，一页列出全部 Bridge 方法。 */
const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'bridge-playground-home',
    component: () => import('../views/Playground.vue'),
    meta: { title: 'Bridge 调试' },
  },
  { path: '/:pathMatch(.*)*', redirect: '/' },
]

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
})

export default router
