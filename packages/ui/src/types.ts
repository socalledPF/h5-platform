import type { NavBarButton, NavMode } from '@h5/bridge'

/** `<AppNavBar>` 的 props（冻结契约，apps 直接依赖）。 */
export interface AppNavBarProps {
  /** 页面标题；原生模式下同步给 `bridge.nav.setTitle` 与 `document.title`。 */
  title?: string
  /** 右侧文字按钮；原生模式下同步给 `bridge.nav.setRightButtons`。 */
  right?: NavBarButton[]
  /** H5 模式是否显示返回按钮，默认 `true`。 */
  showBack?: boolean
  /** 覆盖 `@h5/core` 的 `navMode`（一般不需要）。 */
  mode?: NavMode
  /** 导航栏背景色，默认 `var(--color-bg)`。 */
  backgroundColor?: string
  /** 导航栏文字色，默认 `var(--color-text)`。 */
  textColor?: string
  /** 沉浸式：不加状态栏安全区内边距，给 `nav=none` 自绘头部的页面用。 */
  immersive?: boolean
}

/** `<AppPage>` 的 props。 */
export interface AppPageProps {
  /** 覆盖 `@h5/core` 的 `navMode`（一般不需要）。 */
  navMode?: NavMode
  /** 页面背景色，默认 `var(--color-bg-page)`。 */
  background?: string
  /** 是否自动处理导航栏高度与上下安全区，默认 `true`。 */
  padded?: boolean
}

/** `<AppEmpty>` 的 props。 */
export interface AppEmptyProps {
  /** 空态文案，默认「暂无数据」。 */
  description?: string
  /** 空态插图地址；不传用内置占位图。 */
  image?: string
}

/** `<AppSkeleton>` 的 props。 */
export interface AppSkeletonProps {
  /** 骨架屏开关，默认 `true`；为 `false` 时渲染默认插槽的真实内容。 */
  loading?: boolean
  /** 文本行数，默认 `3`。 */
  rows?: number
  /** 是否显示左侧头像块。 */
  avatar?: boolean
}
