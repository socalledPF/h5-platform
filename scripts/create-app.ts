#!/usr/bin/env node
/**
 * create-app —— 一键新建业务应用（设计方案 §4「新增业务流程」）。
 *
 *   pnpm create:app <name> [--from <app>] [--dry-run] [--force --overwrite] [--help]
 *
 * 设计约束：
 * - 只用 Node 内置模块，零依赖；Node 24 直接执行 TypeScript（type stripping）。
 * - 先把整个写入计划在内存里算完并打印，再落盘；落盘失败只回滚本次写出的文件，
 *   绝不删除运行前就已存在的 apps/<name>（--force --overwrite 场景）。
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  rmdirSync,
  writeFileSync,
} from 'node:fs'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const WORKSPACE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const APPS_DIR = join(WORKSPACE_ROOT, 'apps')
const PACKAGES_DIR = join(WORKSPACE_ROOT, 'packages')

/** 应用名会被当作目录名、vite appId、包名后缀，限制为小写短横线。 */
const NAME_PATTERN = /^[a-z][a-z0-9-]{1,30}$/
const DEFAULT_FROM = 'member'
const EXCLUDED_DIRS = new Set(['node_modules', 'dist', 'coverage', '.turbo', '.git'])
const EXCLUDED_SUFFIXES = ['.tsbuildinfo', '.local']
/** S3：纯本地 / 含密钥的文件不进新应用。.env.example 是文档化的占位符文件，必须保留。 */
const EXCLUDED_FILES = new Set(['.DS_Store', '.env'])
const ENV_FILE_PATTERN = /^\.env\./
const KEPT_ENV_FILES = new Set(['.env.example'])
/** 覆盖写入时最多列出多少个「将被覆盖」的文件，避免刷屏。 */
const OVERWRITE_LIST_LIMIT = 10
/** 只在这两类文件里改写 <title>：.svg 等文件里的 <title> 是图形标题，改了就是静默破坏。 */
const HTML_EXTENSIONS = new Set(['.html', '.htm'])
const TEXT_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.mjs',
  '.cjs',
  '.json',
  '.vue',
  '.html',
  '.htm',
  '.css',
  '.scss',
  '.less',
  '.md',
  '.txt',
  '.svg',
  '.yml',
  '.yaml',
])

