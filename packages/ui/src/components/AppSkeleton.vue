<script setup lang="ts">
import { computed } from 'vue'
import type { AppSkeletonProps } from '../types'

defineOptions({ name: 'AppSkeleton' })

const props = withDefaults(defineProps<AppSkeletonProps>(), {
  loading: true,
  rows: 3,
  avatar: false,
})

const rowCount = computed(() => Math.max(1, Math.trunc(props.rows)))
</script>

<template>
  <div v-if="props.loading" class="app-skeleton" data-testid="app-skeleton" aria-busy="true">
    <div v-if="props.avatar" class="app-skeleton__avatar app-skeleton__block" />

    <div class="app-skeleton__lines">
      <div
        v-for="row in rowCount"
        :key="row"
        class="app-skeleton__row app-skeleton__block"
        :class="{ 'app-skeleton__row--last': row === rowCount }"
      />
    </div>
  </div>

  <slot v-else />
</template>

<style scoped>
.app-skeleton {
  box-sizing: border-box;
  display: flex;
  align-items: flex-start;
  gap: var(--space-md);
  padding: var(--space-lg);
}

.app-skeleton__avatar {
  flex: 0 0 auto;
  width: 32px;
  height: 32px;
  border-radius: 50%;
}

.app-skeleton__lines {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: var(--space-md);
  padding-top: var(--space-xs);
}

.app-skeleton__row {
  height: 12px;
  border-radius: var(--radius-sm);
}

.app-skeleton__row--last {
  width: 60%;
}

.app-skeleton__block {
  background-color: var(--color-border);
  animation: app-skeleton-blink 1.4s ease-in-out infinite;
}

@keyframes app-skeleton-blink {
  0%,
  100% {
    opacity: 0.6;
  }

  50% {
    opacity: 1;
  }
}
</style>
