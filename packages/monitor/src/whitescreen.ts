import { captureError } from './error'
import { isEnabled, recentErrorMessages } from './state'

/** 白屏检测默认延迟：挂载后 3 秒（设计文档 11.2）。 */
const DEFAULT_TIMEOUT_MS = 3_000
const DEFAULT_ROOT_SELECTOR = '#app'

let timer: ReturnType<typeof setTimeout> | null = null

/**
 * 白屏检测（设计文档 11.2、13.2）：默认 3 秒后检查根节点是否有有效内容，
 * 没有则上报，并附带最近的 JS 错误。
 *
 * 两种调用形式：
 * - `startWhiteScreenCheck('#app')`：指定选择器，3 秒后检查
 * - `startWhiteScreenCheck(5000)`：指定延迟，选择器为 `#app`
 *
 * **本函数是可选能力，默认不启用。** `@h5/core` 的 `createH5App` 已内联一份等价检测
 * （同样 `#app` / 3000ms / `hasMeaningfulContent` 判定 / 最近 10 条错误缓冲），走
 * `createH5App` 挂载时那一份已经在跑。**两者不得同时启用**：两个检测器各有一份自己的
 * `recentErrors` 缓冲，同时开启会对同一次白屏重复上报，且两份上下文互相不一致。
 * 只有不经过 `createH5App` 的自建挂载流程、或需要换根节点选择器 / 延迟时才自行调用本函数；
 * 如此对齐是为了让两份报告的口径尽量一致（`recentErrors` 与 core 一样是字符串数组，
 * 路由由 `commonFields()` 的 `route` 提供，不再单独重复）。
 */
export function startWhiteScreenCheck(
  rootSelectorOrTimeout: string | number = DEFAULT_ROOT_SELECTOR,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): void {
  const selector =
    typeof rootSelectorOrTimeout === 'string' ? rootSelectorOrTimeout : DEFAULT_ROOT_SELECTOR
  const wait = typeof rootSelectorOrTimeout === 'number' ? rootSelectorOrTimeout : timeoutMs

  stopWhiteScreenCheck()
  timer = setTimeout(() => {
    timer = null
    runCheck(selector)
  }, wait)
}

function runCheck(selector: string): void {
  if (!isEnabled()) return
  if (hasMeaningfulContent(selector)) return
  const recentErrors = recentErrorMessages()
  captureError(new Error(`白屏：根节点 ${selector} 无有效内容`), {
    source: 'white-screen',
    selector,
    recentErrors,
  })
}

/**
 * “有效内容”判定：有可见文本，或有子元素。
 * 文档不存在（SSR / 单测）时视为正常，避免误报。
 */
export function hasMeaningfulContent(selector: string): boolean {
  try {
    if (typeof document === 'undefined') return true
    const root = document.querySelector(selector)
    if (root === null) return false
    if ((root.textContent ?? '').trim().length > 0) return true
    return root.childElementCount > 0
  } catch {
    return true
  }
}

/** 取消已排队的白屏检测（路由切换或测试收尾时使用）。 */
export function stopWhiteScreenCheck(): void {
  if (timer === null) return
  clearTimeout(timer)
  timer = null
}