const HELP = `create-app · 新建业务应用（设计方案 §4）

用法
  pnpm create:app <name> [选项]

参数
  <name>              应用名，满足 ^[a-z][a-z0-9-]{1,30}$，同时作为 apps/<name>/ 目录名

选项
  --from <app>        骨架来源应用，默认 ${DEFAULT_FROM}
  --dry-run           只打印文件计划与文案替换，不写任何文件
  --force             目标已存在时仍然写入（覆盖同名文件，不删除多余文件）
  --overwrite         与 --force 联用，明确确认覆盖已存在的 apps/<name>；缺省会被拒绝
  --help, -h          显示本帮助

做什么
  1. 从 apps/<from> 复制骨架
     排除目录：node_modules / dist / coverage / .turbo / .git
     排除文件：*.tsbuildinfo / *.local / .DS_Store / .env / .env.*（例如 .env.local）
     保留 .env.example：它是文档化的占位符文件，不涉及任何本地密钥
  2. 改写包名 @h5/app-<from> → @h5/app-<name>、vite appId、index.html 的 <title>
     <title> 只在 .html / .htm 里改写；.svg 等文件里的 <title> 原样保留（那是图形标题）
  3. 打印后续需要人工完成的 5 步（路由 / base 路径 / 客户端入口 URL / 依赖边界 / pnpm install）

覆盖已存在的应用
  apps/<name> 已存在时，必须同时给 --force --overwrite：先列出将被覆盖的文件，
  再写入同名文件（不删除多余文件）。写入中途失败只回滚本次写出的文件，
  已存在的目录与其中其他文件一律保留。

退出码
  0 成功（含 --dry-run）  1 校验或使用错误  2 意外失败

示例
  pnpm create:app order
  pnpm create:app order --dry-run
  pnpm create:app order --from activity
  pnpm create:app order --force --overwrite
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
  name: string | null
  from: string
  dryRun: boolean
  force: boolean
  overwrite: boolean
  help: boolean
  errors: string[]
}

type RuleContext = {
  from: string
  name: string
}

type RuleHit = {
  id: string
  description: string
  count: number
}

type PlannedFile = {
  relativePath: string
  targetPath: string
  content: string | Buffer
  isText: boolean
  size: number
  replacements: number
}

type LeftoverHit = {
  relativePath: string
  count: number
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
    name: null,
    from: DEFAULT_FROM,
    dryRun: false,
    force: false,
    overwrite: false,
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
    if (token === '--dry-run') {
      options.dryRun = true
      continue
    }
    if (token === '--force') {
      options.force = true
      continue
    }
    if (token === '--overwrite') {
      options.overwrite = true
      continue
    }
    if (token === '--from' || token.startsWith('--from=')) {
      const parsed = readFlagValue(argv, index, token)
      if (parsed.error !== undefined) {
        options.errors.push(parsed.error)
      } else {
        options.from = parsed.value as string
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
  options.name = positional[0] ?? null
  return options
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  return `${(bytes / 1024).toFixed(1)} KB`
}

function isTextFile(filePath: string): boolean {
  const extension = extname(filePath)
  if (extension === '') return true
  return TEXT_EXTENSIONS.has(extension)
}

function isHtmlFile(filePath: string): boolean {
  return HTML_EXTENSIONS.has(extname(filePath))
}

function isExcludedFile(name: string): boolean {
  if (KEPT_ENV_FILES.has(name)) return false
  if (EXCLUDED_FILES.has(name)) return true
  if (ENV_FILE_PATTERN.test(name)) return true
  return EXCLUDED_SUFFIXES.some((suffix) => name.endsWith(suffix))
}

function collectSkeletonFiles(root: string): string[] {
  const files: string[] = []

  const walk = (dir: string): void => {
    const entries = readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (EXCLUDED_DIRS.has(entry.name)) continue
        walk(full)
        continue
      }
      if (!entry.isFile()) continue
      if (isExcludedFile(entry.name)) continue
      files.push(full)
    }
  }

  walk(root)
  return files.sort((left, right) => left.localeCompare(right))
}

function replaceLiteral(
  content: string,
  find: string,
  replacement: string,
): { content: string; count: number } {
  if (find === '' || !content.includes(find)) return { content, count: 0 }
  const parts = content.split(find)
  return { content: parts.join(replacement), count: parts.length - 1 }
}

/** 文案替换规则：只作用于文本文件，逐条统计命中次数便于人工复核。 */
function applyRules(
  content: string,
  context: RuleContext,
  rewriteTitle: boolean,
): { content: string; hits: RuleHit[] } {
  const hits: RuleHit[] = []
  let output = content

  const packageHit = replaceLiteral(output, `@h5/app-${context.from}`, `@h5/app-${context.name}`)
  output = packageHit.content
  hits.push({
    id: 'package-name',
    description: `@h5/app-${context.from} → @h5/app-${context.name}`,
    count: packageHit.count,
  })

  let appIdCount = 0
  for (const quote of [`'`, `"`]) {
    const hit = replaceLiteral(
      output,
      `appId: ${quote}${context.from}${quote}`,
      `appId: ${quote}${context.name}${quote}`,
    )
    output = hit.content
    appIdCount += hit.count
  }
  hits.push({
    id: 'vite-app-id',
    description: `appId: ${context.from} → appId: ${context.name}`,
    count: appIdCount,
  })

  // S2：只改 .html/.htm 的 <title>。.svg 里的 <title> 是图形可访问名，被改名就是静默破坏。
  if (rewriteTitle) {
    const titlePattern = /<title>[\s\S]*?<\/title>/
    const titleMatch = output.match(titlePattern)
    const titleCount = titleMatch === null ? 0 : 1
    if (titleMatch !== null) {
      output = output.replace(titlePattern, `<title>${context.name}</title>`)
    }
    hits.push({
      id: 'html-title',
      description: `<title>…</title> → <title>${context.name}</title>（仅 .html/.htm）`,
      count: titleCount,
    })
  }

  return { content: output, hits }
}

function countWord(content: string, word: string): number {
  const matches = content.match(new RegExp(`\\b${word}\\b`, 'g'))
  return matches === null ? 0 : matches.length
}

function collectWorkspaceOccupancy(): { directories: Set<string>; packageNames: Set<string> } {
  const directories = new Set<string>()
  const packageNames = new Set<string>()

  for (const root of [APPS_DIR, PACKAGES_DIR]) {
    if (!existsSync(root)) continue
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      directories.add(entry.name)
      const manifestPath = join(root, entry.name, 'package.json')
      if (!existsSync(manifestPath)) continue
      try {
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { name?: string }
        if (typeof manifest.name === 'string') packageNames.add(manifest.name)
      } catch {
        continue
      }
    }
  }

  return { directories, packageNames }
}

