import type { OrderDetail, OrderSummary } from './orders'

/**
 * 浏览器演示数据：只在「不在 App 内且接口不可用」时使用，让本地开发和 E2E 能看到页面，
 * App 内永远走真实接口（见各视图里的 `env.isApp` 分支）。
 */
export const DEMO_ORDERS: OrderSummary[] = [
  {
    id: 'A1001',
    title: '年度会员礼盒',
    amount: 19900,
    status: 'paid',
    createdAt: '2026-11-01 10:12:00',
  },
  {
    id: 'A1002',
    title: '门店咖啡兑换券',
    amount: 3200,
    status: 'shipped',
    createdAt: '2026-10-28 19:40:11',
  },
  {
    id: 'A1003',
    title: '会员日 5 折券',
    amount: 0,
    status: 'pending',
    createdAt: '2026-10-20 09:05:32',
  },
  {
    id: 'A1004',
    title: '积分兑换保温杯',
    amount: 1500,
    status: 'closed',
    createdAt: '2026-10-02 16:22:47',
  },
]

/** 详情演示数据；未知 id 用第一条兜底，避免本地点进任意订单都空白。 */
export function demoOrderDetail(id: string): OrderDetail {
  const summary = DEMO_ORDERS.find((order) => order.id === id) ?? DEMO_ORDERS[0]
  return {
    ...summary,
    id,
    receiver: '张小满',
    phone: '138****0000',
    address: '杭州市余杭区文一西路 1 号 3 幢 501',
    remark: '',
  }
}
