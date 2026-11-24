#!/usr/bin/env node
/**
 * deploy —— 按应用发布静态资源到 CDN、校验产物、打印上线与回滚指令（设计方案 §9）。
 *
 *   pnpm run deploy --app <name> [--version <v>] [--env dev|test|pre|prod] [--execute --yes]
 *              [--allow-dirty] [--allow-stale]
 *
 * 默认 dry-run：只解析 / 校验 / 打印计划，不访问网络、不上传任何文件。
 * 默认 --env 是 test（不是 prod）：忘记写 --env 不会误发线上，prod 必须显式指定。
 * 真正上传必须同时给出 --execute --yes，并配置 UPLOAD_CMD 模板（见 docs/deployment.md）。
 */

import { execFileSync, execSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const WORKSPACE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const APPS_DIR = join(WORKSPACE_ROOT, 'apps')
const ENVIRONMENTS = ['dev', 'test', 'pre', 'prod'] as const
/** 默认发到 test：忘记写 --env 时绝不能落到线上，prod 必须显式指定。 */
const DEFAULT_ENVIRONMENT = 'test'
const VERSION_PATTERN = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/
/** 应用名会被拼进 CDN 路径与上传命令字符串，与 create-app 同名规则，挡住 ../ 与 shell 元字符。 */
const APP_NAME_PATTERN = /^[a-z][a-z0-9-]{1,30}$/
/** 拒绝发布时最多列出多少条未提交改动，避免刷屏。 */
const DIRTY_LIST_LIMIT = 10

type Environment = (typeof ENVIRONMENTS)[number]

/** §9.3 的环境对照；域名一律用 xxx.com 占位，可用 DEPLOY_*_HOST 覆盖。 */
const ENVIRONMENT_HOSTS: Record<Environment, { entry: string; cdn: string; note: string }> = {
  dev: {
    entry: 'h5-dev.xxx.com',
    cdn: 'cdn-dev.xxx.com',
    note: 'dev 在 §9.3 中是 localhost + 浏览器 mock，发到 dev 域名只用于联调环境',
  },
  test: {
    entry: 'h5-test.xxx.com',
    cdn: 'cdn-test.xxx.com',
    note: '测试包 App 联调，vConsole 默认开启',
  },
  pre: {
    entry: 'h5-pre.xxx.com',
    cdn: 'cdn-pre.xxx.com',
    note: '预发验证，连生产数据，vConsole 用 ?debug=1 开启',
  },
  prod: {
    entry: 'h5.xxx.com',
    cdn: 'cdn.xxx.com',
    note: '线上环境，无调试工具',
  },
}

const HELP = `deploy · 按应用发布到 CDN（设计方案 §9）

注意：必须写成 pnpm run deploy，不能省掉 run。
  pnpm 自带一个同名的 deploy 子命令：省掉 run 的短形式会先被它截走，
  它不认识 --app，于是报 "unexpected argument '--app' found"，命令根本跑不到这个脚本。
  ✖ 省略 run 的短形式
  ✔ pnpm run deploy --app member --allow-dirty

用法
  pnpm run deploy --app <name> [选项]
  pnpm run deploy <name> [选项]

参数
  --app <name>        应用目录名，必须存在于 apps/ 下（也可作为第一个位置参数）
  --version <v>       覆盖 package.json 的版本号，格式 x.y.z[-tag]
  --env <env>         dev | test | pre | prod，默认 ${DEFAULT_ENVIRONMENT}；发 prod 必须显式写 --env prod
  --execute           真正执行上传（默认 dry-run，什么都不做）
  --yes               与 --execute 联用，二次确认上传不可撤销
  --allow-dirty       工作区有未提交改动时也继续（默认拒绝，见「发布前校验」）
  --allow-stale       dist 比 HEAD 提交旧时也继续（默认拒绝，见「发布前校验」）
  --help, -h          显示本帮助

发布前校验（dry-run 也执行；--help 不执行）
  1. 工作区干净：git status --porcelain 非空则列出改动路径并拒绝发布，
     因为发布标识里的 commit 无法证明就是 dist 的来源。覆盖：--allow-dirty
  2. 产物不过期：apps/<app>/dist/assets 中最早的文件 mtime 必须不早于 HEAD 提交时间
     （git log -1 --format=%ct），否则打印「dist 构建于 …，HEAD 提交于 …」并拒绝发布，
     防止「昨天构建、今天提交两次」把旧产物发成新 commit。取 earliest 而不是 latest：
     否则 touch 一下 dist/index.html（或 §9.4 新生成的 index.<release>.html）就能洗白旧产物。
     覆盖：--allow-stale
  两条都只是证据检查，不修改任何文件；git 读不到时只告警、不阻断（dry-run 同样适用）。

do 什么
  1. 解析应用、版本与 git 短 hash，得到发布标识 <version>+<hash>
  2. 校验 apps/<app>/dist 存在，且含 index.html 与 assets/
  3. 校验 dist 中没有 *.map 残留（sourcemap 上传监控平台后必须删除，见 §9.2）
  4. 计算 CDN 目录 https://cdn.xxx.com/h5/<app>/<version>/ 与 index.<version>.html
  5. 打印缓存头策略（§9.1）、发布 5 步与回滚指令（§9.4）
  6. --execute --yes 时按 UPLOAD_CMD 模板执行上传，模板占位符：{src} {dest}

环境变量
  UPLOAD_CMD          上传命令模板，例如 rsync -av {src} {dest}
  DEPLOY_ENTRY_HOST   覆盖入口域名（默认按 --env 取 xxx.com 占位）
  DEPLOY_CDN_HOST     覆盖 CDN 域名（默认按 --env 取 xxx.com 占位）

默认环境
  不写 --env 时落到 ${DEFAULT_ENVIRONMENT}（不是 prod）。发 prod 必须显式 --env prod，
  --execute 前的最后一行会醒目打印解析出的环境与目标目录，便于二次核对。

退出码
  0 成功（含 dry-run）  1 校验或使用错误  2 意外失败（例如上传命令失败）

示例
  pnpm run deploy --app member
  pnpm run deploy member --env test --version 0.2.0
  pnpm run deploy --app member --env prod --execute --yes
  pnpm run deploy --app member --allow-stale        # 明确接受比 HEAD 旧的产物
  UPLOAD_CMD="rsync -av {src} {dest}" pnpm run deploy --app member --execute --yes
`

const COLOR_ENABLED = process.stdout.isTTY === true && process.env.NO_COLOR === undefined

function paint(code: number, text: string): string {
  return COLOR_ENABLED ? `\u001B[${code}m${text}\u001B[0m` : text
}

const bold = (text: string): string => paint(1, text)
const dim = (text: string): string => paint(2, text)
const green = (text: string): string => paint(32, text)
const yellow = (text: string): string => paint(33, text)
const red = (text: string): string => paint(31, text)
const cyan = (text: string): string => paint(36, text)

/** 可预期的使用错误：打印消息后以 1 退出。 */
class CliError extends Error {
  readonly exitCode: number

  constructor(message: string, exitCode = 1) {
    super(message)
    this.name = 'CliError'
    this.exitCode = exitCode
  }
}

type Options = {
  app: string | null
  version: string | null
  env: string
  envExplicit: boolean
  execute: boolean
  yes: boolean
  allowDirty: boolean
  allowStale: boolean
  help: boolean
  errors: string[]
}

type DistReport = {
  fileCount: number
  totalSize: number
  assetCount: number
  mapFiles: string[]
  /** dist/assets/** 中最早的文件 mtime（毫秒），用于判定产物是否比 HEAD 旧；无 asset 时为 null。 */
  oldestAssetMtime: number | null
}

function readFlagValue(
  argv: string[],
  index: number,
  token: string,
): { value?: string; index: number; error?: string } {
  const equals = token.indexOf('=')
  if (equals !== -1) {
    const value = token.slice(equals + 1)
    if (value === '') return { index, error: `参数 ${token.split('=')[0]} 缺少取值` }
    return { value, index }
  }

  const next = argv[index + 1]
  if (next === undefined || next.startsWith('-')) {
    return { index, error: `参数 ${token} 缺少取值` }
  }
  return { value: next, index: index + 1 }
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    app: null,
    version: null,
    env: DEFAULT_ENVIRONMENT,
    envExplicit: false,
    execute: false,
    yes: false,
    allowDirty: false,
    allowStale: false,
    help: false,
    errors: [],
  }
  const positional: string[] = []

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]

    if (token === '--help' || token === '-h') {
      options.help = true
      continue
    }
    if (token === '--execute') {
      options.execute = true
      continue
    }
    if (token === '--yes') {
      options.yes = true
      continue
    }
    if (token === '--allow-dirty') {
      options.allowDirty = true
      continue
    }
    if (token === '--allow-stale') {
      options.allowStale = true
      continue
    }
    if (token === '--app' || token.startsWith('--app=')) {
      const parsed = readFlagValue(argv, index, token)
      if (parsed.error !== undefined) options.errors.push(parsed.error)
      else options.app = parsed.value as string
      index = parsed.index
      continue
    }
    if (token === '--version' || token.startsWith('--version=')) {
      const parsed = readFlagValue(argv, index, token)
      if (parsed.error !== undefined) options.errors.push(parsed.error)
      else options.version = parsed.value as string
      index = parsed.index
      continue
    }
    if (token === '--env' || token.startsWith('--env=')) {
      const parsed = readFlagValue(argv, index, token)
      if (parsed.error !== undefined) options.errors.push(parsed.error)
      else {
        options.env = parsed.value as string
        options.envExplicit = true
      }
      index = parsed.index
      continue
    }
    if (token.startsWith('-')) {
      options.errors.push(`未知参数 ${token}`)
      continue
    }
    positional.push(token)
  }

  if (positional.length > 1) {
    options.errors.push(`只接受一个应用名，收到：${positional.join(' ')}`)
  }
  if (options.app !== null && positional.length === 1) {
    options.errors.push('应用名同时给了 --app 和位置参数，只保留一个。')
  }
  if (options.app === null) options.app = positional[0] ?? null

  return options
}

