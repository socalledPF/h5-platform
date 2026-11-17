<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { navMode } from '@h5/core'
import type { AppPageProps } from '../types'
import { safeInsetValue } from '../safe-area'

defineOptions({ name: 'AppPage' })

const props = withDefaults(defineProps<AppPageProps>(), {
  padded: true,
})

const resolvedMode = computed(() => props.navMode ?? navMode.value)

// 安全区只有一个真值来源：core / styles 写在根元素上的 CSS 变量。
// 变量在就输出 var()，组件不再自己量一遍；变量缺失（独立渲染）才回落到 px 兜底。
const safeTop = ref(safeInsetValue('top'))
const safeBottom = ref(safeInsetValue('bottom'))

function measure(): void {
  safeTop.value = safeInsetValue('top')
  safeBottom.value = safeInsetValue('bottom')
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
    style.paddingTop = `calc(var(--nav-height) + ${safeTop.value})`
  } else if (resolvedMode.value === 'none') {
    style.paddingTop = safeTop.value
  }
  style.paddingBottom = safeBottom.value
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
/* 定高容器：只有父级高度确定，内部 body 才会真的成为滚动容器（设计文档 8.4）。
   老 WebView 不认 dvh，先用 vh 兜一层。 */
.app-page {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  height: 100vh;
  background-color: var(--color-bg-page);
}

@supports (height: 100dvh) {
  .app-page {
    height: 100dvh;
  }
}

/* 滚动放在内部容器，页面整体不回弹（设计文档 8.4） */
.app-page__body {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  width: 100%;
  /* flex 项默认 min-height:auto 会撑破定高父级，滚动容器就失效 */
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
}
</style>
