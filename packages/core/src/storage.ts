import { storage as bridgeStorage } from '@h5/bridge'

/**
 * 轻量存储（设计文档 5.5 `storage.*`）：数据由原生跨 WebView 持久化，
 * 浏览器 mock 下由 bridge 的 mock 后端承接。
 *
 * 刻意不直接读写 localStorage：跨 WebView 一致性与“原生登出后 H5 仍持有旧数据”
 * 的问题都由原生侧统一处理。
 */
export const storage = {
  /** 读取；失败（不在 App 内且未开 mock）视为无数据，不让存储拖垮页面。 */
  async get<T = unknown>(key: string): Promise<T | null> {
    try {
      return await bridgeStorage.get<T>(key)
    } catch {
      return null
    }
  },

  /** 写入；失败只记录不抛出。 */
  async set(key: string, value: unknown): Promise<void> {
    try {
      await bridgeStorage.set(key, value)
    } catch {
      // 存储失败不影响主流程
    }
  },

  /** 删除：协议只有 set/get，用写入 null 表示删除。 */
  async remove(key: string): Promise<void> {
    try {
      await bridgeStorage.set(key, null)
    } catch {
      // 同上
    }
  },
}
