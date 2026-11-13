import { createRouter, createWebHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'

/**
 * 路由表（设计文档 7.1 / 7.2）：
 * - `meta.title` 由 @h5/core 在 afterEach 里同步到 document.title 与原生导航栏；
 * - `meta.nav` 覆盖应用默认导航模式，订单列表固定用 H5 自绘导航栏以验证 h5 分支。
 */
const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'member-home',
    component: () => import('../views/Home.vue'),
    meta: { title: '会员中心' },
  },
  {
    path: '/orders',
    name: 'member-orders',
    component: () => import('../views/OrderList.vue'),
    meta: { title: '我的订单', nav: 'h5' },
  },
  {
    path: '/orders/:id',
    name: 'member-order-detail',
    component: () => import('../views/OrderDetail.vue'),
    meta: { title: '订单详情' },
  },
  { path: '/:pathMatch(.*)*', redirect: '/' },
]

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
})

export default router
