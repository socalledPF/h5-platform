<script setup lang="ts">
import { env, markFirstScreen, navigate } from '@h5/core'
import { AppNavBar, AppPage } from '@h5/ui'
import { showToast } from 'vant'
import { onMounted } from 'vue'

import { useMemberStore } from '../stores/member'

const member = useMemberStore()

const appId = __APP_ID__ ?? ''
const buildTime = __BUILD_TIME__ ?? ''

/**
 * 跨业务入口（设计文档 7.4）：交给 `navigate()` 判断是否为「新开 WebView」，
 * 业务不写 `window.location`。活动页是沉浸式页面，由打开方带上 `nav=none`。
 */
function openActivity(): void {
  const url = `${new URL('activity/', location.origin).toString()}?from=member&nav=none`
  void navigate({ url, nav: 'none' })
  if (!env.isApp) showToast('浏览器 mock：已通过 navigate() 请求新开 WebView（结果见控制台）')
}

/** 站内跳转同样走 `navigate()`，内部是 router.push，无需新建 WebView。 */
function openOrders(): void {
  void navigate('/orders')
}

onMounted(async () => {
  await member.refreshOrderCount()
  // 首屏数据渲染完成后再标记，供监控算「点击到首屏可见」（设计文档 10.1）
  markFirstScreen()
})
</script>

<template>
  <AppPage>
    <AppNavBar title="会员中心" :show-back="false" />

    <div class="home" data-testid="member-home">
      <section class="home__profile">
        <div class="home__identity">
          <p class="home__nickname">{{ member.nickname }}</p>
          <van-tag type="warning" round data-testid="member-level">{{ member.levelName }}</van-tag>
        </div>
        <p class="home__login" data-testid="member-login-state">
          {{ member.loggedIn ? '已登录（token 仅存内存，由 Bridge 提供）' : '未登录' }}
        </p>
      </section>

      <van-cell-group inset>
        <van-cell title="会员积分" :value="`${member.points}`" />
        <van-cell
          title="我的订单"
          :value="member.orderCountLoaded ? `${member.orderCount} 笔` : '加载中'"
          is-link
          data-testid="home-order-count"
          @click="openOrders"
        />
        <van-cell title="本月成长值" value="+320" />
      </van-cell-group>

      <div class="home__actions">
        <van-button type="primary" block data-testid="home-open-orders" @click="openOrders">
          查看订单列表（站内 navigate）
        </van-button>
        <van-button
          plain
          type="primary"
          block
          data-testid="home-open-activity"
          @click="openActivity"
        >
          打开活动页（跨业务新开 WebView）
        </van-button>
      </div>

      <p class="home__meta">app: {{ appId }} · build: {{ buildTime }}</p>
    </div>
  </AppPage>
</template>

<style scoped>
.home {
  padding: var(--space-lg) 0 var(--space-xl);
}

.home__profile {
  padding: var(--space-lg);
  margin: 0 var(--space-md) var(--space-lg);
  background-color: var(--color-bg);
  border-radius: var(--radius-lg);
}

.home__identity {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
}

.home__nickname {
  color: var(--color-text);
  font-size: var(--font-size-xl);
  font-weight: 600;
}

.home__login {
  margin-top: var(--space-xs);
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
}

.home__actions {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
  padding: var(--space-lg) var(--space-md) 0;
}

.home__meta {
  padding: var(--space-lg) var(--space-md) 0;
  color: var(--color-text-placeholder);
  font-size: var(--font-size-xs);
  word-break: break-all;
}
</style>
