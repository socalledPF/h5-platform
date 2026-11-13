<script setup lang="ts">
import { canIUse, invoke, METHODS } from '@h5/bridge'
import { env } from '@h5/core'
import { AppNavBar, AppPage } from '@h5/ui'
import { computed, onMounted, ref } from 'vue'

import { METHOD_GROUPS } from '../bridge/catalog'
import EventLog from '../components/EventLog.vue'
import MethodCard from '../components/MethodCard.vue'

/** 能力列表：app.getCapabilities 的返回值，未拿到时用 canIUse 的即时判断兜底。 */
const capabilities = ref<string[] | null>(null)
const capabilityError = ref<string | null>(null)
const capabilityVersion = ref(0)

const totalMethods = computed(() =>
  METHOD_GROUPS.reduce((sum, group) => sum + group.methods.length, 0),
)

const supportedCount = computed(() => {
  if (capabilities.value === null) return null
  return capabilities.value.length
})

/** 能力列表刷新后重新计算（读取 version 建立响应式依赖）。 */
function supported(method: string): boolean {
  void capabilityVersion.value
  if (capabilities.value !== null) return capabilities.value.includes(method)
  return canIUse(method)
}

async function loadCapabilities(): Promise<void> {
  capabilityError.value = null
  try {
    capabilities.value = await invoke<string[]>(METHODS.app.getCapabilities)
  } catch (error) {
    capabilityError.value = error instanceof Error ? error.message : String(error)
  } finally {
    capabilityVersion.value += 1
  }
}

const runMode = computed(() => (env.isApp ? 'App 原生环境' : '浏览器 mock 环境'))
const appMeta = computed(() =>
  [env.appVersion, env.os, env.device]
    .filter((part) => part !== '' && part !== 'unknown')
    .join(' · '),
)

onMounted(() => {
  void loadCapabilities()
})
</script>

<template>
  <AppPage>
    <AppNavBar title="Bridge 调试" />

    <div class="playground" data-testid="bridge-playground">
      <section class="playground__summary" data-testid="playground-summary">
        <p class="playground__mode">运行环境：{{ runMode }}</p>
        <p class="playground__meta">
          {{ appMeta === '' ? 'App 信息：未知' : `App 信息：${appMeta}` }}
        </p>
        <p class="playground__meta">
          共 {{ totalMethods }} 个方法 ·
          {{ supportedCount === null ? '能力列表加载中' : `原生声明支持 ${supportedCount} 个` }}
        </p>
        <p v-if="capabilityError !== null" class="playground__error">
          app.getCapabilities 失败：{{ capabilityError }}
        </p>
        <p class="playground__tip">
          浏览器里所有调用都走 mock（不依赖客户端），code 与 data 与原生实现保持一致； 在 App
          内用同一页面即可做自测与回归。
        </p>
      </section>

      <EventLog />

      <section
        v-for="group in METHOD_GROUPS"
        :key="group.domain"
        class="playground__group"
        :data-testid="`group-${group.domain}`"
      >
        <h2 class="playground__group-title">{{ group.label }}</h2>
        <MethodCard
          v-for="entry in group.methods"
          :key="entry.method"
          :entry="entry"
          :supported="supported(entry.method)"
        />
      </section>
    </div>
  </AppPage>
</template>

<style scoped>
.playground {
  padding: var(--space-md) var(--space-md) var(--space-xl);
}

.playground__summary {
  padding: var(--space-md);
  margin-bottom: var(--space-md);
  background-color: var(--color-bg);
  border-radius: var(--radius-lg);
}

.playground__mode {
  color: var(--color-text);
  font-size: var(--font-size-lg);
  font-weight: 600;
}

.playground__meta {
  margin-top: var(--space-xs);
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
}

.playground__error {
  margin-top: var(--space-xs);
  color: var(--color-danger);
  font-size: var(--font-size-sm);
}

.playground__tip {
  margin-top: var(--space-sm);
  color: var(--color-text-placeholder);
  font-size: var(--font-size-xs);
  line-height: 1.6;
}

.playground__group-title {
  padding: var(--space-sm) 0;
  color: var(--color-text-secondary);
  font-size: var(--font-size-md);
  font-weight: 600;
}
</style>
