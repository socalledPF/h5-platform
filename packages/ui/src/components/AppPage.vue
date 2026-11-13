<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { navMode } from '@h5/core'
import type { AppPageProps } from '../types'
import { readSafeInset } from '../safe-area'

defineOptions({ name: 'AppPage' })

const props = withDefaults(defineProps<AppPageProps>(), {
  padded: true,
})

const resolvedMode = computed(() => props.navMode ?? navMode.value)

// setup 阶段就取一次：首帧就带上安全区，避免内容先跳到顶部再回落
const safeTop = ref(readSafeInset('top'))
const safeBottom = ref(readSafeInset('bottom'))

function measure(): void {
  safeTop.value = readSafeInset('top')
  safeBottom.value = readSafeInset('bottom')
}

/**
 * 顶部内边距：
 * - native：原生导航栏自己占位，H5 不再垫高
 * - h5：让开固定定位的 H5 导航栏（导航栏高度 + 状态栏安全区）
 * - none：沉浸式，页面自绘头部，只让开状态栏安全区
 */
const pageStyle = computed<Record<string, string>>(() => {
  const style: Record<string, string> = {}
  if (props.background !== undefined) style.backgroundColor = props.background
  if (!props.padded) return style

  if (resolvedMode.value === 'h5') {
    style.paddingTop = `calc(var(--nav-height) + ${safeTop.value}px)`
  } else if (resolvedMode.value === 'none') {
    style.paddingTop = `${safeTop.value}px`
  }
  style.paddingBottom = `${safeBottom.value}px`
  return style
})

onMounted(() => {
  measure()
  window.addEventListener('resize', measure)
  window.addEventListener('orientationchange', measure)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', measure)
  window.removeEventListener('orientationchange', measure)
})
</script>

<template>
  <div class="app-page" :style="pageStyle" data-testid="app-page">
    <div class="app-page__body">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.app-page {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  background-color: var(--color-bg-page);
}

/* 滚动放在内部容器，页面整体不回弹（设计文档 8.4） */
.app-page__body {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  width: 100%;
  overflow-y: auto;
  overscroll-behavior: none;
  -webkit-overflow-scrolling: touch;
}
</style>