function isEnvironment(value: string): value is Environment {
  return (ENVIRONMENTS as readonly string[]).includes(value)
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

function listApps(): string[] {
  if (!existsSync(APPS_DIR)) return []
  return readdirSync(APPS_DIR, { withFileTypes: true })
    .filter(
      (entry) => entry.isDirectory() && existsSync(join(APPS_DIR, entry.name, 'package.json')),
    )
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right))
}

function readManifest(appDir: string): { name: string; version: string } {
  const manifestPath = join(appDir, 'package.json')
  let parsed: { name?: unknown; version?: unknown }

  try {
    parsed = JSON.parse(readFileSync(manifestPath, 'utf8')) as { name?: unknown; version?: unknown }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new CliError(`${relative(WORKSPACE_ROOT, manifestPath)} 读取失败：${reason}`)
  }

  const name = typeof parsed.name === 'string' ? parsed.name : null
  const version = typeof parsed.version === 'string' ? parsed.version : null
  if (name === null) throw new CliError('package.json 缺少 name 字段。')
  if (version === null) throw new CliError('package.json 缺少 version 字段。')

  return { name, version }
}

/** 读 git 命令的输出去空行；git 不可用 / 不是仓库时返回 null（调用方决定告警还是阻断）。 */
function readGitLines(args: string[]): string[] | null {
  try {
    const output = execFileSync('git', args, {
      cwd: WORKSPACE_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return output
      .split('\n')
      .map((line) => line.trimEnd())
      .filter((line) => line !== '')
  } catch {
    return null
  }
}

function formatTimestamp(milliseconds: number): string {
  const date = new Date(milliseconds)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  )
}

function readGitShortHash(): { hash: string; warning: string | null } {
  const lines = readGitLines(['rev-parse', '--short', 'HEAD'])
  if (lines === null) {
    return {
      hash: 'nogit',
      warning: '读不到 git commit（不是 git 仓库或 git 不可用），发布标识退化为 nogit',
    }
  }

  const hash = lines[0] ?? ''
  if (hash === '') {
    return { hash: 'nogit', warning: 'git 未返回 commit hash，发布标识退化为 nogit' }
  }
  return { hash, warning: null }
}

/**
 * S1 守卫一：工作区脏就拒绝发布。
 * 发布标识里的 commit 只有在工作区干净时才等于 dist 的真实来源，否则可能是改了源码没提交、
 * 或提交了没重新构建。返回 null 表示通过，返回字符串表示「放行但有告警」。
 */
function assertCleanTree(app: string, allowDirty: boolean): string | null {
  const lines = readGitLines(['status', '--porcelain'])
  if (lines === null) {
    return '读不到 git status（不是 git 仓库或 git 不可用），已跳过「工作区干净」检查'
  }
  if (lines.length === 0) return null
  if (allowDirty) {
    return (
      `工作区有 ${lines.length} 处未提交改动，已按 --allow-dirty 继续：` +
      '发布标识里的 commit 可能与 dist 的真实来源不一致'
    )
  }

  const list = lines
    .slice(0, DIRTY_LIST_LIMIT)
    .map((line) => `    - ${line.slice(3).trim()}`)
    .join('\n')
  const rest =
    lines.length > DIRTY_LIST_LIMIT
      ? `\n    … 其余 ${lines.length - DIRTY_LIST_LIMIT} 处未列出`
      : ''

  throw new CliError(
    `工作区有 ${lines.length} 处未提交改动，无法证明 apps/${app}/dist 是用这个 commit 构建的：\n` +
      `${list}${rest}\n` +
      '请先提交（或 git stash）后再发布；确认要发布当前产物，加 --allow-dirty。',
  )
}

/**
 * S1 守卫二：dist 比 HEAD 旧就拒绝发布。
 * 「昨天构建、今天提交两次」会把旧产物发成新 commit，§9.2 的 sourcemap 归属、§9.4 的回滚与
 * 发布记录都会指向错误的版本。判定依据是 buildMtime —— dist/assets 里最早的 mtime，
 * 不是整个 dist 里最新的 mtime（理由见 scanDist）。返回 null 表示通过，返回字符串表示「放行但有告警」。
 */
function assertFreshBuild(
  app: string,
  packageName: string,
  buildMtime: number | null,
  allowStale: boolean,
): string | null {
  const commitLines = readGitLines(['log', '-1', '--format=%ct'])
  const commitSeconds =
    commitLines === null ? Number.NaN : Number.parseInt(commitLines[0] ?? '', 10)
  if (!Number.isFinite(commitSeconds) || commitSeconds <= 0) {
    return '读不到 HEAD 提交时间（不是 git 仓库或 git 不可用），已跳过「产物是否过期」检查'
  }

  if (buildMtime === null) {
    return `apps/${app}/dist/assets 下没有任何文件，无法判定产物是否过期，已跳过该项检查`
  }

  const commitTime = commitSeconds * 1000
  if (buildMtime >= commitTime) return null

  const detail = `dist 构建于 ${formatTimestamp(buildMtime)}，HEAD 提交于 ${formatTimestamp(commitTime)}`
  if (allowStale) {
    return `产物比 HEAD 旧（${detail}），已按 --allow-stale 继续：上传的可能是更早的构建`
  }

  throw new CliError(
    `apps/${app}/dist 比 HEAD 旧，拒绝发布：${detail}。\n` +
      `请重新构建后再发布：pnpm --filter ${packageName} build。\n` +
      '确认要发布这份旧产物，加 --allow-stale。',
  )
}

function scanDist(distDir: string): DistReport {
  const mapFiles: string[] = []
  let fileCount = 0
  let totalSize = 0
  let assetCount = 0
  let oldestAssetMtime: number | null = null

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
        continue
      }
      if (!entry.isFile()) continue
      const stats = statSync(full)
      fileCount += 1
      totalSize += stats.size
      if (/^assets[/\\]/.test(relative(distDir, full))) {
        assetCount += 1
        // 陈旧判定取 assets 里「最早」的 mtime，而不是整个 dist 里最新的那个。
        // 取最新等于形同虚设：§9.4 步骤 2 新生成的 index.<release>.html、一个 .DS_Store、
        // 重新拷贝的 index.html，任何一个刚写过的文件都会把「最新 mtime」刷新成现在，
        // 让一整包陈旧产物看起来像刚构建的。而一次真实构建会重写全部 assets，
        // 所以「最早的 asset」一定带着这次构建的时间，陈旧产物无法靠 touch 单个文件洗白。
        if (oldestAssetMtime === null || stats.mtimeMs < oldestAssetMtime) {
          oldestAssetMtime = stats.mtimeMs
        }
      }
      if (entry.name.endsWith('.map')) mapFiles.push(relative(distDir, full))
    }
  }

  walk(distDir)
  return { fileCount, totalSize, assetCount, mapFiles, oldestAssetMtime }
}

