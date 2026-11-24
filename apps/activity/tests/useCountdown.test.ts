import { createApp, defineComponent, h } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * 时区先钉死再看被测模块：`process.env.TZ` 的赋值会触发 Node 的 tzset，之后创建的 Date
 * 才按新时区走（Node 按进程缓存 TZ，晚于任何一次 Date 运算再改就不再生效）。
 * 静态 import 会被提升到文件顶部执行，所以被测模块用动态 import，保证「设 TZ → 加载模块」的顺序。
 *
 * 钉死时区是为了让本文件在任何机器上都断得出同样的绝对时间戳：放任 CI 跑在 UTC 上时，
 * 「本地零点」与「UTC 零点」恰好相等，那条断言就空转了。
 *
 * `process` 只声明用到的那一处：测试工程继承的 tsconfig 是 `types: []`（不带 node 类型）。
 */
declare const process: { env: Record<string, string | undefined> }

process.env.TZ = 'Asia/Shanghai'

const { parseTime, useCountdown } = await import('../src/composables/useCountdown')
import type { UseCountdownReturn } from '../src/composables/useCountdown'

/**
 * 2026-11-13 在 Asia/Shanghai（UTC+8）的本地零点，写成绝对时间戳。
 * 硬编码而不是 `new Date(2026, 10, 13)`：期望值不能跟着被测代码和机器时区一起飘。
 */
const LOCAL_MIDNIGHT = Date.UTC(2026, 10, 12, 16)
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
    // 无条件断言绝对时间戳：本文件把 TZ 钉在 Asia/Shanghai，两种时区语义不再可能相等
    expect(parseTime('2026-11-13')).toBe(LOCAL_MIDNIGHT)
    expect(parseTime('2026-11-13')).not.toBe(UTC_MIDNIGHT)
  })

  it('时分秒越界一律返回 null，不被引擎静默进位', () => {
    // 旧实现只有年月日做回读校验：10:75 被进成 11:15、10:00:99 被进成 10:01:39 而通过，
    // 23:70 却因为跨天被同日校验拦下——同类非法输入一半可用、一半报错
    expect(parseTime('2026-11-13 10:75')).toBeNull()
    expect(parseTime('2026-11-13 10:00:99')).toBeNull()
    expect(parseTime('2026-11-13 23:70')).toBeNull()
    // 边界上的合法值必须照旧通过
    expect(parseTime('2026-11-13 23:59:59')).toBe(Date.UTC(2026, 10, 13, 15, 59, 59))
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
