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
  /** 传了结束时间却解析不出来：页面要渲染「时间无效」，不能编造一个结束时间。 */
  invalid: ComputedRef<boolean>
}

const SECOND_MS = 1000
const MINUTE_MS = 60 * SECOND_MS
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

/** 只有日期：`YYYY-MM-DD`。 */
const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/
/** 日期 + 时间，不带时区：`YYYY-MM-DD HH:mm`、带秒、或 `T` 分隔。 */
const LOCAL_DATE_TIME_RE = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/
/** 末尾带 `Z` 或 `±HH:MM`：这类串按 ISO 交给引擎，绝不能改动它的连字符。 */
const ZONED_RE = /(?:[Zz]|[+-]\d{2}:?\d{2})$/

/** 时分秒的合法上界：`new Date` 会把越界值静默进位，必须自己挡掉。 */
const MAX_HOUR = 23
const MAX_MINUTE = 59
const MAX_SECOND = 59

/**
 * 用年月日时分秒构造本地时间。
 * 日期或时分秒越界返回 `null`，不让 `Date` 的自动进位把非法值蒙混成合法值。
 */
function localTime(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
): number | null {
  // 时分秒越界必须先拒绝：`new Date(2026, 10, 13, 10, 75)` 会被引擎进位成 11:15:00，
  // 于是一个非法输入换来一个「看起来正常却错」的结束时间——而同样非法的 `23:70` 因为跨天
  // 被下面的同日校验拦下，返回 null。同类输入两种行为，正是这里要消灭的不一致。
  if (hour > MAX_HOUR || minute > MAX_MINUTE || second > MAX_SECOND) return null

  const date = new Date(year, month - 1, day, hour, minute, second)
  const sameDay =
    date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
  return sameDay ? date.getTime() : null
}

/**
 * 解析活动结束时间。
 *
 * 不用 `replace(/-/g, '/')` 这类「统一换成本地格式」的捷径：它会把时区里的负号一起换掉
 * （`2026-11-13 10:00:00-05:00` → Invalid Date），也让「只有日期」的语义取决于引擎实现。
 *
 * - `YYYY-MM-DD` → **本地零点**。这是有意选择：结束日期指的是「用户本地时区的这一天」，
 *   交给 ISO 解析会得到 UTC 零点，UTC+8 用户会凭空少 8 小时。
 * - `YYYY-MM-DD HH:mm(:ss)?` → 按年月日时分秒构造本地时间。
 * - 带 `Z` / `±HH:MM` → 原样交给 `Date.parse`（只把空格分隔符换成 `T`，不动连字符）。
 * - 其余一律返回 `null`，由调用方渲染「时间无效」。
 */
export function parseTime(raw: string | undefined): number | null {
  if (raw === undefined) return null
  const value = raw.trim()
  if (value === '') return null

  if (ZONED_RE.test(value)) {
    const parsed = Date.parse(value.replace(' ', 'T'))
    return Number.isNaN(parsed) ? null : parsed
  }

  const dateOnly = DATE_ONLY_RE.exec(value)
  if (dateOnly !== null) {
    return localTime(Number(dateOnly[1]), Number(dateOnly[2]), Number(dateOnly[3]))
  }

  const dateTime = LOCAL_DATE_TIME_RE.exec(value)
  if (dateTime !== null) {
    return localTime(
      Number(dateTime[1]),
      Number(dateTime[2]),
      Number(dateTime[3]),
      Number(dateTime[4]),
      Number(dateTime[5]),
      Number(dateTime[6] ?? 0),
    )
  }

  return null
}

/** 默认结束时间：当天 23:59:59，只在调用方完全没给结束时间时兜底。 */
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
  const provided = endAt !== undefined && endAt.trim() !== ''
  const parsed = provided ? parseTime(endAt) : null
  const isInvalid = provided && parsed === null
  // 没给结束时间才用演示默认值；给了却解析失败时不再编造结束时间，交给页面渲染「时间无效」
  const deadline = parsed ?? (isInvalid ? 0 : endOfToday())

  const invalid = computed(() => isInvalid)
  const remainingMs = ref(isInvalid ? 0 : Math.max(0, deadline - Date.now()))
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

  return { parts, ended, remainingMs, invalid }
}
