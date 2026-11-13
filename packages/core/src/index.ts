/**
 * @h5/core —— 统一启动入口与跨业务公共能力。
 *
 * 层序：bridge <- core <- (ui | hooks | monitor | apps)。core 只依赖 @h5/bridge，
 * 监控通过 `MonitorAdapter` 依赖注入，UI 提示通过 `setErrorNotifier` 注入。
 */

export { useAuthStore } from './auth'
export { createH5App } from './create-app'
export { env, initEnv } from './env'
export { ApiError, normalizeError } from './errors'

/** 包名，供跨包自检与日志区分使用。 */
export const PACKAGE_NAME = '@h5/core'

export { markFirstScreen } from './monitor'
export {
  goBack,
  navigate,
  navMode,
  registerBackHandler,
  requestBack,
  resolveNavMode,
  routeStackDepth,
  setDefaultNavMode,
} from './navigation'
export { get, http, post, request, setErrorNotifier, withCancel } from './request'
export { storage } from './storage'

export type {
  AppEnv,
  AuthState,
  BackHandler,
  CreateH5AppOptions,
  MockAdapter,
  MonitorAdapter,
  NavMode,
  NavTarget,
} from './types'
export type { ErrorMode, RequestConfig } from './request'
