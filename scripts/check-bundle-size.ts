/**
 * 包体积预算校验（设计文档 12.4「包体积预算」）。
 *
 * 构建后读取每个 app 的 dist，任一项超过预算即失败，防止入口包/总包体积无声膨胀。
 * 预算只是回归守卫：数值取自 2026-11 的实测值并上浮约 10%，不是优化目标。
 * 需要瘦身时请先改代码，再同步下调这里的常量。
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

/** 单个 app 的体积预算，单位 kB（1024 字节）。 */
type Budget = {
  /** 入口 JS 合计：dist/assets/index-*.js（不含 legacy 产物） */
  entryJsKb: number
  /** legacy 兜底产物合计：*-legacy-*.js（含 polyfills） */
  legacyJsKb: number
  /** dist/assets 下全部 JS 合计 */
  totalJsKb: number
  /** dist/assets 下全部 CSS 合计 */
  totalCssKb: number
}

/**
 * 回归守卫，不是优化目标：每个值都比实测值高约 10%，只用来拦住「悄悄变大」。
 * 实测（2026-11，`pnpm build` 后）：
 *   member            入口 214.5 / legacy 1361.8 / JS 2338.9 / CSS 85.7
 *   activity          入口 208.9 / legacy 1287.9 / JS 2233.8 / CSS 70.5
 *   bridge-playground 入口 208.5 / legacy 1295.9 / JS 2245.6 / CSS 71.6
 */
const BUDGETS: Record<string, Budget> = {
  member: { entryJsKb: 240, legacyJsKb: 1500, totalJsKb: 2600, totalCssKb: 100 },
  activity: { entryJsKb: 230, legacyJsKb: 1420, totalJsKb: 2460, totalCssKb: 80 },
  'bridge-playground': { entryJsKb: 230, legacyJsKb: 1430, totalJsKb: 2470, totalCssKb: 80 },
}

type Measurement = {
  app: string
  entryJsKb: number
  entryJsGzipKb: number
  legacyJsKb: number
  totalJsKb: number
  totalJsGzipKb: number
  totalCssKb: number
  totalCssGzipKb: number
}

type Breach = { app: string; label: string; actualKb: number; budgetKb: number }

const COMPARED_FIELDS: readonly { key: keyof Budget; label: string }[] = [
  { key: 'entryJsKb', label: '入口 JS' },
  { key: 'legacyJsKb', label: 'legacy JS' },
  { key: 'totalJsKb', label: 'JS 合计' },
  { key: 'totalCssKb', label: 'CSS 合计' },
]

const ROOT = join(import.meta.dirname, '..')

const toKb = (bytes: number): number => Math.round((bytes / 1024) * 10) / 10

function sumBytes(dir: string, files: readonly string[]): number {
  return files.reduce((total, file) => total + statSync(join(dir, file)).size, 0)
}

function sumGzipBytes(dir: string, files: readonly string[]): number {
  return files.reduce((total, file) => total + gzipSync(readFileSync(join(dir, file))).length, 0)
}

function measure(app: string): Measurement {
  const assetsDir = join(ROOT, 'apps', app, 'dist', 'assets')
  const files = readdirSync(assetsDir)
  const jsFiles = files.filter((file) => file.endsWith('.js'))
  const cssFiles = files.filter((file) => file.endsWith('.css'))
  const isLegacy = (file: string): boolean => file.includes('-legacy-')
  const entryFiles = jsFiles.filter((file) => /^index-[^.]+\.js$/.test(file) && !isLegacy(file))
  const legacyFiles = jsFiles.filter(isLegacy)

  return {
    app,
    entryJsKb: toKb(sumBytes(assetsDir, entryFiles)),
    entryJsGzipKb: toKb(sumGzipBytes(assetsDir, entryFiles)),
    legacyJsKb: toKb(sumBytes(assetsDir, legacyFiles)),
    totalJsKb: toKb(sumBytes(assetsDir, jsFiles)),
    totalJsGzipKb: toKb(sumGzipBytes(assetsDir, jsFiles)),
    totalCssKb: toKb(sumBytes(assetsDir, cssFiles)),
    totalCssGzipKb: toKb(sumGzipBytes(assetsDir, cssFiles)),
  }
}

function renderTable(headers: readonly string[], rows: readonly string[][]): string {
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => (row[index] ?? '').length)),
  )
  const line = (cells: readonly string[]): string =>
    `  ${cells.map((cell, index) => cell.padEnd(widths[index] ?? 0)).join('  ')}`.trimEnd()
  return [line(headers), ...rows.map(line)].join('\n')
}

function main(): number {
  const apps = Object.keys(BUDGETS)
  const missing = apps.filter((app) => !existsSync(join(ROOT, 'apps', app, 'dist', 'assets')))

  if (missing.length > 0) {
    console.error(
      `[size:check] 未找到构建产物：${missing.map((app) => `apps/${app}/dist`).join('、')}`,
    )
    console.error('[size:check] 请先运行 `pnpm build` 再检查包体积。')
    return 2
  }

  const measurements = apps.map((app) => measure(app))
  const breaches: Breach[] = []

  for (const measurement of measurements) {
    const budget = BUDGETS[measurement.app]
    if (!budget) continue
    for (const field of COMPARED_FIELDS) {
      const actualKb = measurement[field.key]
      const budgetKb = budget[field.key]
      if (actualKb > budgetKb) {
        breaches.push({ app: measurement.app, label: field.label, actualKb, budgetKb })
      }
    }
  }

  const table = renderTable(
    ['app', '入口 JS', '入口 gzip', 'legacy JS', 'JS 合计', 'JS gzip', 'CSS 合计', 'CSS gzip'],
    measurements.map((measurement) => [
      measurement.app,
      `${measurement.entryJsKb} kB`,
      `${measurement.entryJsGzipKb} kB`,
      `${measurement.legacyJsKb} kB`,
      `${measurement.totalJsKb} kB`,
      `${measurement.totalJsGzipKb} kB`,
      `${measurement.totalCssKb} kB`,
      `${measurement.totalCssGzipKb} kB`,
    ]),
  )

  if (breaches.length === 0) {
    console.log('[size:check] 包体积在预算内：')
    console.log(table)
    return 0
  }

  console.error('[size:check] 包体积超出预算：')
  console.error(table)
  console.error('')
  console.error(
    renderTable(
      ['app', '项目', '实测', '预算', '超出'],
      breaches.map((breach) => [
        breach.app,
        breach.label,
        `${breach.actualKb} kB`,
        `${breach.budgetKb} kB`,
        `${toKb((breach.actualKb - breach.budgetKb) * 1024)} kB`,
      ]),
    ),
  )
  console.error('')
  console.error(
    '[size:check] 请先排查体积增长来源，确属预期再上调 scripts/check-bundle-size.ts 的预算。',
  )
  return 1
}

process.exitCode = main()
