<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { nav as bridgeNav, on as onBridgeEvent } from '@h5/bridge'
import { goBack, navMode } from '@h5/core'
import type { NavBarButton } from '@h5/bridge'
import type { AppNavBarProps } from '../types'
import { safeInsetValue } from '../safe-area'

defineOptions({ name: 'AppNavBar' })

const props = withDefaults(defineProps<AppNavBarProps>(), {
  showBack: true,
  immersive: false,
})

const emit = defineEmits<{
  'right-click': [button: NavBarButton]
  back: []
}>()

/** 原生模式由 App 渲染导航栏，H5 模式自己画，none 模式两边都不画（设计文档 7.1）。 */
const resolvedMode = computed(() => props.mode ?? navMode.value)
const isH5 = computed(() => resolvedMode.value === 'h5')
const rightButtons = computed(() => props.right ?? [])

// setup 阶段就取一次：首帧就带上安全区，避免状态栏区域闪一下。
// 真值是根元素上的 --safe-top（core / styles 写的），组件只在变量缺失时回落到 px 兜底。
const safeTop = ref(props.immersive ? '0px' : safeInsetValue('top'))

/** 自己发布过哪些按钮，原生回调里只转发生效的那些。 */
const publishedIds = new Set<string>()
let unsubscribe: (() => void) | undefined

function ignoreBridgeFailure(): void {
  // 浏览器 / 原生未实现该方法时静默降级，不能让一次 setTitle 失败影响渲染
}

function refreshSafeTop(): void {
  safeTop.value = props.immersive ? '0px' : safeInsetValue('top')
}

function syncNativeBar(): void {
  publishedIds.clear()
  if (resolvedMode.value !== 'native') return

  const buttons = [...rightButtons.value]
  for (const button of buttons) publishedIds.add(button.id)

  void bridgeNav.setTitle(props.title ?? '').catch(ignoreBridgeFailure)
  void bridgeNav.setRightButtons(buttons).catch(ignoreBridgeFailure)
}

function handleBack(): void {
  goBack()
  emit('back')
}

function handleRightClick(button: NavBarButton): void {
  emit('right-click', button)
}

function handleNativeRightButtonClick(button: NavBarButton): void {
  if (!publishedIds.has(button.id)) return
  emit('right-click', button)
}

const rootClass = computed(() => (isH5.value ? 'app-nav-bar--h5' : 'app-nav-bar--empty'))

/**
 * 只表达「内容」的同步指纹。
 * 父组件按文档用法写 `:right="[{ ... }]"`，每次重渲染都是个新数组：深监听会让每次渲染
 * 都往原生桥跑一次 setTitle + setRightButtons，这里用内容指纹把相等的重渲染挡掉。
 */
const syncKey = computed(() =>
  JSON.stringify([
    props.title ?? '',
    resolvedMode.value,
    rightButtons.value.map((button) => [button.id, button.text, button.icon ?? '']),
  ]),
)

const rootStyle = computed<Record<string, string>>(() => {
  const style: Record<string, string> = { '--app-nav-safe-top': safeTop.value }
  if (props.backgroundColor !== undefined) style.backgroundColor = props.backgroundColor
  if (props.textColor !== undefined) style.color = props.textColor
  return style
})

watch(
  () => props.title,
  (title) => {
    // 兼顾浏览器场景和按 document.title 取标题的旧原生实现（设计文档 7.2）
    if (title !== undefined) document.title = title
  },
  { immediate: true },
)

watch(syncKey, () => {
  refreshSafeTop()
  syncNativeBar()
})

onMounted(() => {
  refreshSafeTop()
  syncNativeBar()
  unsubscribe = onBridgeEvent('nav.rightButtonClick', handleNativeRightButtonClick)
  window.addEventListener('resize', refreshSafeTop)
  window.addEventListener('orientationchange', refreshSafeTop)
})

onBeforeUnmount(() => {
  unsubscribe?.()
  unsubscribe = undefined
  publishedIds.clear()
  // 原生模式下本组件是原生栏的唯一发布者：卸载时不清空，从带右侧按钮的页面切到
  // 不带 AppNavBar 的页面，原生栏会留着旧标题和已经失效的按钮。
  if (resolvedMode.value === 'native') {
    void bridgeNav.setTitle('').catch(ignoreBridgeFailure)
    void bridgeNav.setRightButtons([]).catch(ignoreBridgeFailure)
  }
  window.removeEventListener('resize', refreshSafeTop)
  window.removeEventListener('orientationchange', refreshSafeTop)
})
</script>

<template>
  <div class="app-nav-bar" :class="rootClass" :style="rootStyle" data-testid="app-nav-bar">
    <template v-if="isH5">
      <div class="app-nav-bar__left">
        <button
          v-if="props.showBack"
          class="app-nav-bar__back"
          type="button"
          aria-label="返回"
          data-testid="app-nav-bar-back"
          @click="handleBack"
        >
          <span class="app-nav-bar__back-icon" aria-hidden="true" />
        </button>
      </div>

      <h1 class="app-nav-bar__title" data-testid="app-nav-bar-title">{{ props.title }}</h1>

      <div class="app-nav-bar__right">
        <button
          v-for="button in rightButtons"
          :key="button.id"
          class="app-nav-bar__action"
          type="button"
          :data-testid="`app-nav-bar-right-${button.id}`"
          @click="handleRightClick(button)"
        >
          {{ button.text }}
        </button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.app-nav-bar {
  box-sizing: border-box;
  color: var(--color-text);
  background-color: var(--color-bg);
}

/* 原生 / none 模式：不渲染任何内容，也不产生占位 */
.app-nav-bar--empty {
  display: none;
}

.app-nav-bar--h5 {
  position: fixed;
  top: 0;
  right: 0;
  left: 0;
  z-index: var(--z-nav);
  display: flex;
  align-items: center;
  max-width: var(--app-max-width, 600px);
  margin: 0 auto;
  height: calc(var(--nav-height) + var(--app-nav-safe-top, 0px));
  padding-top: var(--app-nav-safe-top, 0px);
  padding-right: var(--space-md);
  padding-left: var(--space-md);
}

/* 1px 细线：伪元素 + scaleY(0.5)（设计文档 8.1） */
.app-nav-bar--h5::after {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  height: 1px;
  background-color: var(--color-border);
  content: '';
  transform: scaleY(0.5);
  transform-origin: 0 100%;
  pointer-events: none;
}

.app-nav-bar__left,
.app-nav-bar__right {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  min-width: var(--nav-height);
}

.app-nav-bar__right {
  justify-content: flex-end;
  gap: var(--space-md);
}

.app-nav-bar__title {
  flex: 1 1 auto;
  margin: 0;
  overflow: hidden;
  font-size: var(--font-size-lg);
  font-weight: 600;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.app-nav-bar__back {
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

.app-nav-bar__back-icon {
  width: 10px;
  height: 10px;
  border-bottom: 2px solid currentColor;
  border-left: 2px solid currentColor;
  transform: rotate(45deg);
}

.app-nav-bar__action {
  padding: 0 var(--space-xs);
  border: 0;
  color: inherit;
  font-size: var(--font-size-md);
  background: none;
}
</style>
