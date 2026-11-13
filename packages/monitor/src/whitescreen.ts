import { captureError } from './error'
import { isEnabled, recentErrorText } from './state'

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
  const recentErrors = recentErrorText()
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
