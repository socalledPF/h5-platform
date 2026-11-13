import { onBeforeUnmount, onMounted } from 'vue'
import { on } from '@h5/bridge'

/**
 * 原生 `page.resume` 与浏览器 `visibilitychange` 在返回瞬间往往同时到达，
 * 这个窗口内的重复回调只保留一次（设计文档 7.5）。
 */
const DEDUPE_MS = 100

export interface UsePageShowOptions {
  /**
   * 挂载后立即执行一次。立即执行不占用去重窗口，因此紧随其后的真实
   * resume 事件不会被吞掉。
   */
  immediate?: boolean
}

/**
 * 页面重新可见时回调：从原生页 / 另一个 WebView 返回时 Vue 生命周期不会重跑，
 * 用它刷新列表、订单状态等（设计文档 7.5）。组件卸载时自动注销两个监听。
 */
export function usePageShow(fn: () => void, options: UsePageShowOptions = {}): void {
  let lastFiredAt = Number.NEGATIVE_INFINITY
  let unsubscribe: (() => void) | undefined

  const fire = (): void => {
    const now = Date.now()
    if (now - lastFiredAt < DEDUPE_MS) return
    lastFiredAt = now
    fn()
  }

  const handleVisibilityChange = (): void => {
    if (document.visibilityState === 'visible') fire()
  }

  onMounted(() => {
    unsubscribe = on('page.resume', fire)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    if (options.immediate === true) fn()
  })

  onBeforeUnmount(() => {
    unsubscribe?.()
    unsubscribe = undefined
    document.removeEventListener('visibilitychange', handleVisibilityChange)
  })
}