function validate(options: Options): {
  name: string
  from: string
  fromDir: string
  targetDir: string
  preExisted: boolean
} {
  if (options.errors.length > 0) {
    throw new CliError(`${options.errors.join('\n')}\n\n用 pnpm create:app --help 查看用法。`)
  }
  if (options.name === null) {
    throw new CliError(
      `缺少应用名。\n\n用法：pnpm create:app <name>\n用 pnpm create:app --help 查看用法。`,
    )
  }

  const name = options.name
  if (!NAME_PATTERN.test(name)) {
    throw new CliError(
      `应用名 "${name}" 不合法。要求：小写字母开头，只含小写字母 / 数字 / 短横线，长度 2-31。` +
        '\n例如：order、order-center、member2。',
    )
  }
  if (!NAME_PATTERN.test(options.from)) {
    throw new CliError(`--from "${options.from}" 不是合法的应用名（见 --help）。`)
  }

  const fromDir = join(APPS_DIR, options.from)
  if (!existsSync(join(fromDir, 'package.json'))) {
    throw new CliError(
      `找不到骨架应用 apps/${options.from}（缺少 apps/${options.from}/package.json）。` +
        `\n请在仓库根目录执行，或用 --from <app> 指定已存在的骨架。`,
    )
  }

  const targetDir = join(APPS_DIR, name)
  const preExisted = existsSync(targetDir)
  if (preExisted && !options.force) {
    throw new CliError(
      `目标 apps/${name} 已存在。换一个名字，或加 --force --overwrite 覆盖同名文件（不会删除多余文件）。`,
    )
  }
  if (preExisted && !options.overwrite) {
    throw new CliError(
      `目标 apps/${name} 已存在，--force 会覆盖其中同名文件（不会删除多余文件）。\n` +
        `确认要写入已存在的 apps/${name} 请再加 --overwrite，避免误覆盖自己的工作。`,
    )
  }

  const occupancy = collectWorkspaceOccupancy()
  const packageName = `@h5/app-${name}`
  if (occupancy.packageNames.has(packageName)) {
    throw new CliError(`包名 ${packageName} 已被 workspace 中的其他包占用，换一个应用名。`)
  }
  if (occupancy.directories.has(name) && !existsSync(targetDir)) {
    throw new CliError(`名字 "${name}" 已被 packages/${name} 占用，换一个应用名。`)
  }

  return { name, from: options.from, fromDir, targetDir, preExisted }
}

function buildPlan(
  fromDir: string,
  targetDir: string,
  context: RuleContext,
): { files: PlannedFile[]; hits: RuleHit[] } {
  const files: PlannedFile[] = []
  const totals = new Map<string, RuleHit>()

  for (const sourcePath of collectSkeletonFiles(fromDir)) {
    const relativePath = relative(fromDir, sourcePath)
    const targetPath = join(targetDir, relativePath)
    const raw = readFileSync(sourcePath)

    if (!isTextFile(sourcePath)) {
      files.push({
        relativePath,
        targetPath,
        content: raw,
        isText: false,
        size: raw.byteLength,
        replacements: 0,
      })
      continue
    }

    const applied = applyRules(raw.toString('utf8'), context, isHtmlFile(sourcePath))
    for (const hit of applied.hits) {
      const existing = totals.get(hit.id)
      if (existing === undefined) {
        totals.set(hit.id, { ...hit })
        continue
      }
      existing.count += hit.count
    }

    files.push({
      relativePath,
      targetPath,
      content: applied.content,
      isText: true,
      size: Buffer.byteLength(applied.content, 'utf8'),
      replacements: applied.hits.reduce((total, hit) => total + hit.count, 0),
    })
  }

  return { files, hits: [...totals.values()] }
}

function collectLeftovers(plan: PlannedFile[], from: string): LeftoverHit[] {
  const leftovers: LeftoverHit[] = []

  for (const file of plan) {
    if (!file.isText) continue
    const count = countWord(String(file.content), from)
    if (count > 0) leftovers.push({ relativePath: file.relativePath, count })
  }

  return leftovers
}

