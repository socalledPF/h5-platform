/// <reference types="vite/client" />

/** 构建期注入的常量，见 @h5/config/vite 的 define。 */
declare const __APP_ID__: string
declare const __APP_VERSION__: string
declare const __BUILD_TIME__: string

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
