import { resolve } from 'node:path'

import legacy from '@vitejs/plugin-legacy'
import vue from '@vitejs/plugin-vue'
import { VantResolver } from '@vant/auto-import-resolver'
import { visualizer } from 'rollup-plugin-visualizer'
import Components from 'unplugin-vue-components/vite'
import { defineConfig, loadEnv } from 'vite'

import { createPostcssConfig } from './postcss.mjs'

/** 最低系统版本：Android 8 / iOS 12 起步，legacy 产物用 SystemJS 兜底。 */
export const LEGACY_TARGETS = [
  'chrome >= 64',
  'safari >= 12',
  'ios >= 12',
  'android >= 8',
  'not dead',
]

function isEnabled(value) {
  return value === '1' || value === 'true'
}

/**
 * 每个业务 app 的共享 vite 配置。
 * @param {{ appId: string, appVersion?: string, base?: string }} options
 */
export function createAppViteConfig(options) {
  const { appId, appVersion = '0.0.0', base } = options ?? {}

  if (!appId) {
    throw new Error('[h5/config] createAppViteConfig requires a non-empty `appId`')
  }

  return defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), '')
    const analyze = isEnabled(env.ANALYZE) || isEnabled(process.env.ANALYZE)
    const apiBaseUrl = env.VITE_API_BASE_URL

    return {
      base: base ?? env.VITE_CDN_BASE ?? '/',
      plugins: [
        vue(),
        legacy({ targets: LEGACY_TARGETS }),
        Components({ resolvers: [VantResolver()], dts: false, dirs: ['src/components'] }),
        ...(analyze
          ? [
              visualizer({
                filename: 'dist/stats.html',
                template: 'treemap',
                gzipSize: true,
                brotliSize: true,
              }),
            ]
          : []),
      ],
      resolve: {
        alias: {
          '@': resolve(process.cwd(), 'src'),
        },
      },
      define: {
        __APP_ID__: JSON.stringify(env.VITE_APP_ID || appId),
        __APP_VERSION__: JSON.stringify(appVersion),
        __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
      },
      css: {
        postcss: createPostcssConfig(),
      },
      /**
       * 各 app 的 `test` 脚本是 `vitest run`，跑在 app 目录里，只认这份配置。
       * 缺了 test 段时 vitest 退回 environment: 'node'，DOM 测试直接
       * `ReferenceError: document is not defined`；vue() 已在上面 plugins 里，
       * SFC 测试才编译得动。根 vitest.config.ts 覆盖的是另一条路径（仓库根跑全量）。
       */
      test: {
        environment: 'jsdom',
        include: ['tests/**/*.test.ts'],
        /**
         * Components({ resolvers: [VantResolver()] }) 会给模板里的 van-* 注入
         * `vant/es/<组件>/style/index` 这类 CSS 导入。vant 若被当成外部依赖交给 Node 加载，
         * Node 直接报 `Unknown file extension ".css"`；inline 之后才由 vite 转换。
         */
        server: { deps: { inline: [/[\\/]node_modules[\\/]vant[\\/]/] } },
      },
      server: {
        host: true,
        port: 5173,
        strictPort: false,
        historyApiFallback: true,
        proxy: apiBaseUrl ? { '/api': { target: apiBaseUrl, changeOrigin: true } } : undefined,
      },
      build: {
        target: 'es2020',
        cssTarget: 'chrome64',
        sourcemap: mode !== 'production',
        rollupOptions: {
          output: {
            entryFileNames: 'assets/[name]-[hash].js',
            chunkFileNames: 'assets/[name]-[hash].js',
            assetFileNames: 'assets/[name]-[hash][extname]',
          },
        },
      },
    }
  })
}

export default createAppViteConfig
