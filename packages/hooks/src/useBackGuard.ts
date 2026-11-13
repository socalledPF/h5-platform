import { onBeforeUnmount, onMounted } from 'vue'
import { registerBackHandler } from '@h5/core'

/**
 * 返回拦截（设计文档 7.3.4）。
 *
 * 注册进 @h5/core 的后进先出栈：最后注册的最先执行，返回 `true` 表示已消费，
 * 后面的处理器与默认返回行为都不再执行。组件卸载时自动注销。
 *
 * ```ts
 * useBackGuard(() => !dirty.value || confirm('放弃编辑？'))
 * ```
 */
export function useBackGuard(handler: () => boolean | Promise<boolean>): void {
  let unregister: (() => void) | undefined

  onMounted(() => {
    unregister = registerBackHandler(handler)
  })

  onBeforeUnmount(() => {
    unregister?.()
    unregister = undefined
  })
}
