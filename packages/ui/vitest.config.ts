import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      reportsDirectory: 'coverage',
      include: ['src/**/*.{ts,vue}'],
      exclude: ['src/index.ts'],
      // 设计文档 12.4：共享包覆盖率 ≥ 80%（实测 语句 98.24 / 分支 88.13 / 函数 96.42 / 行 100）
      thresholds: { statements: 80, branches: 80, functions: 80, lines: 80 },
    },
  },
})
