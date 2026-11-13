<script setup lang="ts">
import type { NavBarButton } from '@h5/bridge'
import { env, goBack } from '@h5/core'
import { useBackGuard } from '@h5/hooks'
import { AppNavBar, AppPage, AppSkeleton } from '@h5/ui'
import { showConfirmDialog, showSuccessToast, showToast } from 'vant'
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'

import { demoOrderDetail } from '../api/demo-orders'
import { getOrderDetail, saveOrderRemark } from '../api/orders'
import type { OrderDetail } from '../api/orders'

const route = useRoute()
const orderId = computed(() => String(route.params.id ?? ''))

const order = ref<OrderDetail | null>(null)
const loading = ref(true)
const saving = ref(false)
const remark = ref('')
const savedRemark = ref('')

/** 备注有未保存的修改（设计文档 7.3.4 的拦截条件）。 */
const dirty = computed(() => remark.value !== savedRemark.value)

async function load(): Promise<void> {
  loading.value = true
  try {
    order.value = await getOrderDetail(orderId.value)
  } catch {
    if (env.isApp) showToast('订单详情加载失败')
    else order.value = demoOrderDetail(orderId.value)
  } finally {
    if (order.value !== null) {
      remark.value = order.value.remark
      savedRemark.value = order.value.remark
    }
    loading.value = false
  }
}

/** 是否允许离开：true 表示继续默认返回，false 表示消费本次返回。 */
async function canLeave(): Promise<boolean> {
  if (!dirty.value) return true
  try {
    await showConfirmDialog({
      title: '放弃未保存的备注？',
      message: '备注还没有提交，离开后修改会丢失。',
      confirmButtonText: '放弃',
      cancelButtonText: '继续编辑',
    })
    return true
  } catch {
    return false
  }
}

// 原生导航返回 / Android 物理返回键：core 先询问拦截器（设计文档 7.3.3 / 7.3.4）
useBackGuard(async () => !(await canLeave()))

/**
 * H5 模式下的返回按钮与原生返回走同一条 core 链路（goBack → 拦截器，设计文档 7.3.4），
 * 页面不再自己包一层确认，否则同一个返回请求会弹两次确认框。
 */
function leaveWithGuard(): void {
  goBack()
}

async function submit(): Promise<void> {
  if (saving.value) return
  saving.value = true
  try {
    await saveOrderRemark(orderId.value, remark.value)
    savedRemark.value = remark.value
    showSuccessToast('备注已保存')
  } catch {
    if (env.isApp) {
      showToast('保存失败，请稍后重试')
      return
    }
    // 浏览器里没有后端：本地置为已保存，让整条交互链路可完整走通
    savedRemark.value = remark.value
    showSuccessToast('已保存（浏览器演示，未发出请求）')
  } finally {
    saving.value = false
  }
}

function onRightClick(button: NavBarButton): void {
  showToast(`右侧按钮被点击：${button.id} / ${button.text}`)
}

onMounted(() => {
  void load()
})
</script>

<template>
  <AppPage>
    <AppNavBar
      title="订单详情"
      :right="[{ id: 'help', text: '帮助' }]"
      @right-click="onRightClick"
    />

    <div class="detail" data-testid="order-detail">
      <AppSkeleton :loading="loading" :rows="4">
        <template v-if="order !== null">
          <van-cell-group inset>
            <van-cell title="订单号" :value="order.id" />
            <van-cell title="商品" :value="order.title" />
            <van-cell title="收货人" :value="order.receiver" />
            <van-cell title="电话" :value="order.phone" />
            <van-cell title="地址" :label="order.address" />
          </van-cell-group>

          <van-cell-group inset class="detail__remark">
            <van-field
              v-model="remark"
              label="备注"
              type="textarea"
              rows="3"
              maxlength="50"
              show-word-limit
              placeholder="给商家留言（修改后需要提交）"
              data-testid="order-remark"
            />
          </van-cell-group>

          <p v-if="dirty" class="detail__dirty" data-testid="order-remark-dirty">
            备注未保存，返回时会提示确认
          </p>

          <div class="detail__actions">
            <van-button
              type="primary"
              block
              :loading="saving"
              data-testid="order-remark-submit"
              @click="submit"
            >
              提交备注
            </van-button>
            <van-button plain block data-testid="order-leave-guarded" @click="leaveWithGuard">
              返回（受 useBackGuard 保护）
            </van-button>
          </div>
        </template>
      </AppSkeleton>
    </div>
  </AppPage>
</template>

<style scoped>
.detail {
  padding: var(--space-lg) 0 var(--space-xl);
}

.detail__remark {
  margin-top: var(--space-lg);
}

.detail__dirty {
  padding: var(--space-sm) var(--space-lg) 0;
  color: var(--color-danger);
  font-size: var(--font-size-sm);
}

.detail__actions {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
  padding: var(--space-lg) var(--space-md) 0;
}
</style>
