import h5 from '@h5/config/eslint'

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '**/.turbo/**',
      'docs/.vitepress/dist/**',
      'docs/.vitepress/cache/**',
      '**/components.d.ts',
      'pnpm-lock.yaml',
    ],
  },
  ...h5,
]
