import pxToViewportModule from 'postcss-px-to-viewport-8-plugin'

const pxToViewport = pxToViewportModule.default ?? pxToViewportModule

/** 设计稿宽度：所有业务按 375 宽出图（含 node_modules/vant）。 */
export const DESIGN_WIDTH = 375

/**
 * 依赖 CSS 的排除规则（设计文档 8.1）：node_modules 下的第三方样式原样保留，
 * 只有 vant 按同一个 375 基准换算。
 *
 * pnpm 的依赖路径是 `node_modules/.pnpm/<pkg>@<ver>/node_modules/<pkg>/…`，
 * 只匹配第一个 `node_modules/` 会把 `vant` 当成 `.pnpm` 而整包排除，
 * 所以先定位最后一个 `node_modules/`（真正的包目录），再看它后面是不是 `vant/`：
 * `node_modules/vant/…` 与 `node_modules/.pnpm/vant@x/node_modules/vant/…` 都不排除，
 * 其余依赖（含 `@vant/*` 这类同名作用域包）继续排除。
 */
const EXCLUDE_DEPENDENCY_CSS = /node_modules[\\/](?!.*node_modules[\\/])(?!vant[\\/])/

/**
 * postcss 插件配置。大写 `PX` 不会被转换（1px 细线、平板上限宽等场景），
 * 也可用 `selectorBlackList` 里的 class 或 `px-to-viewport-ignore` 注释跳过。
 */
export function createPostcssConfig(options = {}) {
  const { viewportWidth = DESIGN_WIDTH } = options

  return {
    plugins: [
      pxToViewport({
        unitToConvert: 'px',
        viewportWidth,
        unitPrecision: 5,
        propList: ['*'],
        viewportUnit: 'vw',
        fontViewportUnit: 'vw',
        selectorBlackList: ['.ignore-vw', '.no-vw'],
        minPixelValue: 1,
        mediaQuery: false,
        replace: true,
        landscape: false,
        exclude: [EXCLUDE_DEPENDENCY_CSS],
      }),
    ],
  }
}

export default createPostcssConfig
