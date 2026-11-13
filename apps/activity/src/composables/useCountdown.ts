import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { ComputedRef, Ref } from 'vue'

/** 倒计时的一段：天/时/分/秒补零展示。 */
export interface CountdownPart {
  label: string
  value: string
}

export interface UseCountdownReturn {
  parts: ComputedRef<CountdownPart[]>
  ended: ComputedRef<boolean>
  remainingMs: Ref<number>
}

const SECOND_MS = 1000
const MINUTE_MS = 60 * SECOND_MS
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

/**
 * 解析活动结束时间。
 *
 * iOS 上 `new Date('2026-11-13 10:00:00')` 会得到 Invalid Date（设计文档 8.4），
 * 所以带空格的格式先换成 `2026/11/13 10:00:00`；带 `T` 的 ISO 串交给引擎处理。
 */
export function parseTime(raw: string | undefined): number {
  if (raw === undefined || raw === '') return Number.NaN
  const normalized = raw.includes('T') ? raw : raw.replace(/-/g, '/')
  return new Date(normalized).getTime()
}

/** 默认结束时间：当天 23:59:59，保证页面在没有任何参数时也有一个可读的倒计时。 */
export function endOfToday(): number {
  const now = new Date()
  now.setHours(23, 59, 59, 999)
  return now.getTime()
}

function pad(value: number): string {
  return value < 10 ? `0${value}` : `${value}`
}

/**
 * 秒级倒计时：时间戳只算一次差值，避免每秒 new Date 比较带来的漂移。
 * 页面卸载时清理定时器，防止在已销毁的组件上写状态。
 */
export function useCountdown(endAt: string | undefined): UseCountdownReturn {
  const parsed = parseTime(endAt)
  const deadline = Number.isFinite(parsed) ? parsed : endOfToday()

  const remainingMs = ref(Math.max(0, deadline - Date.now()))
  let timer: ReturnType<typeof setInterval> | undefined

  const tick = (): void => {
    remainingMs.value = Math.max(0, deadline - Date.now())
    if (remainingMs.value === 0 && timer !== undefined) {
      clearInterval(timer)
      timer = undefined
    }
  }

  const ended = computed(() => remainingMs.value === 0)

  const parts = computed<CountdownPart[]>(() => {
    const total = remainingMs.value
    return [
      { label: '天', value: pad(Math.floor(total / DAY_MS)) },
      { label: '时', value: pad(Math.floor((total % DAY_MS) / HOUR_MS)) },
      { label: '分', value: pad(Math.floor((total % HOUR_MS) / MINUTE_MS)) },
      { label: '秒', value: pad(Math.floor((total % MINUTE_MS) / SECOND_MS)) },
    ]
  })

  onMounted(() => {
    tick()
    if (remainingMs.value > 0) timer = setInterval(tick, SECOND_MS)
  })

  onBeforeUnmount(() => {
    if (timer !== undefined) clearInterval(timer)
    timer = undefined
  })

  return { parts, ended, remainingMs }
}
