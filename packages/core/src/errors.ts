import { isAxiosError } from 'axios'

/** 网络层错误（无响应 / 超时 / 断网）的统一错误码。 */
export const NETWORK_ERROR_CODE = -1

/** 无法归类的错误码。 */
export const UNKNOWN_ERROR_CODE = -2

/**
 * 请求层统一错误（设计文档 6.3）。
 *
 * `code` 优先取后端业务码 `{ code, data, msg }` 中的 code，其次取 HTTP 状态码；
 * 网络层失败与未知异常分别用本模块的负数错误码，与 Bridge 的 `-1 / -2` 语义一致。
 */
export class ApiError extends Error {
  readonly code: number
  readonly data?: unknown

  constructor(code: number, message: string, data?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    if (data !== undefined) this.data = data
  }
}

interface ErrorPayload {
  code?: unknown
  msg?: unknown
  message?: unknown
}

/** 把任意异常规整为 ApiError，保证业务只需处理一种错误类型。 */
export function normalizeError(error: unknown): ApiError {
  if (error instanceof ApiError) return error

  if (isAxiosError(error)) {
    const response = error.response
    if (response !== undefined) {
      const payload = toPayload(response.data)
      const code = typeof payload?.code === 'number' ? payload.code : response.status
      return new ApiError(code, readMessage(payload) ?? error.message, response.data)
    }
    if (error.code === 'ERR_CANCELED') {
      return new ApiError(NETWORK_ERROR_CODE, '请求已取消')
    }
    return new ApiError(NETWORK_ERROR_CODE, error.message || '网络异常')
  }

  if (error instanceof Error) return new ApiError(UNKNOWN_ERROR_CODE, error.message)
  if (typeof error === 'string') return new ApiError(UNKNOWN_ERROR_CODE, error)
  return new ApiError(UNKNOWN_ERROR_CODE, '未知错误', error)
}

function toPayload(data: unknown): ErrorPayload | null {
  return typeof data === 'object' && data !== null ? (data as ErrorPayload) : null
}

/** 后端错误文案字段可能是 msg / message，都不是字符串时返回 null。 */
export function readMessage(payload: ErrorPayload | null): string | null {
  if (payload === null) return null
  if (typeof payload.msg === 'string' && payload.msg !== '') return payload.msg
  if (typeof payload.message === 'string' && payload.message !== '') return payload.message
  return null
}
