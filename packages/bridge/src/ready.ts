import { isAvailable } from './channel'
import { isMockActive } from './mock'
import { READY_POLL_INTERVAL_MS, READY_TIMEOUT_MS } from './protocol'

/**
 * 等待原生通道注入（设计文档 5.3、13.2）。
 *
 * 原生在 documentStart 注入，但仍需等待以避免启动期调用丢失：
 * 短轮询 + 硬截止时间，命中即 resolve(true)，超时 resolve(false)。
 * 可重复 / 并发调用，各自的定时器在结算时都会被清理。
 */
export function ready(timeoutMs: number = READY_TIMEOUT_MS): Promise<boolean> {
  if (isMockActive() || isAvailable()) return Promise.resolve(true)

  return new Promise<boolean>((resolve) => {
    const timers: ReturnType<typeof setTimeout>[] = []
    let settled = false

    const finish = (value: boolean): void => {
      if (settled) return
      settled = true
      for (const timer of timers) {
        clearTimeout(timer)
        clearInterval(timer)
      }
      resolve(value)
    }

    timers.push(
      setInterval(() => {
        if (isAvailable()) finish(true)
      }, READY_POLL_INTERVAL_MS),
    )
    timers.push(
      setTimeout(
        () => {
          finish(isAvailable())
        },
        Math.max(0, timeoutMs),
      ),
    )
  })
}
