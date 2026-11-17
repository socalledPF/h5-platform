<script setup lang="ts">
import { env, navigate } from '@h5/core'
import { usePageShow } from '@h5/hooks'
import { AppEmpty, AppNavBar, AppPage, AppSkeleton } from '@h5/ui'
import { computed } from 'vue'

import { DEMO_ORDERS } from '../api/demo-orders'
import { listOrders } from '../api/orders'
import type { OrderStatus, OrderSummary } from '../api/orders'
import { usePagedList } from '../composables/usePagedList'
import type { PagedResult } from '../composables/usePagedList'
import { useMemberStore } from '../stores/member'

const PAGE_SIZE = 8

const STATUS_TEXT: Record<OrderStatus, string> = {
  pending: '待付款',
  paid: '待发货',
  shipped: '待收货',
  closed: '已完成',
}

const STATUS_TAG: Record<OrderStatus, 'warning' | 'primary' | 'success' | 'default'> = {
  pending: 'warning',
  paid: 'primary',
  shipped: 'success',
  closed: 'default',
}

const member = useMemberStore()

function formatAmount(cents: number): string {
  return `¥${(cents / 100).toFixed(2)}`
}

/**
 * 取一页订单。浏览器里没有后端：用演示数据把列表、分页、空态的链路跑通；
 * 演示数据只有一页，非首页返回空列表，由分页逻辑判为 finished。
 */
async function fetchOrders(page: number, size: number): Promise<PagedResult<OrderSummary>> {
  try {
    return await listOrders({ page, size })
  } catch (error) {
    // App 内接口失败：往上抛，由分页逻辑保留已有数据并停止触底
    if (env.isApp) throw error
    return { total: DEMO_ORDERS.length, list: page === 1 ? [...DEMO_ORDERS] : [] }
  }
}

/**
 * 分页状态与请求全部由 usePagedList 持有：页面只负责渲染与转发，
 * 「什么时候取下一页 / 刷新怎么作废旧请求」在纯模块里可单测。
 */
const {
  items: orders,
  loading,
  finished,
  loadMore,
  refresh,
} = usePagedList<OrderSummary>({
  size: PAGE_SIZE,
  fetchPage: fetchOrders,
  onLoaded: (result) => {
    member.orderCount = result.total
  },
})

const initialLoading = computed(() => loading.value && orders.value.length === 0)

/**
 * van-list 触底。不能在这里判断 loading：van-list 的 check() 先置 loading=true
 * 再 emit('load')，任何 loading 守卫都会吞掉加载（缺陷 A1）。去重由 usePagedList 负责。
 */
function onLoad(): void {
  void loadMore()
}

/**
 * 页面重新可见时刷新（设计文档 7.5）：从原生页或另一个 WebView 返回时 Vue 生命周期不会重跑。
 * immediate 只在首次挂载时立即执行一次，不占用去重窗口。
 */
usePageShow(() => void refresh(), { immediate: true })

function openDetail(order: OrderSummary): void {
  void navigate(`/orders/${order.id}`)
}

function goHome(): void {
  void navigate('/')
}
</script>

<template>
  <AppPage>
    <AppNavBar title="我的订单" />

    <div class="order-list" data-testid="order-list">
      <AppSkeleton :loading="initialLoading" :rows="5">
        <van-list
          v-model:loading="loading"
          v-model:finished="finished"
          :immediate-check="false"
          finished-text="没有更多了"
          @load="onLoad"
        >
          <van-cell
            v-for="order in orders"
            :key="order.id"
            class="order-list__cell"
            :title="order.title"
            :label="`${order.id} · ${order.createdAt}`"
            is-link
            :data-testid="`order-item-${order.id}`"
            @click="openDetail(order)"
          >
            <template #value>
              <span class="order-list__amount">{{ formatAmount(order.amount) }}</span>
              <van-tag :type="STATUS_TAG[order.status]" plain>
                {{ STATUS_TEXT[order.status] }}
              </van-tag>
            </template>
          </van-cell>
        </van-list>
      </AppSkeleton>

      <AppEmpty v-if="!loading && orders.length === 0" description="还没有订单">
        <van-button type="primary" size="small" @click="goHome">去逛逛</van-button>
      </AppEmpty>
    </div>
  </AppPage>
</template>

<style scoped>
.order-list {
  padding-bottom: var(--space-xl);
}

.order-list__amount {
  margin-right: var(--space-sm);
  color: var(--color-danger);
  font-size: var(--font-size-md);
  font-weight: 600;
}
</style>
