import vue from 'eslint-plugin-vue'
import tseslint from 'typescript-eslint'

const TS_FILES = ['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts']
const VUE_FILES = ['**/*.vue']
const CODE_FILES = [...TS_FILES, ...VUE_FILES]
const APP_FILES = ['apps/**/*.{ts,tsx,mts,vue}']
const PACKAGE_FILES = ['packages/**/*.{ts,tsx,mts,vue}']

const NATIVE_HINT =
  'App WebView 原生对象只能出现在 @h5/bridge 中，业务请使用 @h5/bridge / @h5/core/env。'

/**
 * 禁止直接访问 window.webkit / window.H5Bridge / navigator.userAgent。
 * 见设计文档 12.1：只有 packages/bridge 可以访问 window 上的原生对象。
 */
export const nativeAccessRules = {
  'no-restricted-properties': [
    'error',
    { object: 'window', property: 'webkit', message: NATIVE_HINT },
    { object: 'window', property: 'H5Bridge', message: NATIVE_HINT },
    { object: 'globalThis', property: 'webkit', message: NATIVE_HINT },
    { object: 'globalThis', property: 'H5Bridge', message: NATIVE_HINT },
    { object: 'navigator', property: 'userAgent', message: NATIVE_HINT },
    { object: 'navigator', property: 'userAgentData', message: NATIVE_HINT },
  ],
  'no-restricted-syntax': [
    'error',
    {
      selector: 'ObjectPattern > Property[key.name="webkit"]',
      message: `${NATIVE_HINT}（禁止解构 webkit）`,
    },
    {
      selector: 'ObjectPattern > Property[key.name="H5Bridge"]',
      message: `${NATIVE_HINT}（禁止解构 H5Bridge）`,
    },
    {
      selector: 'ObjectPattern > Property[key.name="userAgent"]',
      message: `${NATIVE_HINT}（禁止解构 userAgent）`,
    },
  ],
}

/** 包内部实现不允许被业务直接引用，只能走包入口。 */
const noDeepPackageImports = {
  group: ['@h5/*/src/**', '@h5/*/dist/**'],
  message: '禁止引用包内部路径，请使用包入口（如 @h5/core）。',
}

const tsConfigs = tseslint.configs.recommended.map((config) => ({ ...config, files: TS_FILES }))

export default [
  {
    files: CODE_FILES,
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
    },
  },
  ...tsConfigs,
  ...vue.configs['flat/essential'],
  {
    name: 'h5/vue-typescript',
    files: VUE_FILES,
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
        ecmaVersion: 2023,
        sourceType: 'module',
        extraFileExtensions: ['.vue'],
      },
    },
    rules: {
      'vue/multi-word-component-names': 'off',
    },
  },
  {
    name: 'h5/boundary-apps',
    files: APP_FILES,
    rules: {
      ...nativeAccessRules,
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            noDeepPackageImports,
            {
              group: ['@h5/app-*'],
              message: 'apps/* 之间禁止互相依赖，公共能力请沉到 packages/*。',
            },
            {
              group: ['**/apps/*/src/**', '**/../apps/**'],
              message: 'apps/* 之间禁止互相依赖（禁止相对路径跨 app 引用）。',
            },
          ],
        },
      ],
    },
  },
  {
    name: 'h5/boundary-packages',
    files: PACKAGE_FILES,
    rules: {
      ...nativeAccessRules,
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            noDeepPackageImports,
            {
              group: ['@h5/app-*', '**/apps/*/src/**'],
              message: 'packages/* 禁止依赖 apps/*。',
            },
          ],
        },
      ],
    },
  },
  {
    name: 'h5/boundary-bridge-is-a-leaf',
    files: ['packages/bridge/**/*.{ts,tsx,mts,vue}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            noDeepPackageImports,
            {
              group: ['@h5/core', '@h5/ui', '@h5/hooks', '@h5/monitor', '@h5/app-*'],
              message: 'bridge 是最底层，禁止反向依赖 core/ui/hooks/monitor/apps。',
            },
          ],
        },
      ],
    },
  },
  {
    name: 'h5/boundary-core-layer',
    files: ['packages/core/**/*.{ts,tsx,mts,vue}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            noDeepPackageImports,
            {
              group: ['@h5/ui', '@h5/hooks', '@h5/monitor', '@h5/app-*'],
              message: '层序 bridge <- core <- (ui | hooks | monitor)，core 只能依赖 bridge。',
            },
          ],
        },
      ],
    },
  },
  {
    name: 'h5/boundary-bridge-only-native',
    files: ['packages/bridge/**/*.{ts,tsx,mts,vue}'],
    rules: {
      'no-restricted-properties': 'off',
      'no-restricted-syntax': 'off',
    },
  },
]
