/**
 * @h5/hooks —— 把 iOS / Android 差异与平台生命周期收进组合式函数，
 * 业务不再重复写监听、去重和兜底（设计文档 7.5 / 8.3 / 8.4）。
 */

/** 包名，供跨包自检与日志区分使用。 */
export const PACKAGE_NAME = '@h5/hooks'

export { useBackGuard } from './useBackGuard'
export { useKeyboard } from './useKeyboard'
export { useNavMode } from './useNavMode'
export type { UseNavModeReturn } from './useNavMode'
export { usePageShow } from './usePageShow'
export type { UsePageShowOptions } from './usePageShow'
export { useSafeArea } from './useSafeArea'
