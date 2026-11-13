import h5 from '@h5/config/eslint'

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '**/.turbo/**',
      '**/components.d.ts',
      'pnpm-lock.yaml',
    ],
  },
  ...h5,
]
