import { AxiosError } from 'axios'
import type { AxiosAdapter, AxiosResponse, InternalAxiosRequestConfig } from 'axios'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '../src/auth'
import { ApiError, normalizeError } from '../src/errors'
import { get, post, request, resetRequestState, setErrorNotifier, withCancel } from '../src/request'

const bridgeMocks = vi.hoisted(() => ({
  refreshToken: vi.fn(),
  login: vi.fn(),
  getToken: vi.fn(),
}))

vi.mock('@h5/bridge', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@h5/bridge')>()
  return {
    ...actual,
    auth: {
      ...actual.auth,
      refreshToken: bridgeMocks.refreshToken,
      login: bridgeMocks.login,
      getToken: bridgeMocks.getToken,
    },
  }
})

type AdapterReply = { status: number; data: unknown }

/** 造一个不用网络的 axios adapter：按调用顺序返回预设结果或抛出网络错误。 */
function createAdapter(
  handler: (config: InternalAxiosRequestConfig, call: number) => AdapterReply,
) {
  const calls: InternalAxiosRequestConfig[] = []
  const adapter: AxiosAdapter = async (config) => {
    calls.push(config)
    const reply = handler(config, calls.length)
    const response: AxiosResponse = {
      data: reply.data,
      status: reply.status,
      statusText: '',
      headers: {},
      config,
    }
    if (reply.status >= 200 && reply.status < 300) return response
    throw new AxiosError(`status ${reply.status}`, String(reply.status), config, null, response)
  }
  return { adapter, calls }
}

/** 模拟断网：没有 response 的 AxiosError。 */
function networkError(config: InternalAxiosRequestConfig): never {
  throw new AxiosError('Network Error', 'ERR_NETWORK', config)
}

beforeEach(() => {
  resetRequestState()
  useAuthStore().clear()
  bridgeMocks.refreshToken.mockReset()
  bridgeMocks.login.mockReset()
  bridgeMocks.getToken.mockReset()
})

afterEach(() => {
  resetRequestState()
  vi.restoreAllMocks()
})

describe('响应解包（设计文档 6.3）', () => {
  it('code === 0 时返回 data', async () => {
    const { adapter } = createAdapter(() => ({ status: 200, data: { code: 0, data: { id: 1 } } }))

    await expect(request({ url: '/api/one', adapter })).resolves.toEqual({ id: 1 })
  })

  it('非信封结构原样返回', async () => {
    const { adapter } = createAdapter(() => ({ status: 200, data: [1, 2, 3] }))

    await expect(get('/api/list', undefined, { adapter })).resolves.toEqual([1, 2, 3])
  })

  it('code !== 0 抛 ApiError 并带上业务码与文案', async () => {
    const { adapter } = createAdapter(() => ({
      status: 200,
      data: { code: 40001, msg: '余额不足', data: { balance: 0 } },
    }))
    setErrorNotifier(() => undefined)

    await expect(request({ url: '/api/pay', adapter })).rejects.toMatchObject({
      name: 'ApiError',
      code: 40001,
      message: '余额不足',
    })
  })

  it('HTTP 失败按状态码收敛成 ApiError', async () => {
    const { adapter } = createAdapter(() => ({ status: 500, data: { code: 500, msg: '服务异常' } }))
    setErrorNotifier(() => undefined)

    await expect(request({ url: '/api/boom', adapter })).rejects.toMatchObject({
      code: 500,
      message: '服务异常',
    })
  })
})

describe('错误提示策略（设计文档 6.3 errorMode）', () => {
  const failing = (): ReturnType<typeof createAdapter> =>
    createAdapter(() => ({ status: 200, data: { code: 1, msg: '业务失败' } }))

  it('默认 toast 走注入的 notifier', async () => {
    const notifier = vi.fn()
    setErrorNotifier(notifier)
    const { adapter } = failing()

    await expect(request({ url: '/api/x', adapter })).rejects.toBeInstanceOf(ApiError)
    expect(notifier).toHaveBeenCalledWith('业务失败')
  })

  it('silent 不提示用户', async () => {
    const notifier = vi.fn()
    setErrorNotifier(notifier)
    const { adapter } = failing()

    await expect(request({ url: '/api/x', adapter, errorMode: 'silent' })).rejects.toBeInstanceOf(
      ApiError,
    )
    expect(notifier).not.toHaveBeenCalled()
  })

  it('custom 交给业务自行处理', async () => {
    const notifier = vi.fn()
    setErrorNotifier(notifier)
    const { adapter } = failing()

    await expect(request({ url: '/api/x', adapter, errorMode: 'custom' })).rejects.toBeInstanceOf(
      ApiError,
    )
    expect(notifier).not.toHaveBeenCalled()
  })

  it('未注入 notifier 时退化为 console.warn', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { adapter } = failing()

    await expect(request({ url: '/api/x', adapter })).rejects.toBeInstanceOf(ApiError)
    expect(warn).toHaveBeenCalled()
  })
})

