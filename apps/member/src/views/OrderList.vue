<script setup lang="ts">
import { env, navigate } from '@h5/core'
import { usePageShow } from '@h5/hooks'
import { AppEmpty, AppNavBar, AppPage, AppSkeleton } from '@h5/ui'
import { computed, ref } from 'vue'

import { DEMO_ORDERS } from '../api/demo-orders'
import { listOrders } from '../api/orders'
import type { OrderStatus, OrderSummary } from '../api/orders'
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
const orders = ref<OrderSummary[]>([])
const loading = ref(false)
const finished = ref(false)
const page = ref(1)

const initialLoading = computed(() => loading.value && orders.value.length === 0)

function formatAmount(cents: number): string {
  return `¥${(cents / 100).toFixed(2)}`
}

async function loadPage(): Promise<void> {
  if (loading.value) return
  loading.value = true
  try {
    const result = await listOrders({ page: page.value, size: PAGE_SIZE })
    orders.value = [...orders.value, ...result.list]
    member.orderCount = result.total
    finished.value = orders.value.length >= result.total
  } catch {
    if (env.isApp) {
      // App 内接口失败：保留已有数据，空列表交给下面的空态
      finished.value = true
      return
    }
    // 浏览器里没有后端：用演示数据把列表、分页、空态的链路跑通
    // 演示数据只有一页，非首页不再追加，避免触底后重复渲染同样的行
    if (page.value === 1) orders.value = [...DEMO_ORDERS]
    member.orderCount = DEMO_ORDERS.length
    finished.value = true
  } finally {
    loading.value = false
  }
}

/** van-list 触底：先推进页码再取下一页。 */
function onLoad(): void {
  if (loading.value) return
  page.value += 1
  void loadPage()
}

/**
 * 页面重新可见时刷新（设计文档 7.5）：从原生页或另一个 WebView 返回时 Vue 生命周期不会重跑。
 * immediate 只在首次挂载时立即执行一次，不占用去重窗口。
 */
async function refresh(): Promise<void> {
  page.value = 1
  orders.value = []
  finished.value = false
  await loadPage()
}

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