function verifyDist(app: string, packageName: string): { distDir: string; report: DistReport } {
  const distDir = join(APPS_DIR, app, 'dist')

  if (!existsSync(distDir) || !statSync(distDir).isDirectory()) {
    throw new CliError(
      `apps/${app}/dist 不存在，没有可发布的内容。\n` +
        `请先构建：pnpm --filter ${packageName} build（或 pnpm build）。`,
    )
  }

  const report = scanDist(distDir)

  if (!existsSync(join(distDir, 'index.html'))) {
    throw new CliError(`apps/${app}/dist/index.html 不存在，产物不完整，请重新构建。`)
  }
  if (!existsSync(join(distDir, 'assets'))) {
    throw new CliError(`apps/${app}/dist/assets 不存在，产物不完整，请重新构建。`)
  }
  if (report.mapFiles.length > 0) {
    const list = report.mapFiles.map((file) => `    - ${file}`).join('\n')
    throw new CliError(
      `apps/${app}/dist 中残留 ${report.mapFiles.length} 个 sourcemap 文件：\n${list}\n` +
        '按 §9.2：先把 sourcemap 上传到监控平台，再从 dist 中删除后再发布。',
    )
  }

  return { distDir, report }
}

function resolveHosts(env: Environment): { entry: string; cdn: string; source: string } {
  const defaults = ENVIRONMENT_HOSTS[env]
  const entryOverride = process.env.DEPLOY_ENTRY_HOST
  const cdnOverride = process.env.DEPLOY_CDN_HOST

  const entry = entryOverride !== undefined && entryOverride !== '' ? entryOverride : defaults.entry
  const cdn = cdnOverride !== undefined && cdnOverride !== '' ? cdnOverride : defaults.cdn
  const source =
    entryOverride !== undefined || cdnOverride !== undefined ? 'DEPLOY_*_HOST 覆盖' : '§9.3'

  return { entry, cdn, source }
}

