import { describe, expect, it } from 'vitest'

import { PACKAGE_NAME as CORE_PACKAGE_NAME } from '../packages/core/src/index'

describe('workspace foundation', () => {
  it('runs in a jsdom environment', () => {
    const el = document.createElement('div')
    el.textContent = 'h5'
    expect(el.textContent).toBe('h5')
  })

  it('loads a sibling workspace package source through the tsconfig paths', () => {
    expect(CORE_PACKAGE_NAME).toBe('@h5/core')
  })
})
