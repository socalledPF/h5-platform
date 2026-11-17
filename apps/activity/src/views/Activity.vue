<script setup lang="ts">
import { goBack, navigate } from '@h5/core'
import { useKeyboard, useNavMode } from '@h5/hooks'
import { AppNavBar, AppPage } from '@h5/ui'
import { showToast } from 'vant'
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'

import { useCountdown } from '../composables/useCountdown'

const route = useRoute()
const { mode } = useNavMode()

/**
 * 软键盘状态（设计文档 8.3）：本页有底部固定 CTA，Android 键盘弹起时它会被顶起来，
 * 所以键盘期间把它藏下去，由 .activity__spacer 保留占位，不产生跳动。
 */
const { visible: keyboardVisible } = useKeyboard()

/** URL 参数驱动（设计文档 7.4）：打开方决定活动 id、标题与结束时间。 */
const query = computed(() => ({
  id: readQuery('id') ?? 'A2026',
  title: readQuery('title') ?? '春日会员日',
  endAt: readQuery('endAt'),
}))

function readQuery(key: string): string | undefined {
  const raw = route.query[key]
  const value = Array.isArray(raw) ? raw[0] : raw
  return typeof value === 'string' && value !== '' ? value : undefined
}

// 结束时间在进入页面时确定：活动页的 URL 参数不会中途变化
const {
  parts: countdownParts,
  ended: countdownEnded,
  invalid: countdownInvalid,
} = useCountdown(query.value.endAt)

const countdownHint = computed(() => {
  if (countdownInvalid.value) return '结束时间无法解析，倒计时不可用'
  return countdownEnded.value ? '活动已结束，感谢参与' : '距离活动结束'
})

/** 邀请码选填：填了就随「立即参与」交给原生页面，不填不影响参与。 */
const inviteCode = ref('')

const modeLabel = computed(() => (mode.value === 'none' ? '沉浸式 nav=none' : `nav=${mode.value}`))

const rules = [
  '活动期间完成任意一笔订单，即可获得双倍积分',
  '积分在订单完成后 24 小时内到账，可在会员中心查看',
  '每个账号每天限参与 1 次，退款订单不计入',
]

/** 返回：栈深度为 1 时 core 会关闭 WebView（设计文档 7.3）。 */
function back(): void {
  goBack()
}

/** 打开原生页面（设计文档 7.4）：由原生路由处理，业务不拼 scheme 之外的逻辑。 */
function join(): void {
  const invite = inviteCode.value.trim()
  const suffix = invite === '' ? '' : `&invite=${encodeURIComponent(invite)}`
  void navigate({
    route: `native://order/confirm?activity=${encodeURIComponent(query.value.id)}${suffix}`,
  })
  showToast('已请求原生打开确认页')
}
</script>

<template>
  <AppPage :nav-mode="mode" :padded="mode !== 'none'">
    <!-- 非沉浸式（?nav=native / ?nav=h5）交给统一的导航栏，页面不再自绘头部 -->
    <AppNavBar v-if="mode !== 'none'" :mode="mode" :title="query.title" />

    <!-- 沉浸式页面自绘头部：自己吃状态栏安全区（设计文档 7.1 / 8.2） -->
    <header v-if="mode === 'none'" class="activity__bar" data-testid="activity-header">
      <button class="activity__back" type="button" aria-label="返回" @click="back">
        <span class="activity__back-icon" aria-hidden="true" />
      </button>
      <span class="activity__bar-title">{{ query.title }}</span>
      <span class="activity__bar-mode" data-testid="activity-nav-mode">{{ modeLabel }}</span>
    </header>

    <section class="activity__hero">
      <p class="activity__eyebrow" data-testid="activity-id">活动编号 {{ query.id }}</p>
      <h1 class="activity__title" data-testid="activity-title">{{ query.title }}</h1>

      <div
        v-if="countdownInvalid"
        class="activity__invalid"
        data-testid="activity-countdown-invalid"
      >
        时间无效
      </div>
      <div v-else class="activity__countdown" data-testid="activity-countdown">
        <div v-for="part in countdownParts" :key="part.label" class="activity__unit">
          <span class="activity__value">{{ part.value }}</span>
          <span class="activity__label">{{ part.label }}</span>
        </div>
      </div>

      <p class="activity__hint" data-testid="activity-hint">{{ countdownHint }}</p>
    </section>

    <section class="activity__rules">
      <h2 class="activity__rules-title">活动规则</h2>
      <ul>
        <li v-for="rule in rules" :key="rule" class="activity__rule">{{ rule }}</li>
      </ul>
      <p class="activity__note">
        本页通过路由 meta / URL 参数声明 nav=none，用于验证全屏沉浸式页面：原生不显示导航栏，
        页面自己处理顶部安全区与底部固定按钮。
      </p>
    </section>

    <!-- 真实输入框：聚焦后键盘弹起，用于验证 8.3 的「键盘期间隐藏底部固定栏」 -->
    <section class="activity__form">
      <van-field
        v-model="inviteCode"
        label="邀请码"
        placeholder="选填，填写后随参与一起提交"
        maxlength="20"
        clearable
        data-testid="activity-invite"
      />
    </section>

    <!-- 固定 CTA 的占位：CTA 高度 + 底部安全区，保证最后一条规则不被遮挡 -->
    <div class="activity__spacer" aria-hidden="true"></div>

    <!-- 底部固定 CTA：把内容垫到 home indicator 之上（设计文档 8.2） -->
    <footer
      class="activity__cta"
      :class="{ 'activity__cta--hidden': keyboardVisible }"
      :aria-hidden="keyboardVisible"
      data-testid="activity-cta"
    >
      <van-button type="danger" block round data-testid="activity-join" @click="join">
        立即参与
      </van-button>
    </footer>
  </AppPage>