function printPlan(options: {
  name: string
  from: string
  targetDir: string
  plan: PlannedFile[]
  hits: RuleHit[]
  leftovers: LeftoverHit[]
  dryRun: boolean
  preExisted: boolean
  overwrites: string[]
}): void {
  const { plan, hits, leftovers } = options
  const totalSize = plan.reduce((total, file) => total + file.size, 0)
  const width = Math.min(48, Math.max(...plan.map((file) => file.relativePath.length), 8))

  console.log(bold(`create-app · apps/${options.name}`))
  console.log(`  骨架来源：apps/${options.from}`)
  console.log(`  写入目录：${relative(WORKSPACE_ROOT, options.targetDir) || '.'}`)
  console.log(`  排除规则：${[...EXCLUDED_DIRS].join(' / ')} / ${EXCLUDED_SUFFIXES.join(' / ')}`)
  console.log(
    `  排除文件：${[...EXCLUDED_FILES].join(' / ')} / .env.*（保留 ${[...KEPT_ENV_FILES].join(' / ')}）`,
  )
  if (options.dryRun) console.log(`  模式：${yellow('--dry-run（不写文件）')}`)

  if (options.preExisted) {
    console.log(
      `\n${bold(yellow(`⚠ 目标 apps/${options.name} 已存在，本次是覆盖写入`))}` +
        `${dim('（只覆盖同名文件，不删除多余文件；失败只回滚本次写入）')}`,
    )
    if (options.overwrites.length === 0) {
      console.log(`  ${dim('计划中的文件都还不存在，不会覆盖任何已有文件。')}`)
    } else {
      console.log(`  ${yellow('将被覆盖')} ${options.overwrites.length} 个已存在的文件：`)
      for (const file of options.overwrites.slice(0, OVERWRITE_LIST_LIMIT)) {
        console.log(`    ${yellow('!')} ${file}`)
      }
      if (options.overwrites.length > OVERWRITE_LIST_LIMIT) {
        console.log(`    ${dim(`… 其余 ${options.overwrites.length - OVERWRITE_LIST_LIMIT} 个`)}`)
      }
    }
  }

  console.log(`\n${bold(`计划写入 ${plan.length} 个文件（${formatSize(totalSize)}）`)}`)
  for (const file of plan) {
    const marker = file.replacements > 0 ? cyan('~') : green('+')
    console.log(`  ${marker} ${file.relativePath.padEnd(width)}  ${dim(formatSize(file.size))}`)
  }
  console.log(`  ${dim('+ 原样复制    ~ 复制后做了文案替换')}`)

  console.log(`\n${bold('文案替换（仅文本文件；<title> 只改 .html / .htm）')}`)
  for (const hit of hits) {
    const status = hit.count === 0 ? yellow('0 处（模板中未出现，可忽略）') : `${hit.count} 处`
    console.log(`  ${hit.id.padEnd(14)}${hit.description}  ${dim(status)}`)
  }

  if (leftovers.length > 0) {
    console.log(`\n${bold(yellow('需要人工复核'))}`)
    for (const leftover of leftovers) {
      console.log(
        `  ${leftover.relativePath}：仍有 ${leftover.count} 处 "${options.from}" 字样，按语义决定是否保留。`,
      )
    }
  }
}

function printNextSteps(name: string): void {
  console.log(`\n${bold('下一步（设计方案 §4「新增业务流程」）')}`)
  console.log(`  1. 路由：在 apps/${name}/src/router/index.ts 中登记页面，页面文件放 src/views/。`)
  console.log(
    `  2. base 路径：在部署配置里登记 apps/${name} 的 base 路径 /${name}/ 与 ` +
      `try_files $uri /${name}/index.html（见 docs/deployment.md）。`,
  )
  console.log(
    `  3. 入口 URL：由客户端在 App 中配置 https://h5.xxx.com/${name}/（test/pre 域名不同，见 §9.3）。`,
  )
  console.log(
    '  4. 依赖边界：apps/* 只能依赖 packages/*，禁止 app 之间互相 import（ESLint 已拦截）。',
  )
  console.log('  5. 执行 pnpm install 链接新 workspace 包，然后 pnpm dev 打开浏览器 mock 模式。')
}

/** 创建 dir 及其缺失的父目录，只记录本次真正新建的目录，供回滚使用。 */
function ensureDirectory(dir: string, createdDirs: string[]): void {
  if (existsSync(dir)) return
  const parent = dirname(dir)
  if (parent !== dir) ensureDirectory(parent, createdDirs)
  mkdirSync(dir)
  createdDirs.push(dir)
}

