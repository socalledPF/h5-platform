import vue from 'eslint-plugin-vue'
import tseslint from 'typescript-eslint'

const TS_FILES = ['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts']
const VUE_FILES = ['**/*.vue']
const CODE_FILES = [...TS_FILES, ...VUE_FILES]
const APP_FILES = ['apps/**/*.{ts,tsx,mts,vue}']
const PACKAGE_FILES = ['packages/**/*.{ts,tsx,mts,vue}']

const NATIVE_HINT =
  'App WebView 原生对象只能出现在 @h5/bridge 中，业务请使用 @h5/bridge / @h5/core/env。'
const DEEP_IMPORT_HINT = '禁止引用包内部路径，请使用包入口（如 @h5/core）。'

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
  message: DEEP_IMPORT_HINT,
}

/**
 * no-restricted-imports 只看静态 import/export 说明符，且只认 @h5 别名 + /src/ 这种写法，
 * 下面三类逃逸路径它全抓不到，这里用 no-restricted-syntax 补上：
 * 1. 动态 import('@h5/bridge/src/core')；
 * 2. 相对路径穿透 import x from '../../../packages/bridge/src/core'；
 * 3. 不带 packages 段的相对穿透 import x from '../../core/src/index'。
 *
 * DEEP_SEGMENT_RE 命中「某个路径段 + /src/ 或 /dist/」，但排除 `./src/`、`../src/`
 * 这类包内自有 src 引用（段名为 . 或 ..）。
 */
const DEEP_SEGMENT_RE = String.raw`(?:^|\/)(?!\.\.?(?:\/|$))[^\/]+\/(?:src|dist)\/`
const RELATIVE_SPECIFIER_RE = String.raw`^\.`

const deepImportSyntaxSelectors = [
  {
    selector: `ImportDeclaration[source.value=/${RELATIVE_SPECIFIER_RE}/][source.value=/${DEEP_SEGMENT_RE}/]`,
    message: `${DEEP_IMPORT_HINT}（禁止相对路径穿透到别的包的 src）`,
  },
  {
    selector: `ExportNamedDeclaration[source.value=/${RELATIVE_SPECIFIER_RE}/][source.value=/${DEEP_SEGMENT_RE}/]`,
    message: `${DEEP_IMPORT_HINT}（禁止相对路径穿透到别的包的 src）`,
  },
  {
    selector: `ExportAllDeclaration[source.value=/${RELATIVE_SPECIFIER_RE}/][source.value=/${DEEP_SEGMENT_RE}/]`,
    message: `${DEEP_IMPORT_HINT}（禁止相对路径穿透到别的包的 src）`,
  },
  {
    selector: `ImportExpression > Literal[value=/${DEEP_SEGMENT_RE}/]`,
    message: `${DEEP_IMPORT_HINT}（禁止动态 import 引用包内部路径）`,
  },
  {
    selector: `ImportExpression > TemplateLiteral[quasis.0.value.raw=/${DEEP_SEGMENT_RE}/]`,
    message: `${DEEP_IMPORT_HINT}（禁止动态 import 引用包内部路径）`,
  },
]

const nativeSyntaxSelectors = nativeAccessRules['no-restricted-syntax'].slice(1)

/**
 * tseslint.configs.recommended 拆成两半：
 * - 只有 rules 的 config 必须同时覆盖 .vue，否则 @typescript-eslint/* 在 .vue 里全部失效
 *   （.vue 承载了全部业务 UI 代码）；
 * - 设置解析器/插件的 config 仍只给 .ts，.vue 的解析器必须是 vue-eslint-parser。
 */
const tsRuleConfigs = tseslint.configs.recommended
  .filter((config) => config.rules)
  .map((config) => ({ ...config, files: CODE_FILES }))

const tsParserConfigs = tseslint.configs.recommended
  .filter((config) => config.languageOptions)
  .map((config) => ({ ...config, files: TS_FILES }))

export default [
  {
    files: CODE_FILES,
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
    },
  },
  ...tsParserConfigs,
  ...tsRuleConfigs,
  {
    // .vue 的 <script setup lang="ts"> 由 vue-eslint-parser 转交 tseslint.parser 解析，
    // 但 @typescript-eslint 插件仍需在 .vue 上注册，tsRuleConfigs 才能生效。
    name: 'h5/vue-ts-plugin',
    files: VUE_FILES,
    plugins: { '@typescript-eslint': tseslint.plugin },
  },
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
      'no-restricted-syntax': ['error', ...nativeSyntaxSelectors, ...deepImportSyntaxSelectors],
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
      'no-restricted-syntax': ['error', ...nativeSyntaxSelectors, ...deepImportSyntaxSelectors],
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
      // bridge 是原生对象的唯一出口，这里只豁免原生访问，包内部路径的引用禁令仍然生效。
      'no-restricted-properties': 'off',
      'no-restricted-syntax': ['error', ...deepImportSyntaxSelectors],
    },
  },
]