</template>

<style scoped>
.activity__bar {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  height: calc(var(--nav-height) + var(--safe-top));
  padding-top: var(--safe-top);
  padding-right: var(--space-md);
  padding-left: var(--space-md);
  color: var(--color-bg);
  background-color: var(--color-primary);
}

.activity__back {
  display: flex;
  align-items: center;
  width: var(--nav-height);
  height: var(--nav-height);
  margin-left: calc(var(--space-md) * -1);
  padding: 0;
  border: 0;
  color: inherit;
  background: none;
}

.activity__back-icon {
  width: 10px;
  height: 10px;
  border-bottom: 2px solid currentColor;
  border-left: 2px solid currentColor;
  transform: rotate(45deg);
}

.activity__bar-title {
  flex: 1 1 auto;
  overflow: hidden;
  font-size: var(--font-size-lg);
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.activity__bar-mode {
  flex: 0 0 auto;
  font-size: var(--font-size-xs);
  opacity: 0.85;
}

.activity__hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: var(--space-xl) var(--space-lg) var(--space-xl);
  color: var(--color-bg);
  background-color: var(--color-primary);
  border-bottom-right-radius: var(--radius-lg);
  border-bottom-left-radius: var(--radius-lg);
}

.activity__eyebrow {
  font-size: var(--font-size-sm);
  opacity: 0.85;
}

.activity__title {
  margin-top: var(--space-xs);
  font-size: var(--font-size-xl);
  font-weight: 600;
}

.activity__countdown {
  display: flex;
  gap: var(--space-sm);
  margin-top: var(--space-lg);
}

.activity__unit {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 44px;
  padding: var(--space-xs) 0;
  background-color: rgb(255 255 255 / 18%);
  border-radius: var(--radius-md);
}

.activity__value {
  font-size: var(--font-size-xl);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.activity__label {
  font-size: var(--font-size-xs);
  opacity: 0.85;
}

.activity__hint {
  margin-top: var(--space-md);
  font-size: var(--font-size-sm);
  opacity: 0.85;
}

.activity__rules {
  padding: var(--space-lg);
  margin: var(--space-lg) var(--space-md) 0;
  background-color: var(--color-bg);
  border-radius: var(--radius-lg);
}

.activity__rules-title {
  margin-bottom: var(--space-md);
  color: var(--color-text);
  font-size: var(--font-size-lg);
  font-weight: 600;
}

.activity__rule {
  padding-left: var(--space-md);
  margin-bottom: var(--space-sm);
  color: var(--color-text-secondary);
  font-size: var(--font-size-md);
  line-height: 1.6;
  list-style: disc;
}

.activity__note {
  margin-top: var(--space-md);
  color: var(--color-text-placeholder);
  font-size: var(--font-size-xs);
  line-height: 1.6;
}

.activity__form {
  margin: var(--space-lg) var(--space-md) 0;
  overflow: hidden;
  background-color: var(--color-bg);
  border-radius: var(--radius-lg);
}

.activity__invalid {
  margin-top: var(--space-lg);
  padding: var(--space-xs) var(--space-md);
  font-size: var(--font-size-md);
  font-weight: 600;
  background-color: rgb(255 255 255 / 18%);
  border-radius: var(--radius-md);
}

.activity__spacer {
  height: calc(var(--safe-bottom) + 76px);
}

.activity__cta {
  position: fixed;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: var(--z-nav);
  box-sizing: border-box;
  max-width: var(--app-max-width, 600px);
  margin: 0 auto;
  padding: var(--space-md) var(--space-lg) calc(var(--space-md) + var(--safe-bottom));
  background-color: var(--color-bg);
  transition:
    transform 0.2s ease,
    opacity 0.2s ease;
}

/* 键盘弹起期间藏起底部固定栏（设计文档 8.3）：只位移 + 透明，占位仍由 .activity__spacer 保留 */
.activity__cta--hidden {
  pointer-events: none;
  opacity: 0;
  transform: translateY(100%);
}
</style>
