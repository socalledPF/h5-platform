import { describe, expect, it } from 'vitest'

import { usePagedList } from '../src/composables/usePagedList'
import type { PagedResult } from '../src/composables/usePagedList'

interface Row {
  id: string
}

const TOTAL = 20
const SIZE = 2

function pageOf(page: number, tag = ''): PagedResult<Row> {
  return {
    total: TOTAL,
    list: Array.from({ length: SIZE }, (_, index) => ({ id: `${tag}p${page}-${index}` })),
  }
}

/** 让所有已排队的微任务跑完（请求都要显式放行，所以不会误放行）。 */
async function flush(): Promise<void> {
  for (let index = 0; index < 4; index += 1) await Promise.resolve()
}

/**
 * 请求记录器：每次 fetchPage 都挂起，由用例按页码放行，
 * 这样才能精确构造「晚到响应」与「在途时刷新」的场景。
 */
function recorder() {
  const pages: number[] = []
  const gates: { page: number; done: boolean; resolve: (value: PagedResult<Row>) => void }[] = []

  return {
    pages,
    fetchPage(page: number): Promise<PagedResult<Row>> {
      pages.push(page)
      let release!: (value: PagedResult<Row>) => void
      const promise = new Promise<PagedResult<Row>>((resolve) => {
        release = resolve
      })
      gates.push({ page, done: false, resolve: release })
      return promise
    },
    /** 放行最早一个还挂着的、属于 page 的请求 */
    resolvePage(page: number, value?: PagedResult<Row>): void {
      const gate = gates.find((entry) => entry.page === page && !entry.done)
      if (gate === undefined) throw new Error(`第 ${page} 页没有在途请求`)
      gate.done = true
      gate.resolve(value ?? pageOf(page))
    },
  }
}

describe('usePagedList', () => {
  it('van-list 先把 loading 置 true 再 emit load：仍然必须发起请求', async () => {
    const fetcher = recorder()
    const paged = usePagedList<Row>({ size: SIZE, fetchPage: fetcher.fetchPage })

    // van-list 的 check() 先写 loading 再 emit('load')，这里如实复现
    paged.loading.value = true
    const loading = paged.loadMore()
    fetcher.resolvePage(1)
    await loading

    expect(fetcher.pages).toEqual([1])
    expect(paged.items.value).toHaveLength(SIZE)
    expect(paged.loading.value).toBe(false)
  })

  it('一页取完后继续触底：每页正好请求一次，直到取完', async () => {
    const fetcher = recorder()
    const paged = usePagedList<Row>({ size: SIZE, fetchPage: fetcher.fetchPage })

    // total=20 / size=2 => 10 页
    for (let page = 1; page <= 10; page += 1) {
      const loading = paged.loadMore()
      fetcher.resolvePage(page)
      await loading
    }

    expect(fetcher.pages).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(paged.items.value).toHaveLength(TOTAL)
    expect(paged.finished.value).toBe(true)

    // 已经 finished：再触底不再请求
    await paged.loadMore()
    expect(fetcher.pages).toHaveLength(10)
  })

  it('重叠触底：不重复取同一页，也不丢掉待办的那一次', async () => {
    const fetcher = recorder()
    const paged = usePagedList<Row>({ size: SIZE, fetchPage: fetcher.fetchPage })

    const first = paged.loadMore()
    const second = paged.loadMore()
    expect(fetcher.pages).toEqual([1])

    fetcher.resolvePage(1)
    await flush()
    // 第一个请求结束后补跑待办：只补一次，且是第 2 页
    expect(fetcher.pages).toEqual([1, 2])

    fetcher.resolvePage(2)
    await Promise.all([first, second])

    expect(fetcher.pages).toEqual([1, 2])
    expect(paged.items.value.map((row) => row.id)).toEqual(['p1-0', 'p1-1', 'p2-0', 'p2-1'])
  })

  it('在途时 refresh：最终是第一页数据，晚到的第二页响应被丢弃', async () => {
    const fetcher = recorder()
    const paged = usePagedList<Row>({ size: SIZE, fetchPage: fetcher.fetchPage })

    const first = paged.loadMore()
    fetcher.resolvePage(1)
    await first
    expect(paged.items.value).toHaveLength(SIZE)

    // 第 2 页在途
    const second = paged.loadMore()
    expect(fetcher.pages).toEqual([1, 2])

    // 刷新：必须真的发出第 1 页请求，而不是被 loading 挡掉后停在空列表
    const refreshing = paged.refresh()
    expect(fetcher.pages).toEqual([1, 2, 1])
    expect(paged.items.value).toEqual([])

    // 第 2 页的晚到响应属于旧代数：不能写进刚清空的列表
    fetcher.resolvePage(2, pageOf(2, 'stale-'))
    await flush()
    expect(paged.items.value).toEqual([])

    // 新一轮的第 1 页正常落库
    fetcher.resolvePage(1, pageOf(1, 'fresh-'))
    await Promise.all([second, refreshing])

    expect(paged.items.value.map((row) => row.id)).toEqual(['fresh-p1-0', 'fresh-p1-1'])
    expect(paged.loading.value).toBe(false)
    expect(paged.finished.value).toBe(false)
  })

  it('代数变化后，旧请求的晚到响应被彻底丢弃', async () => {
    const fetcher = recorder()
    const paged = usePagedList<Row>({ size: SIZE, fetchPage: fetcher.fetchPage })

    const first = paged.loadMore()
    const refreshing = paged.refresh()
    expect(fetcher.pages).toEqual([1, 1])

    // 旧代数的响应晚到
    fetcher.resolvePage(1, pageOf(1, 'old-'))
    await flush()
    expect(paged.items.value).toEqual([])

    fetcher.resolvePage(1, pageOf(1, 'new-'))
    await Promise.all([first, refreshing])
    expect(paged.items.value.map((row) => row.id)).toEqual(['new-p1-0', 'new-p1-1'])
  })

  it('失败保留已加载数据并停止触底，loading 不会卡住', async () => {
    const paged = usePagedList<Row>({
      size: SIZE,
      fetchPage: async (page) => {
        if (page === 2) throw new Error('boom')
        return pageOf(page)
      },
    })

    await paged.loadMore()
    expect(paged.items.value).toHaveLength(SIZE)

    await paged.loadMore()
    expect(paged.items.value).toHaveLength(SIZE)
    expect(paged.finished.value).toBe(true)
    expect(paged.loading.value).toBe(false)
  })
})
