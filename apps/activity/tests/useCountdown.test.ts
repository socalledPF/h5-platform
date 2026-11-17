import { createApp, defineComponent, h } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { parseTime, useCountdown } from '../src/composables/useCountdown'
import type { UseCountdownReturn } from '../src/composables/useCountdown'

/** 2026-11-13 的本地零点：`YYYY-MM-DD` 的期望语义。 */
const LOCAL_MIDNIGHT = new Date(2026, 10, 13).getTime()
/** 2026-11-13 的 UTC 零点：ISO 串的语义，`YYYY-MM-DD` 绝不能解析成这个值。 */
const UTC_MIDNIGHT = Date.UTC(2026, 10, 13)
/** `2026-11-13 10:00:00-05:00` 对应的绝对时刻。 */
const OFFSET_INSTANT = Date.UTC(2026, 10, 13, 15)

interface Mounted {
  countdown: UseCountdownReturn
  unmount: () => void
}

/** 用一个最小组件挂载组合式函数：onMounted / onBeforeUnmount 必须有实例才会执行。 */
function mountCountdown(endAt: string | undefined): Mounted {
  const holder: { current: UseCountdownReturn | null } = { current: null }
  const host = document.createElement('div')
  document.body.appendChild(host)

  const app = createApp(
    defineComponent({
      setup() {
        holder.current = useCountdown(endAt)
        return () => h('div')
      },
    }),
  )
  app.mount(host)

  if (holder.current === null) throw new Error('useCountdown 没有在 setup 阶段执行')
  return {
    countdown: holder.current,
    unmount: () => {
      app.unmount()
      host.remove()
    },
  }
}

describe('parseTime 时间解析', () => {
  it('只有日期时按本地零点解析，而不是 UTC 零点', () => {
    expect(parseTime('2026-11-13')).toBe(LOCAL_MIDNIGHT)
    // 非 UTC 时区下两者必然相差一个时区偏移；旧实现让引擎解析 '2026/11/13'，
    // 本机恰好落在本地零点，但在别的引擎上会漂——这里断言的是数值，不是本地化字符串。
    if (new Date(2026, 10, 13).getTimezoneOffset() !== 0) {
      expect(parseTime('2026-11-13')).not.toBe(UTC_MIDNIGHT)
    }
  })

  it('空格分隔的日期时间按本地时间解析', () => {
    const expected = new Date(2026, 10, 13, 10, 0, 0).getTime()
    expect(parseTime('2026-11-13 10:00:00')).toBe(expected)
    expect(parseTime('2026-11-13 10:00')).toBe(expected)
  })

  it('带时区偏移的串按偏移精确解析（旧实现把偏移里的负号换成斜杠，得到 Invalid Date）', () => {
    expect(parseTime('2026-11-13 10:00:00-05:00')).toBe(OFFSET_INSTANT)
    expect(parseTime('2026-11-13T10:00:00-05:00')).toBe(OFFSET_INSTANT)
  })

  it('带 Z 的 ISO 串按 UTC 解析', () => {
    const expected = Date.UTC(2026, 10, 13, 10)
    expect(parseTime('2026-11-13T10:00:00Z')).toBe(expected)
    expect(parseTime('2026-11-13 10:00:00Z')).toBe(expected)
  })

  it('无法解析的输入返回 null，而不是 NaN 时间戳', () => {
    expect(parseTime('garbage')).toBeNull()
    expect(parseTime('2026-13-45')).toBeNull()
    expect(parseTime('2026-02-30')).toBeNull()
    expect(parseTime('')).toBeNull()
    expect(parseTime(undefined)).toBeNull()
  })
})

describe('useCountdown 倒计时', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('每秒递减，卸载时清理定时器', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 10, 13, 10, 0, 0))

    const deadline = new Date(2026, 10, 13, 10, 0, 5)
    const { countdown, unmount } = mountCountdown(deadline.toISOString())

    expect(countdown.invalid.value).toBe(false)
    expect(countdown.remainingMs.value).toBe(5000)
    expect(countdown.ended.value).toBe(false)
    expect(countdown.parts.value.map((part) => part.value)).toEqual(['00', '00', '00', '05'])
    expect(vi.getTimerCount()).toBe(1)

    vi.advanceTimersByTime(1000)
    expect(countdown.remainingMs.value).toBe(4000)
    expect(countdown.parts.value.map((part) => part.value)).toEqual(['00', '00', '00', '04'])

    unmount()
    expect(vi.getTimerCount()).toBe(0)

    vi.advanceTimersByTime(5000)
    expect(countdown.remainingMs.value).toBe(4000)
  })

  it('结束时间解析失败时标记 invalid，不再编造「今天 23:59」', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 10, 13, 10, 0, 0))

    const endOfToday = new Date(2026, 10, 13, 23, 59, 59, 999).getTime()
    const { countdown, unmount } = mountCountdown('2026-11-13 10:00:00-05:0x')

    expect(countdown.invalid.value).toBe(true)
    expect(countdown.ended.value).toBe(true)
    expect(countdown.remainingMs.value).toBe(0)
    // 旧实现会把结束时间兜底成当天 23:59:59，倒计时照常走——那正是要消灭的假结束时间
    expect(countdown.remainingMs.value).not.toBe(endOfToday - Date.now())
    expect(vi.getTimerCount()).toBe(0)

    unmount()
  })

  it('完全没传结束时间时才用当天 23:59:59 兜底（页面演示默认值）', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 10, 13, 10, 0, 0))

    const { countdown, unmount } = mountCountdown(undefined)
    const endOfToday = new Date(2026, 10, 13, 23, 59, 59, 999).getTime()

    expect(countdown.invalid.value).toBe(false)
    expect(countdown.remainingMs.value).toBe(endOfToday - Date.now())
    expect(countdown.remainingMs.value).toBeGreaterThan(0)

    unmount()
  })
})
