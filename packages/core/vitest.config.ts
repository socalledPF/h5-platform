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
      // index.ts 只有 re-export、types.ts 只有类型声明，两者没有可执行语句
      exclude: ['src/index.ts', 'src/types.ts'],
      thresholds: { statements: 80, branches: 80, functions: 80, lines: 80 },
    },
  },
})