type WriteJournal = {
  /** 本次尝试写出的文件，按顺序记录；回滚时逆序处理。 */
  writtenFiles: string[]
  /** 本次新建的目录，按创建顺序记录；回滚时逆序删除。 */
  createdDirs: string[]
  /** 覆盖前已存在文件的原内容，回滚时还原。 */
  overwritten: Map<string, Buffer>
}

function rollbackWrite(journal: WriteJournal, targetDir: string, preExisted: boolean): string {
  let restored = 0
  let removed = 0
  let cleanedDirs = 0

  for (let index = journal.writtenFiles.length - 1; index >= 0; index -= 1) {
    const filePath = journal.writtenFiles[index]
    const original = journal.overwritten.get(filePath)
    try {
      if (original === undefined) {
        rmSync(filePath, { force: true })
        removed += 1
      } else {
        writeFileSync(filePath, original)
        restored += 1
      }
    } catch {
      // 回滚尽力而为：单个文件失败不影响其余文件与目录处理。
    }
  }

  for (let index = journal.createdDirs.length - 1; index >= 0; index -= 1) {
    const dirPath = journal.createdDirs[index]
    // 运行前就存在的目标目录（及其父目录）永远不进 createdDirs；这里再兜一层。
    if (preExisted && dirPath === targetDir) continue
    try {
      rmdirSync(dirPath)
      cleanedDirs += 1
    } catch {
      // 目录非空或已被占用：保留，绝不 rmSync 整棵树。
    }
  }

  const parts = [`删除本次新建文件 ${removed} 个`, `还原被覆盖文件 ${restored} 个`]
  if (cleanedDirs > 0) parts.push(`清理本次新建目录 ${cleanedDirs} 个`)
  return parts.join('，')
}

function writePlan(options: {
  plan: PlannedFile[]
  targetDir: string
  name: string
  preExisted: boolean
}): void {
  const { plan, targetDir, name, preExisted } = options
  const journal: WriteJournal = { writtenFiles: [], createdDirs: [], overwritten: new Map() }

  try {
    for (const file of plan) {
      ensureDirectory(dirname(file.targetPath), journal.createdDirs)
      if (existsSync(file.targetPath)) {
        journal.overwritten.set(file.targetPath, readFileSync(file.targetPath))
      }
      journal.writtenFiles.push(file.targetPath)
      if (typeof file.content === 'string') {
        writeFileSync(file.targetPath, file.content, 'utf8')
      } else {
        writeFileSync(file.targetPath, file.content)
      }
    }
  } catch (error) {
    const outcome = rollbackWrite(journal, targetDir, preExisted)
    const reason = error instanceof Error ? error.message : String(error)
    const safety = preExisted
      ? `原有的 apps/${name} 目录未被删除：只回滚了本次写入（${outcome}），` +
        '其中不相关的已存在文件保持原样。'
      : `已回滚（${outcome}），未留下半个应用。`
    throw new CliError(`写入 apps/${name} 失败。${safety}\n原因：${reason}`, 2)
  }
}

function main(argv: string[]): number {
  const options = parseArgs(argv)
  if (options.help) {
    console.log(HELP)
    return 0
  }

  const { name, from, fromDir, targetDir, preExisted } = validate(options)
  const context: RuleContext = { from, name }
  const { files: plan, hits } = buildPlan(fromDir, targetDir, context)
  const leftovers = collectLeftovers(plan, from)

  if (plan.length === 0) {
    throw new CliError(`apps/${from} 中没有任何可复制的文件，骨架为空。`)
  }

  const overwrites = preExisted
    ? plan.filter((file) => existsSync(file.targetPath)).map((file) => file.relativePath)
    : []

  printPlan({
    name,
    from,
    targetDir,
    plan,
    hits,
    leftovers,
    dryRun: options.dryRun,
    preExisted,
    overwrites,
  })

  if (options.dryRun) {
    printNextSteps(name)
    console.log(`\n${cyan('dry-run：未写入任何文件。去掉 --dry-run 才会创建 apps/')}${name}/。`)
    return 0
  }

  writePlan({ plan, targetDir, name, preExisted })
  console.log(
    `\n${green(
      preExisted
        ? `✔ 已写入 apps/${name}/（${plan.length} 个文件，覆盖 ${overwrites.length} 个已存在文件）`
        : `✔ 已创建 apps/${name}/（${plan.length} 个文件）`,
    )}`,
  )
  printNextSteps(name)
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