describe('401 并发刷新（设计文档 6.2）', () => {
  it('两个并发 401 只刷新一次，并各自重放', async () => {
    bridgeMocks.refreshToken.mockResolvedValue({ token: 'token-new', expireAt: 1 })
    bridgeMocks.getToken.mockResolvedValue({ token: 'token-new', expireAt: 1 })
    useAuthStore().setToken('token-old', 0)

    const { adapter, calls } = createAdapter((config) =>
      config.headers.get('Authorization') === 'Bearer token-new'
        ? { status: 200, data: { code: 0, data: config.url } }
        : { status: 401, data: { code: 401, msg: 'unauthorized' } },
    )

    const [first, second] = await Promise.all([
      request<string>({ url: '/api/a', adapter }),
      request<string>({ url: '/api/b', adapter }),
    ])

    expect(bridgeMocks.refreshToken).toHaveBeenCalledTimes(1)
    expect(first).toBe('/api/a')
    expect(second).toBe('/api/b')
    expect(calls).toHaveLength(4)
    expect(useAuthStore().token).toBe('token-new')
  })

  it('刷新失败时走原生登录再重放', async () => {
    bridgeMocks.refreshToken.mockRejectedValue(new Error('refresh failed'))
    bridgeMocks.login.mockResolvedValue(undefined)
    bridgeMocks.getToken.mockResolvedValue({ token: 'token-login', expireAt: 1 })

    const { adapter, calls } = createAdapter((config) =>
      config.headers.get('Authorization') === 'Bearer token-login'
        ? { status: 200, data: { code: 0, data: 'ok' } }
        : { status: 401, data: { code: 401 } },
    )

    await expect(request({ url: '/api/a', adapter })).resolves.toBe('ok')
    expect(bridgeMocks.login).toHaveBeenCalledTimes(1)
    expect(calls).toHaveLength(2)
  })

  it('重放后仍 401 时不再重试（_retried 防死循环）', async () => {
    bridgeMocks.refreshToken.mockResolvedValue({ token: 'token-new', expireAt: 1 })
    setErrorNotifier(() => undefined)

    const { adapter, calls } = createAdapter(() => ({ status: 401, data: { code: 401 } }))

    await expect(request({ url: '/api/a', adapter })).rejects.toMatchObject({ code: 401 })
    expect(calls).toHaveLength(2)
  })

  it('刷新与登录都失败时以 ApiError 拒绝', async () => {
    bridgeMocks.refreshToken.mockRejectedValue(new Error('refresh failed'))
    bridgeMocks.login.mockRejectedValue(new Error('login canceled'))
    setErrorNotifier(() => undefined)

    const { adapter } = createAdapter(() => ({ status: 401, data: { code: 401 } }))

    await expect(request({ url: '/api/a', adapter })).rejects.toBeInstanceOf(ApiError)
  })
})

describe('网络错误重试（设计文档 6.3）', () => {
  it('GET 在网络错误时重试一次', async () => {
    const configs: InternalAxiosRequestConfig[] = []
    const adapter: AxiosAdapter = async (config) => {
      configs.push(config)
      if (configs.length === 1) networkError(config)
      return { data: { code: 0, data: 'ok' }, status: 200, statusText: '', headers: {}, config }
    }

    await expect(get('/api/a', undefined, { adapter })).resolves.toBe('ok')
    expect(configs).toHaveLength(2)
  })

  it('POST 不自动重试，避免重复提交', async () => {
    let calls = 0
    const adapter: AxiosAdapter = async (config) => {
      calls += 1
      networkError(config)
    }
    setErrorNotifier(() => undefined)

    await expect(post('/api/a', { id: 1 }, { adapter })).rejects.toMatchObject({ code: -1 })
    expect(calls).toBe(1)
  })

  it('retry: 0 关闭自动重试', async () => {
    let calls = 0
    const adapter: AxiosAdapter = async (config) => {
      calls += 1
      networkError(config)
    }
    setErrorNotifier(() => undefined)

    await expect(get('/api/a', undefined, { adapter, retry: 0 })).rejects.toMatchObject({
      code: -1,
    })
    expect(calls).toBe(1)
  })
})

describe('withCancel（设计文档 6.3）', () => {
  it('abort 后请求以 ApiError 取消', async () => {
    setErrorNotifier(() => undefined)
    const adapter: AxiosAdapter = () => new Promise<AxiosResponse>(() => undefined)

    const { promise, abort } = withCancel((signal) =>
      request({ url: '/api/slow', adapter, signal }),
    )
    abort()

    await expect(promise).rejects.toMatchObject({ name: 'ApiError', message: '请求已取消' })
  })
})

describe('normalizeError', () => {
  it('ApiError 原样返回', () => {
    const error = new ApiError(7, 'x')
    expect(normalizeError(error)).toBe(error)
  })

  it('普通 Error / 字符串 / 未知值都能收敛', () => {
    expect(normalizeError(new Error('boom'))).toMatchObject({ code: -2, message: 'boom' })
    expect(normalizeError('plain')).toMatchObject({ code: -2, message: 'plain' })
    expect(normalizeError(123)).toMatchObject({ name: 'ApiError', data: 123 })
  })

  it('BridgeError 之类的普通 Error 归一为 ApiError', () => {
    const normalized = normalizeError(new Error('bridge down'))
    expect(normalized).toBeInstanceOf(ApiError)
    expect(normalized.code).toBe(-2)
  })
})
