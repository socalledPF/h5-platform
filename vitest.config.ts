import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'
import type { ConfigEnv, ConfigPluginContext, Plugin, UserConfig } from 'vite'

/**
 * 业务的代码几乎都在 SFC 里：根测试必须能编译 .vue，否则各 app 的 tests 目录永远做不了组件级测试。
 *
 * 但 `@vitejs/plugin-vue` 的 config 钩子会注入 `resolve.dedupe: ['vue']`，而 vite 的 dedupe
 * 只从 `config.root` 解析（vite 的 tryNodeResolve: `if (dedupe.includes(pkgId)) basedir = root`，
 * 失败后不回退到 importer）。本仓库的根工程**不持有** vue（vue 由各 app 自己声明），
 * 于是根测试里任何 `import ... from 'vue'` 都会 "Failed to resolve import"。这里只把
 * dedupe 置空，其余注入（__VUE_OPTIONS_API__ 等 define）原样保留，vue 改由 importer
 * 所在目录解析到各 app 自己 node_modules 里的那份 vue。
 */
const vuePlugins: Plugin[] = [vue()].map((plugin): Plugin => {
  const hook = plugin.config
  if (typeof hook !== 'function') return plugin
  return {
    ...plugin,
    config(this: ConfigPluginContext, config: UserConfig, env: ConfigEnv) {
      const result = hook.call(this, config, env)
      if (result === null || result === undefined) return result
      return Promise.resolve(result).then((value) =>
        value === null || value === undefined
          ? value
          : { ...value, resolve: { ...value.resolve, dedupe: [] } },
      )
    },
  }
})

export default defineConfig({
  plugins: vuePlugins,
  test: {
    environment: 'jsdom',
    // tests/ 是仓库级测试；apps/*/tests/ 是各 app 自己的测试（无新依赖，复用根 vitest）
    include: ['tests/**/*.test.ts', 'apps/*/tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      reportsDirectory: 'coverage',
    },
  },
})
