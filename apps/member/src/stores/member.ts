import { env, useAuthStore } from '@h5/core'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { DEMO_ORDERS } from '../api/demo-orders'
import { listOrders } from '../api/orders'

/**
 * 会员业务 store：用户概要 + 订单数量。
 *
 * 登录态本身不在这里复制一份——`useAuthStore` 的 token 只存内存且由 core 维护（设计文档 6.1），
 * 业务只读取它派生展示状态，避免出现两份可能不一致的登录态。
 */
export const useMemberStore = defineStore('member', () => {
  const auth = useAuthStore()

  const nickname = ref('张小满')
  const level = ref(2)
  const points = ref(1280)
  const orderCount = ref(0)
  const orderCountLoaded = ref(false)

  const loggedIn = computed(() => auth.token !== null)
  const levelName = computed(() => {
    if (level.value >= 3) return '黑金会员'
    if (level.value === 2) return '金卡会员'
    return '普通会员'
  })

  /**
   * 拉取订单总数。
   *
   * 绝不把接口返回值直接写进状态：只接受有限数字。接口可能返回非 JSON
   * （本地没有后端时 Vite 直接回 index.html，400/200 都可能），core 对非信封结构原样放行，
   * 一旦把 `undefined` 写成订单数，页面就会显示「undefined 笔」这种假数据。
   */
  async function refreshOrderCount(): Promise<number> {
    try {
      // 会员中心首屏渲染的就是这个总数：显式声明 firstScreen，core 才会计入首屏接口阶段
      const result = await listOrders({ page: 1, size: 1 }, { firstScreen: true })
      if (Number.isFinite(result.total)) {
        orderCount.value = result.total
        orderCountLoaded.value = true
        return orderCount.value
      }
    } catch {
      // 网络失败 / 401 / 结构异常：统一走下面的降级，不在这里区分
    }
    applyFallbackOrderCount()
    return orderCount.value
  }

  /** 拿不到真实数量时的统一降级：浏览器用演示数据条数，App 内保留旧值并让 UI 停在「加载中」。 */
  function applyFallbackOrderCount(): void {
    if (env.isApp) return
    orderCount.value = DEMO_ORDERS.length
    orderCountLoaded.value = true
  }

  return {
    nickname,
    level,
    points,
    levelName,
    orderCount,
    orderCountLoaded,
    loggedIn,
    refreshOrderCount,
  }
})
