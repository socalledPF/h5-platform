import { describe, expect, it, vi } from 'vitest'

vi.mock('@h5/core', async () => {
  const { ref } = await import('vue')
  return { navMode: ref('native') }
})

import { navMode } from '@h5/core'
import { useNavMode } from '../src/useNavMode'

describe('useNavMode', () => {
  it('把 navMode 派生成三个布尔量', () => {
    navMode.value = 'native'
    const nav = useNavMode()

    expect(nav.mode.value).toBe('native')
    expect(nav.isNative.value).toBe(true)
    expect(nav.isH5.value).toBe(false)
    expect(nav.isNone.value).toBe(false)
  })

  it('core 的 navMode 变化时响应式跟随', () => {
    const nav = useNavMode()

    navMode.value = 'h5'
    expect(nav.isH5.value).toBe(true)
    expect(nav.isNative.value).toBe(false)

    navMode.value = 'none'
    expect(nav.isNone.value).toBe(true)
    expect(nav.isH5.value).toBe(false)
  })
})
