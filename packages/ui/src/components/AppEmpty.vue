<script setup lang="ts">
import type { AppEmptyProps } from '../types'

defineOptions({ name: 'AppEmpty' })

const props = withDefaults(defineProps<AppEmptyProps>(), {
  description: '暂无数据',
})
</script>

<template>
  <div class="app-empty" data-testid="app-empty">
    <img v-if="props.image" class="app-empty__image" :src="props.image" alt="" />
    <svg v-else class="app-empty__image" viewBox="0 0 96 72" fill="none" aria-hidden="true">
      <rect x="14" y="10" width="68" height="52" rx="6" stroke="currentColor" stroke-width="2" />
      <path d="M30 34h36M30 46h22" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
    </svg>

    <p class="app-empty__description">{{ props.description }}</p>

    <div class="app-empty__action">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.app-empty {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--space-xl) var(--space-lg);
  text-align: center;
}

.app-empty__image {
  width: 96px;
  height: 72px;
  color: var(--color-text-placeholder);
  object-fit: contain;
}

.app-empty__description {
  margin-top: var(--space-md);
  color: var(--color-text-secondary);
  font-size: var(--font-size-md);
}

.app-empty__action {
  margin-top: var(--space-lg);
}
</style>