function printHeader(context: {
  app: string
  packageName: string
  version: string
  versionNote: string
  release: string
  hash: string
  hashWarning: string | null
  guardWarnings: string[]
  env: Environment
  entryHost: string
  cdnHost: string
  hostSource: string
  cdnBase: string
  entryIndex: string
  versionedHtml: string
}): void {
  console.log(bold(`deploy · ${context.packageName}`))
  console.log(`  应用：${context.app}（apps/${context.app}）`)
  console.log(`  版本：${context.version}　${dim(context.versionNote)}`)
  console.log(`  commit：${context.hash}`)
  console.log(`  发布标识：${context.release}`)
  if (context.env === 'prod') {
    console.log(`  环境：${bold(red('prod（生产）'))}（${context.entryHost}）`)
    console.log(
      `  ${bold(red('⚠ 生产环境：发布后立即对外可见，只有显式 --env prod 才会走到这里'))}`,
    )
  } else {
    console.log(`  环境：${bold(context.env)}（${context.entryHost}）`)
    console.log(
      `  ${yellow(`非 prod：本次只发到 ${context.env}，没有触及线上；默认环境是 ${DEFAULT_ENVIRONMENT}`)}`,
    )
  }
  console.log(`  域名来源：${context.hostSource}`)
  console.log(`  CDN 目录：${context.cdnBase}`)
  console.log(`  入口 HTML：${context.entryIndex}`)
  console.log(`  版本化 HTML：${context.versionedHtml}`)
  if (context.env !== 'prod') {
    console.log(`  ${yellow('注意')}：${ENVIRONMENT_HOSTS[context.env].note}`)
  }
  if (context.hashWarning !== null) {
    console.log(`  ${yellow('警告')}：${context.hashWarning}`)
  }
  for (const warning of context.guardWarnings) {
    console.log(`  ${yellow('警告')}：${warning}`)
  }
}

