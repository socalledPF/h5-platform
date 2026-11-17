import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      reportsDirectory: 'coverage',
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts'],
      // 设计文档 12.4：共享包覆盖率 ≥ 80%（实测 语句 96.77 / 分支 85.29 / 函数 95.65 / 行 97.64）
      thresholds: { statements: 80, branches: 80, functions: 80, lines: 80 },
    },
  },
})
