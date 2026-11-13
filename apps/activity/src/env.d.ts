/// <reference types="vite/client" />

/**
 * 构建期常量 `__APP_ID__` / `__APP_VERSION__` / `__BUILD_TIME__` 由 @h5/config/vite 的 define 注入，
 * 其全局声明由 @h5/core 的 env.ts 统一提供（`declare global`）。这里不重复声明：
 * 两处同时声明同一个全局 const 会触发 TS2451，且会造成「谁是唯一来源」的歧义。
 */

/** @h5/styles 只提供 css，显式声明以便 `import '@h5/styles'`。 */
declare module '@h5/styles'

interface ImportMetaEnv {
  readonly VITE_APP_ENV?: 'dev' | 'test' | 'pre' | 'prod'
  readonly VITE_API_BASE_URL?: string
  readonly VITE_CDN_BASE?: string
  readonly VITE_APP_ID?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
