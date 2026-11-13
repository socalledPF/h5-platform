import { computed } from 'vue'
import type { ComputedRef } from 'vue'
import { navMode } from '@h5/core'
import type { NavMode } from '@h5/bridge'

export interface UseNavModeReturn {
  mode: ComputedRef<NavMode>
  isNative: ComputedRef<boolean>
  isH5: ComputedRef<boolean>
  isNone: ComputedRef<boolean>
}

/**
 * 当前页面的导航栏模式（设计文档 7.1 解析结果，由 @h5/core 计算）。
 *
 * 业务绝大多数情况直接用 `<AppNavBar>` 即可；需要按模式分支（如沉浸式页面
 * 自绘返回按钮）时读这里。
 */
export function useNavMode(): UseNavModeReturn {
  const mode = computed<NavMode>(() => navMode.value)

  return {
    mode,
    isNative: computed(() => mode.value === 'native'),
    isH5: computed(() => mode.value === 'h5'),
    isNone: computed(() => mode.value === 'none'),
  }
}
