import { ref, shallowRef } from 'vue'
import type { Ref, ShallowRef } from 'vue'

/** 一页数据的形状：与后端分页信封的 `data` 一致。 */
export interface PagedResult<T> {
  total: number
  list: T[]
}

export type PageFetcher<T> = (page: number, size: number) => Promise<PagedResult<T>>

export interface UsePagedListOptions<T> {
  /** 每页条数 */
  size: number
  fetchPage: PageFetcher<T>
  /** 每次成功取到数据后回调，用于同步 store 里的总数等外部状态 */
  onLoaded?: (result: PagedResult<T>) => void
}

export interface UsePagedListReturn<T> {
  items: ShallowRef<T[]>
  /** 直接给 van-list 的 `v-model:loading` */
  loading: Ref<boolean>
  finished: Ref<boolean>
  loadMore: () => Promise<void>
  refresh: () => Promise<void>
}

/**
 * 触底分页（设计文档 7.5）：van-list 只负责「什么时候该取下一页」，取哪一页、
 * 什么时候算结束、刷新时怎么作废旧请求，全部收在这里，便于直接单测。
 *
 * 两个必须分开的旗标：
 * - `loading` 由 van-list 与我们共同控制（`v-model:loading`），van-list 在 emit('load')
 *   **之前**就把它置 true，所以任何「loading 为真就跳过」的判断都会吞掉加载；
 * - `inFlight` 只归本模块所有，用来做真正的并发去重。
 *
 * 刷新用代数（generation）失效旧响应：`refresh()` 自增代数，旧代数的响应在落库前被丢弃，
 * 因此不会把上一页的晚到数据写进刚清空的列表。
 */
export function usePagedList<T>({
  size,
  fetchPage,
  onLoaded,
}: UsePagedListOptions<T>): UsePagedListReturn<T> {
  const items = shallowRef<T[]>([])
  const loading = ref(false)
  const finished = ref(false)

  /** 下一个要取的页码 */
  let nextPage = 1
  /** 在途请求数（只归本模块所有，van-list 不控制它） */
  let inFlight = 0
  /** 在途期间又收到 load：合并成一次，当前请求结束后补跑，不丢也不重 */
  let pending = false
  /** 刷新代数：旧代数的响应一律丢弃 */
  let generation = 0

  async function fetchPageInto(page: number, token: number): Promise<void> {
    inFlight += 1
    loading.value = true
    try {
      const result = await fetchPage(page, size)
      // 晚到的旧响应：列表已经被刷新过，丢弃
      if (token !== generation) return
      items.value = page === 1 ? [...result.list] : [...items.value, ...result.list]
      nextPage = page + 1
      finished.value = items.value.length >= result.total
      onLoaded?.(result)
    } catch {
      if (token !== generation) return
      // 失败就停在当前页：保留已有数据，等下一次 refresh 重来
      finished.value = true
    } finally {
      inFlight -= 1
      // 只有当代请求能收掉 loading；旧代请求的收尾会把新一轮的转圈关掉
      if (token === generation) loading.value = false
    }

    if (token === generation && pending && !finished.value) {
      pending = false
      await fetchPageInto(nextPage, token)
    }
  }

  /** van-list 触底 / 首次加载都走这里；在途时只登记一次待办，不丢请求也不重复取同一页。 */
  async function loadMore(): Promise<void> {
    if (finished.value) return
    if (inFlight > 0) {
      pending = true
      return
    }
    await fetchPageInto(nextPage, generation)
  }

  /** 页面重新可见：作废在途请求，回到第一页重新取。 */
  async function refresh(): Promise<void> {
    generation += 1
    nextPage = 1
    finished.value = false
    pending = false
    // 请求真要发出去了才清空：否则界面会先跳空态再回填
    items.value = []
    await fetchPageInto(1, generation)
  }

  return { items, loading, finished, loadMore, refresh }
}
