import { describe, expect, it, vi } from 'vitest'

vi.mock('@h5/core', async () => {
  const { ref } = await import('vue')
  return {
    navMode: ref('native'),
    registerBackHandler: vi.fn(() => () => undefined),
    env: { os: 'web', statusBarHeight: 0, safeAreaTop: 0, safeAreaBottom: 0 },
  }
})

vi.mock('@h5/bridge', () => ({ on: vi.fn(() => () => undefined) }))

import * as hooks from '../src/index'

describe('@h5/hooks 公共出口', () => {
  it('导出冻结契约里的全部组合式函数', () => {
    expect(hooks.PACKAGE_NAME).toBe('@h5/hooks')
    for (const name of [
      'usePageShow',
      'useKeyboard',
      'useSafeArea',
      'useBackGuard',
      'useNavMode',
    ] as const) {
      expect(typeof hooks[name]).toBe('function')
    }
  })
})
