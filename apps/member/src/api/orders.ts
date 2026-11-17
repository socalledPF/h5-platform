import { ApiError, get, post } from '@h5/core'
import type { RequestConfig } from '@h5/core'

/** 订单状态：与后端状态枚举一一对应。 */
export type OrderStatus = 'pending' | 'paid' | 'shipped' | 'closed'

/** 列表项：只保留列表需要的字段。 */
export interface OrderSummary {
  id: string
  title: string
  /** 单位：分，避免浮点误差；展示时由页面换算。 */
  amount: number
  status: OrderStatus
  createdAt: string
}

/** 详情：列表字段 + 收货信息与备注。 */
export interface OrderDetail extends OrderSummary {
  receiver: string
  phone: string
  address: string
  remark: string
}

export interface OrderPageQuery {
  page: number
  size: number
}

/** 分页信封：`{ code, data, msg }` 由 @h5/core 的拦截器解包，这里只描述 data 的形状。 */
export interface OrderListResult {
  total: number
  list: OrderSummary[]
}

/**
 * 静默错误 + 不重试：页面自己决定降级（浏览器演示数据 / 空态 / 失败提示），
 * 避免全局 Toast 在首屏就弹一条用户无法处理的错误（设计文档 6.3）。
 */
const QUIET: RequestConfig = { errorMode: 'silent', retry: 0 }

/**
 * 结构异常的错误码：-1 表示「H5 侧错误」，与 @h5/core 的 NETWORK_ERROR_CODE 语义一致
 * （core 未从包入口导出该常量，这里按同一约定取值）。
 */
const SHAPE_ERROR_CODE = -1

/**
 * 结构校验（设计文档 6.3）：`@h5/core` 对**非信封结构**的响应原样放行
 * （`unwrap()` 的 `if (!isEnvelope(payload)) return payload`），这对二进制/纯文本接口是正确的，
 * 但本地没有后端时 Vite dev server 会把 `/api/**` 回成 `200 text/html` 的 index.html，
 * 于是 `get<T>()` 的类型断言会拿到一个字符串。类型断言在运行期不成立，所以业务边界必须自己校验形状：
 * 形状不符就按失败抛出，让调用方走与网络失败完全相同的降级分支，绝不把 `undefined` 写进状态。
 */
function isOrderSummary(value: unknown): value is OrderSummary {
  if (typeof value !== 'object' || value === null) return false
  const order = value as Partial<OrderSummary>
  return (
    typeof order.id === 'string' &&
    typeof order.title === 'string' &&
    typeof order.amount === 'number' &&
    typeof order.status === 'string' &&
    typeof order.createdAt === 'string'
  )
}

function isOrderListResult(value: unknown): value is OrderListResult {
  if (typeof value !== 'object' || value === null) return false
  const result = value as { total?: unknown; list?: unknown }
  return (
    Number.isFinite(result.total) && Array.isArray(result.list) && result.list.every(isOrderSummary)
  )
}

function isOrderDetail(value: unknown): value is OrderDetail {
  if (!isOrderSummary(value)) return false
  const detail = value as Partial<OrderDetail>
  return (
    typeof detail.remark === 'string' &&
    typeof detail.receiver === 'string' &&
    typeof detail.phone === 'string' &&
    typeof detail.address === 'string'
  )
}

function malformedShape(label: string): ApiError {
  return new ApiError(SHAPE_ERROR_CODE, `${label}接口返回结构异常`)
}

/**
 * 订单列表；返回结构不合法时以 ApiError 失败，调用方按「无数据」降级。
 *
 * `options` 叠加在默认的静默配置之上：首屏页面传 `{ firstScreen: true }`，
 * core 才会把这次响应计入「首屏接口返回」这一监控阶段（设计文档 10.1）。
 */
export async function listOrders(
  query: OrderPageQuery,
  options: RequestConfig = {},
): Promise<OrderListResult> {
  const payload = await get<unknown>(
    '/api/member/orders',
    { page: query.page, size: query.size },
    { ...QUIET, ...options },
  )
  if (!isOrderListResult(payload)) throw malformedShape('订单列表')
  return payload
}

/** 订单详情；同样校验形状，避免把 HTML 当成订单对象渲染。 */
export async function getOrderDetail(id: string): Promise<OrderDetail> {
  const payload = await get<unknown>(
    `/api/member/orders/${encodeURIComponent(id)}`,
    undefined,
    QUIET,
  )
  if (!isOrderDetail(payload)) throw malformedShape('订单详情')
  return payload
}

/** 保存备注（非幂等，禁止重试）。 */
export function saveOrderRemark(id: string, remark: string): Promise<void> {
  return post<void>(`/api/member/orders/${encodeURIComponent(id)}/remark`, { remark }, QUIET)
}
