<script setup lang="ts">
import { on } from '@h5/bridge'
import type { BridgeEventName } from '@h5/bridge'
import { onBeforeUnmount, onMounted, ref } from 'vue'

interface LogEntry {
  id: number
  at: string
  event: string
  payload: string
}

/** 事件日志上限：调试页长时间挂着也不会把内存与 DOM 撑爆。 */
const MAX_ENTRIES = 50

/** core / hooks 关心的原生推送：返回、恢复、右按钮、网络、登录态（设计文档 7.2 / 7.3 / 7.5）。 */
const TRACKED_EVENTS: BridgeEventName[] = [
  'page.resume',
  'nav.rightButtonClick',
  'nav.backPress',
  'network.change',
  'auth.change',
]

const entries = ref<LogEntry[]>([])
const unsubscribes: (() => void)[] = []
let seq = 0

function formatPayload(payload: unknown): string {
  if (payload === undefined) return '(无参数)'
  try {
    return JSON.stringify(payload)
  } catch {
    return String(payload)
  }
}

function push(event: string, payload: unknown): void {
  seq += 1
  const entry: LogEntry = {
    id: seq,
    at: new Date().toLocaleTimeString(),
    event,
    payload: formatPayload(payload),
  }
  entries.value = [entry, ...entries.value].slice(0, MAX_ENTRIES)
}

function clear(): void {
  entries.value = []
}

onMounted(() => {
  for (const event of TRACKED_EVENTS) {
    unsubscribes.push(
      on(event, (payload) => {
        push(event, payload)
      }),
    )
  }
})

onBeforeUnmount(() => {
  for (const unsubscribe of unsubscribes) unsubscribe()
  unsubscribes.length = 0
})
</script>

<template>
  <section class="event-log" data-testid="event-log">
    <header class="event-log__head">
      <h2 class="event-log__title">原生事件日志</h2>
      <van-button size="mini" plain :disabled="entries.length === 0" @click="clear"
        >清空</van-button
      >
    </header>

    <p class="event-log__events">{{ TRACKED_EVENTS.join(' / ') }}</p>

    <ul v-if="entries.length > 0" class="event-log__list">
      <li v-for="entry in entries" :key="entry.id" class="event-log__item">
        <span class="event-log__time">{{ entry.at }}</span>
        <span class="event-log__event">{{ entry.event }}</span>
        <code class="event-log__payload">{{ entry.payload }}</code>
      </li>
    </ul>

    <p v-else class="event-log__empty" data-testid="event-log-empty">
      暂无事件。浏览器 mock 不会推送原生事件；在 App 内触发返回、右按钮点击、切网或登录态变化后，
      事件会实时出现在这里。
    </p>
  </section>
</template>

<style scoped>
.event-log {
  padding: var(--space-md);
  margin-bottom: var(--space-lg);
  background-color: var(--color-bg);
  border-radius: var(--radius-lg);
}

.event-log__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
}

.event-log__title {
  color: var(--color-text);
  font-size: var(--font-size-lg);
  font-weight: 600;
}

.event-log__events {
  margin-top: var(--space-xs);
  color: var(--color-text-placeholder);
  font-size: var(--font-size-xs);
  word-break: break-all;
}

.event-log__list {
  margin-top: var(--space-sm);
}

.event-log__item {
  padding: var(--space-xs) 0;
  border-top: 1px solid var(--color-border);
  font-size: var(--font-size-xs);
}

.event-log__time {
  margin-right: var(--space-xs);
  color: var(--color-text-placeholder);
}

.event-log__event {
  margin-right: var(--space-xs);
  color: var(--color-primary);
  font-weight: 600;
}

.event-log__payload {
  color: var(--color-text-secondary);
  word-break: break-all;
}

.event-log__empty {
  margin-top: var(--space-sm);
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
  line-height: 1.6;
}
</style>