function printVerification(app: string, report: DistReport): void {
  console.log(`\n${bold('产物校验')}`)
  console.log(
    `  apps/${app}/dist      ${green('✔')} ${report.fileCount} 个文件 / ${formatSize(report.totalSize)}`,
  )
  console.log(`  index.html           ${green('✔')}`)
  console.log(`  assets/              ${green('✔')} ${report.assetCount} 个文件`)
  console.log(`  *.map 残留           ${green('✔')} 无`)
}

function printCachePlan(entryBase: string, cdnBase: string, release: string): void {
  console.log(`\n${bold('缓存头（§9.1）')}`)
  console.log(`  入口 HTML    ${entryBase}index.html`)
  console.log(`               Cache-Control: no-cache　${dim('每次协商，发布即生效')}`)
  console.log(`  静态资源     ${cdnBase}assets/*-[hash].js`)
  console.log(
    `               Cache-Control: public, max-age=31536000, immutable　${dim('文件名带 hash，可永久缓存')}`,
  )
  console.log(`  版本化 HTML  ${entryBase}index.${release}.html　${dim('同样 no-cache')}`)
  console.log(
    '  理由：HTML 必须每次回源才能切版本；资源路径带 hash + 版本目录，命中缓存即不再请求。',
  )
}

function printReleaseSteps(context: {
  release: string
  entryIndex: string
  versionedHtml: string
  uploadCommand: string | null
}): void {
  console.log(`\n${bold('发布流程（§9.4）')}`)
  console.log('  1. 上传静态资源到 CDN 的新版本目录（不覆盖旧文件）')
  if (context.uploadCommand === null) {
    console.log(`     ${yellow('UPLOAD_CMD 未设置')}，上传命令无法展开，示例：`)
    console.log(
      `     UPLOAD_CMD="rsync -av {src} {dest}" pnpm run deploy --app <name> --execute --yes`,
    )
  } else {
    console.log(`     $ ${context.uploadCommand}`)
  }
  console.log(`  2. 把新 HTML 另存为 ${context.versionedHtml} 并上传（此刻线上无影响）`)
  console.log(`  3. 灰度：Nginx 按 uid 尾号或请求头，把部分流量指向 index.${context.release}.html`)
  console.log(`  4. 全量：把 ${context.entryIndex} 指向上一步的版本化 HTML`)
  console.log('  5. 回滚：把 index.html 指回上一版本即可，无需重新构建')
  console.log(`\n${bold('回滚指令（§9.4 第 5 步）')}`)
  console.log(`  把 ${context.entryIndex} 指回上一版本号：`)
  console.log(
    '  ln -sfn index.<上一版本>.html index.html   # 或 Nginx root 指向 index.<上一版本>.html',
  )
  console.log(`  旧版本资源保留至少 30 天，已打开的页面继续懒加载 chunk 不会 404。`)
}

