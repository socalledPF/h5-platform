/**
 * 包体积预算校验（设计文档 12.4「包体积预算」）。
 *
 * 构建后读取每个 app 的 dist，任一项超过预算即失败，防止入口包/总包体积无声膨胀。
 * 预算只是回归守卫：数值取自 2026-11 的实测值并上浮约 10%，不是优化目标。
 * 需要瘦身时请先改代码，再同步下调这里的常量。
 */

import { spawnSync } from 'node:child_process'
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

/** 认不出产物时的统一提示：新命名规则机器猜不出来，只能靠人更新下面的匹配。 */
const RECOGNITION_HINT = '可能是构建产物命名变了，请更新 check-bundle-size.ts 的匹配规则'

/** 匹配规则没命中产物：绝不能当成 0 kB 继续比较，否则闸门会静默变绿。 */
class UnrecognizedArtifactError extends Error {}

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

  // 匹配规则没命中就是「量不出来」，不是「体积为 0」：0 > 预算恒为 false，
  // 一旦 vite.mjs 的命名变了，这道闸门会报告 0 kB 并通过。
  if (entryFiles.length === 0) {
    throw new UnrecognizedArtifactError(
      `apps/${app}/dist/assets 中无法识别入口产物（期望 index-<hash>.js），${RECOGNITION_HINT}`,
    )
  }
  if (legacyFiles.length === 0) {
    throw new UnrecognizedArtifactError(
      `apps/${app}/dist/assets 中无法识别 legacy 产物（期望 *-legacy-*.js），${RECOGNITION_HINT}`,
    )
  }

  const entryBytes = sumBytes(assetsDir, entryFiles)
  // 兜底：真实构建不可能产出 0 字节的入口包，出现就说明匹配规则命中了别的东西。
  if (entryBytes <= 0) {
    throw new UnrecognizedArtifactError(
      `apps/${app}/dist/assets 入口产物合计 0 kB，${RECOGNITION_HINT}`,
    )
  }

  return {
    app,
    entryJsKb: toKb(entryBytes),
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

/** 有 dist 的 app 目录名，来自文件系统：新 app 不需要先被人想到才被量到。 */
function listAppsWithDist(): string[] {
  return readdirSync(join(ROOT, 'apps'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(ROOT, 'apps', entry.name, 'dist')))
    .map((entry) => entry.name)
    .sort()
}

function readHeadCommitMs(): number {
  const result = spawnSync('git', ['log', '-1', '--format=%ct'], { cwd: ROOT, encoding: 'utf8' })
  if (result.status !== 0) return Number.NaN
  const seconds = Number.parseInt(result.stdout.trim(), 10)
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : Number.NaN
}

/**
 * dist/assets 下最早的文件 mtime。与 deploy.ts 的陈旧判定同口径（理由见那里的注释）：
 * 取「最早」而不是「最新」，任何一个刚写过的文件都无法把陈旧产物伪装成新构建。
 * 没有任何文件时返回 NaN。
 */
function oldestAssetMtime(app: string): number {
  let oldest = Number.POSITIVE_INFINITY
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
        continue
      }
      if (!entry.isFile()) continue
      const { mtimeMs } = statSync(full)
      if (mtimeMs < oldest) oldest = mtimeMs
    }
  }
  walk(join(ROOT, 'apps', app, 'dist', 'assets'))
  return oldest
}

function formatTime(milliseconds: number): string {
  const date = new Date(milliseconds)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  )
}

/**
 * 陈旧产物只告警、不失败：这里只负责回答「量出来的数是不是当前代码的」，
 * 真正会拦住发布的是 deploy.ts 的同类检查。CI 全新 checkout 不会触发，本地也不会被误伤。
 */
function warnIfStale(apps: readonly string[]): void {
  const commitMs = readHeadCommitMs()
  if (!Number.isFinite(commitMs)) return

  for (const app of apps) {
    const builtMs = oldestAssetMtime(app)
    if (!Number.isFinite(builtMs) || builtMs >= commitMs) continue
    console.warn(
      `[size:check] 警告：apps/${app}/dist 的 assets 早于 HEAD 提交（dist 构建于 ${formatTime(builtMs)}，` +
        `HEAD 提交于 ${formatTime(commitMs)}），上面的数字可能不是当前代码的，请重新构建后再检查。`,
    )
  }
}

function main(): number {
  // app 列表来自文件系统，而不是 BUDGETS 的键：否则新加的 apps/xxx 只要没人登记预算，
  // 就会被这道闸门静默跳过（报告「全部在预算内」，其实从没量过它）。
  const apps = listAppsWithDist()
  const unbudgeted = apps.filter((app) => BUDGETS[app] === undefined)

  if (unbudgeted.length > 0) {
    for (const app of unbudgeted) {
      console.error(`[size:check] app ${app} 缺少体积预算，请在 BUDGETS 里登记：`)
      console.error(`  '${app}': { entryJsKb: …, legacyJsKb: …, totalJsKb: …, totalCssKb: … },`)
    }
    console.error('[size:check] 新 app 必须有预算才放行，否则它的体积永远不会被发现。')
    return 2
  }

  const missing = Object.keys(BUDGETS).filter(
    (app) => !existsSync(join(ROOT, 'apps', app, 'dist', 'assets')),
  )

  if (missing.length > 0) {
    console.error(
      `[size:check] 未找到构建产物：${missing.map((app) => `apps/${app}/dist`).join('、')}`,
    )
    console.error('[size:check] 请先运行 `pnpm build` 再检查包体积。')
    return 2
  }

  let measurements: Measurement[]
  try {
    measurements = apps.map((app) => measure(app))
  } catch (error) {
    if (!(error instanceof UnrecognizedArtifactError)) throw error
    console.error(`[size:check] ${error.message}`)
    console.error('[size:check] 无法量出体积按失败处理（exit 2），不当作 0 kB 放行。')
    return 2
  }
  warnIfStale(apps)
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
