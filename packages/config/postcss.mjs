import pxToViewportModule from 'postcss-px-to-viewport-8-plugin'

const pxToViewport = pxToViewportModule.default ?? pxToViewportModule

/** 设计稿宽度：所有业务按 375 宽出图（含 node_modules/vant）。 */
export const DESIGN_WIDTH = 375

/**
 * postcss 插件配置。大写 `PX` 不会被转换（1px 细线、平板上限宽等场景），
 * 也可用 `selectorBlackList` 里的 class 跳过整个选择器。
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
        exclude: [/node_modules\/(?!vant)/],
      }),
    ],
  }
}

export default createPostcssConfig
