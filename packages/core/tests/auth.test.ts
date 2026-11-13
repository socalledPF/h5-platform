import { configureMock } from '@h5/bridge'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyAuthChange, resetAuthState, setReloadHandler, useAuthStore } from '../src/auth'

beforeEach(() => {
  resetAuthState()
  window.localStorage.clear()
  window.sessionStorage.clear()
})

afterEach(() => {
  setReloadHandler(null)
  vi.restoreAllMocks()
  resetAuthState()
})

describe('登录态（设计文档 6.1：token 只存内存）', () => {
  it('setToken / clear 只改内存，不写任何 Web Storage', () => {
    const auth = useAuthStore()

    auth.setToken('token-a', 123)
    expect(auth.token).toBe('token-a')
    expect(auth.expireAt).toBe(123)

    expect(window.localStorage.length).toBe(0)
    expect(window.sessionStorage.length).toBe(0)

    auth.clear()
    expect(auth.token).toBeNull()
    expect(auth.expireAt).toBe(0)
    expect(window.localStorage.length).toBe(0)
    expect(window.sessionStorage.length).toBe(0)
  })

  it('setToken 传空串等价于清空', () => {
    const auth = useAuthStore()
    auth.setToken('token-a', 5)

    auth.setToken('')

    expect(auth.token).toBeNull()
    expect(auth.expireAt).toBe(0)
  })

  it('登录态视图读取的是实时 store（非快照）', () => {
    const auth = useAuthStore()

    useAuthStore().setToken('token-b', 1)

    expect(auth.token).toBe('token-b')
    expect(auth.expireAt).toBe(1)
  })

  it('ensureToken 内存命中时直接返回', async () => {
    const auth = useAuthStore()
    auth.setToken('token-c')

    await expect(auth.ensureToken()).resolves.toBe('token-c')
  })

  it('ensureToken 内存为空时向原生取 token', async () => {
    configureMock({ getToken: () => ({ token: 'native-token', expireAt: 999 }) })
    const auth = useAuthStore()

    await expect(auth.ensureToken()).resolves.toBe('native-token')
    expect(auth.token).toBe('native-token')
    expect(auth.expireAt).toBe(999)
    expect(window.localStorage.length).toBe(0)
  })

  it('原生取 token 抛错时按未登录处理', async () => {
    configureMock({
      getToken: () => {
        throw new Error('bridge down')
      },
    })
    const auth = useAuthStore()

    await expect(auth.ensureToken()).rejects.toMatchObject({ message: '登录后仍未拿到 token' })
    expect(auth.token).toBeNull()
  })

  it('ensureToken 取不到时唤起原生登录再取', async () => {
    const tokens = [null, { token: 'after-login', expireAt: 5 }]
    const login = vi.fn(() => undefined)
    let index = 0
    configureMock({
      getToken: () => tokens[index++] ?? null,
      handlers: { 'auth.login': login },
    })
    const auth = useAuthStore()

    await expect(auth.ensureToken()).resolves.toBe('after-login')
    expect(login).toHaveBeenCalledTimes(1)
  })
})

describe('auth.change（设计文档 6.1）', () => {
  it('null 清空登录态', () => {
    const auth = useAuthStore()
    auth.setToken('token-a', 1)

    applyAuthChange(null)

    expect(auth.token).toBeNull()
  })

  it('同一 token 只同步，不刷新页面', () => {
    const reload = vi.fn()
    setReloadHandler(reload)
    const auth = useAuthStore()
    auth.setToken('token-a', 1)

    applyAuthChange('token-a')

    expect(auth.token).toBe('token-a')
    expect(reload).not.toHaveBeenCalled()
  })

  it('切换到另一个非空 token（换账号）时整页刷新', () => {
    const reload = vi.fn()
    setReloadHandler(reload)
    const auth = useAuthStore()
    auth.setToken('token-a', 1)

    applyAuthChange('token-b')

    expect(auth.token).toBe('token-b')
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('首次登录（原本为空）不刷新页面', () => {
    const reload = vi.fn()
    setReloadHandler(reload)

    applyAuthChange('token-first')

    expect(useAuthStore().token).toBe('token-first')
    expect(reload).not.toHaveBeenCalled()
  })
})