function printReleaseRecord(context: { app: string; release: string; hash: string }): void {
  console.log(`\n${bold('发布记录（发布前填一行）')}`)
  console.log('  业务 / 版本 / commit / 发布人 / 时间')
  console.log(
    `  ${context.app} / ${context.release} / ${context.hash} / <发布人> / <YYYY-MM-DD HH:mm>`,
  )
}

function main(argv: string[]): number {
  const options = parseArgs(argv)
  if (options.help) {
    console.log(HELP)
    return 0
  }
  if (options.errors.length > 0) {
    throw new CliError(`${options.errors.join('\n')}\n\n用 pnpm run deploy --help 查看用法。`)
  }
  if (options.app === null || options.app === '') {
    throw new CliError(
      `缺少 --app <name>。\n可用应用：${listApps().join(' / ') || '（apps/ 为空）'}\n\n` +
        '用法：pnpm run deploy --app <name>　用 pnpm run deploy --help 查看用法。',
    )
  }
  if (!isEnvironment(options.env)) {
    throw new CliError(`--env "${options.env}" 不合法，可选：${ENVIRONMENTS.join(' | ')}。`)
  }
  if (options.env === 'prod' && !options.envExplicit) {
    throw new CliError(
      `发布到 prod 必须显式写 --env prod（默认环境是 ${DEFAULT_ENVIRONMENT}，防止漏写 --env 误发线上）。`,
    )
  }
  if (options.execute && !options.yes) {
    throw new CliError('--execute 需要配合 --yes 二次确认（上传到 CDN 不可撤销）。')
  }
  if (options.version !== null && !VERSION_PATTERN.test(options.version)) {
    throw new CliError(`--version "${options.version}" 不合法，格式：x.y.z 或 x.y.z-tag。`)
  }

  const app = options.app
  if (!APP_NAME_PATTERN.test(app)) {
    throw new CliError(
      `--app "${app}" 不合法（${APP_NAME_PATTERN.source}）。` +
        '\n应用名会拼进 CDN 路径与上传命令，只允许小写字母开头、' +
        '小写字母 / 数字 / 短横线，长度 2-31。' +
        `\n可用应用：${listApps().join(' / ') || '（apps/ 为空）'}`,
    )
  }
  const appDir = join(APPS_DIR, app)
  if (!existsSync(join(appDir, 'package.json'))) {
    throw new CliError(
      `apps/${app} 下没有 package.json，应用不存在。\n可用应用：${listApps().join(' / ') || '（apps/ 为空）'}`,
    )
  }

  const env = options.env
  const { name: packageName, version: manifestVersion } = readManifest(appDir)
  const version = options.version ?? manifestVersion

  // 两条 S1 守卫在 dry-run 里也执行（很便宜，而且正是 dry-run 最该暴露的问题）。
  const guardWarnings: string[] = []
  const dirtyWarning = assertCleanTree(app, options.allowDirty)
  if (dirtyWarning !== null) guardWarnings.push(dirtyWarning)

  const { distDir, report } = verifyDist(app, packageName)

  const staleWarning = assertFreshBuild(
    app,
    packageName,
    report.oldestAssetMtime,
    options.allowStale,
  )
  if (staleWarning !== null) guardWarnings.push(staleWarning)

  const { hash, warning: hashWarning } = readGitShortHash()
  const release = `${version}+${hash}`

  const { entry, cdn, source } = resolveHosts(env)
  const cdnBase = `https://${cdn}/h5/${app}/${release}/`
  const entryBase = `https://${entry}/${app}/`
  const entryIndex = `${entryBase}index.html`
  const versionedHtml = `${entryBase}index.${release}.html`

  printHeader({
    app,
    packageName,
    version,
    versionNote: options.version === null ? '来自 package.json' : '来自 --version 覆盖',
    release,
    hash,
    hashWarning,
    guardWarnings,
    env,
    entryHost: entry,
    cdnHost: cdn,
    hostSource: source,
    cdnBase,
    entryIndex,
    versionedHtml,
  })
  printVerification(app, report)
  if (release.includes('+')) {
    console.log(
      `\n${dim('提示')}：发布标识含 "+"，URL 中需转义为 %2B；若 CDN/Nginx 不接受，改用 --version 指定。`,
    )
  }
  printCachePlan(entryBase, cdnBase, release)

  const template = process.env.UPLOAD_CMD ?? ''
  const uploadCommand =
    template === '' ? null : template.replaceAll('{src}', distDir).replaceAll('{dest}', cdnBase)

  printReleaseSteps({ release, entryIndex, versionedHtml, uploadCommand })
  printReleaseRecord({ app, release, hash })

  if (!options.execute) {
    console.log(`\n${cyan('dry-run：未上传任何文件、未修改 Nginx。')}`)
    console.log(
      `  解析出的环境：${env}${options.envExplicit ? dim('（来自 --env）') : dim(`（默认值，未写 --env）`)}` +
        `${env === 'prod' ? red(' ← 生产环境') : ''}`,
    )
    console.log('确认无误后加 --execute --yes 执行第 1 步上传（其余步骤由人工或 CI 完成）。')
    return 0
  }

  if (uploadCommand === null) {
    throw new CliError(
      '未配置 UPLOAD_CMD，拒绝执行上传（不会凭空猜上传方式，也不会使用任何内置凭据）。\n' +
        '示例：UPLOAD_CMD="rsync -av {src} {dest}" pnpm run deploy --app ' +
        `${app} --execute --yes\n` +
        '占位符：{src} = dist 绝对路径，{dest} = CDN 版本目录。',
    )
  }

  console.log(`\n${bold('执行上传（UPLOAD_CMD）')}`)
  console.log(`  $ ${uploadCommand}`)
  const banner = `即将上传到【${env.toUpperCase()}】环境${env === 'prod' ? '（生产，对外可见）' : ''}：${cdnBase}`
  console.log(env === 'prod' ? bold(red(`▶ ${banner}`)) : bold(yellow(`▶ ${banner}`)))
  try {
    execSync(uploadCommand, { cwd: WORKSPACE_ROOT, stdio: 'inherit' })
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new CliError(`上传命令失败：${reason}`, 2)
  }

  console.log(`\n${green('✔ 第 1 步上传完成')}：${cdnBase}`)
  console.log('剩余步骤需人工或 CI 完成：')
  console.log(`  2. 上传 ${versionedHtml}（index.html 的无缓存版本副本）`)
  console.log(`  3. 灰度 / 4. 全量：把 ${entryIndex} 指向 index.${release}.html`)
  console.log('  5. 回滚：把 index.html 指回上一版本')
  return 0
}

try {
  process.exitCode = main(process.argv.slice(2))
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  console.error(red(`✖ ${message}`))
  process.exitCode = error instanceof CliError ? error.exitCode : 2
  if (!(error instanceof CliError) && error instanceof Error && error.stack !== undefined) {
    console.error(dim(error.stack))
  }
}
