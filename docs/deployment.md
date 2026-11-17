# 发布手册（构建、部署、灰度与回滚）

本文对齐《Vue3 H5（App WebView）项目架构设计方案》§9：**每个业务独立构建、独立发布**。静态资源带 hash 上 CDN 并长期缓存，`index.html` 不缓存；发布与回滚都只是切换该业务的 `index.html`，秒级生效且互不影响。

## 1. URL 与目录规划（§9.1）

| 内容             | 地址                                                        | 缓存头                                               |
| ---------------- | ----------------------------------------------------------- | ---------------------------------------------------- |
| 业务入口 HTML    | `https://h5.xxx.com/<app>/`                                 | `Cache-Control: no-cache`（每次协商）                |
| 业务静态资源     | `https://cdn.xxx.com/h5/<app>/<version>/assets/*-[hash].js` | `Cache-Control: public, max-age=31536000, immutable` |
| 公共依赖（可选） | `https://cdn.xxx.com/h5/vendor/vue-3.x.js`                  | 长期缓存                                             |

- **入口 HTML 走自有域名**（`h5.xxx.com`）：便于 Nginx 做 history fallback，也便于 App 把它加进域名白名单。
- **静态资源走 CDN**（`cdn.xxx.com`）：强缓存命中率高，不占用自有域名带宽。
- 资源路径里**带版本号目录**，新旧版本文件并存、互不覆盖。

`<version>` 的确切取值是 `<package.json 版本>+<git 短 hash>`（§9.2），例如：

```text
apps/member/package.json  →  "version": "0.1.0"
git rev-parse --short HEAD →   b5f3c3e
发布标识                    →  0.1.0+b5f3c3e
CDN 目录                   →  https://cdn.xxx.com/h5/member/0.1.0+b5f3c3e/
版本化 HTML                →  https://h5.xxx.com/member/index.0.1.0+b5f3c3e.html
```

> 发布标识里的 `+` 在 URL 中需转义成 `%2B`。若你们的 CDN 或 Nginx 不接受 `+`，发布时用
> `--version` 指定一个不带 `+` 的版本号（例如 `0.1.0-b5f3c3e`），目录结构与规则不变。

## 2. 缓存头策略与原因

| 对象                         | 头                                                   | 原因                                                                              |
| ---------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------- |
| 入口 HTML                    | `Cache-Control: no-cache`                            | HTML 是版本切换的唯一开关，必须每次回源协商；如果被中间层缓存，用户就看不到新版本 |
| 版本化 HTML                  | `Cache-Control: no-cache`                            | 同上，灰度期间它就是「指向某个版本」的那根指针                                    |
| `assets/*`                   | `Cache-Control: public, max-age=31536000, immutable` | 文件名内含 content hash，内容变化必然换名；`immutable` 让浏览器连条件请求都不发   |
| `dist/stats.html`（ANALYZE） | 不发布                                               | 只是本地/CI 的包体积分析产物                                                      |

Nginx 参考片段：

```nginx
# 入口：每次协商，且禁止中间层缓存
location = /member/index.html {
    add_header Cache-Control "no-cache, no-store, must-revalidate";
    root /data/www/h5/member;
}

# 版本化 HTML 同样不缓存（index.<version>.html）
location ~ ^/member/index\..+\.html$ {
    add_header Cache-Control "no-cache, no-store, must-revalidate";
    root /data/www/h5/member;
}
```

CDN 侧对 `/h5/*/assets/*` 配置 `max-age=31536000, immutable`，且**不要**对 `index.*.html` 套用默认的长缓存规则——这是最常见的「发了新版用户看不到」的原因。

## 3. history 路由 fallback 与按业务灰度

Vue Router 用 history 模式，URL 干净、便于原生拼参数与分享，代价是 Nginx 必须把未知路径回落到该业务的 `index.html`：

```nginx
# 每个业务一个 location，互不影响：新增业务 = 复制这段并改 app 名
location /member/ {
    root /data/www/h5;
    try_files $uri $uri/ /member/index.html;
}

location /activity/ {
    root /data/www/h5;
    try_files $uri $uri/ /activity/index.html;
}
```

按业务灰度（§9.4 第 3 步）——只影响单个业务，其他业务照常：

```nginx
# 口径一：uid 尾号 0-1（约 20% 流量）命中新版，其余走旧版
map $arg_uid $member_rollout {
    default            "index.html";
    "~*[01]$"          "index.0.1.0+b5f3c3e.html";
}

# 口径二：按 App 带上来的请求头/版本号放量
# map $http_x_app_version $member_rollout {
#     default      "index.html";
#     "~^5\.6\."    "index.0.1.0+b5f3c3e.html";
# }

location = /member/index.html {
    root /data/www/h5/member;
    try_files /$member_rollout =404;
    add_header Cache-Control "no-cache, no-store, must-revalidate";
}
```

灰度期间两个版本同时在线，因此**新旧版本的资源目录都必须存在**（这正是版本目录 + 30 天保留的价值）。

## 4. 构建产物与构建期常量

```bash
turbo run build --filter=...[origin/main]   # 只构建有变更的业务及受共享包影响的业务（§9.2）
pnpm --filter @h5/app-member build          # 单个应用
```

- Vite `base` = `VITE_CDN_BASE`（默认 `/`），线上应设为 `https://cdn.xxx.com/h5/<app>/<version>/`。
- `@h5/config/vite` 在构建时注入三个常量，业务与监控都用它们定位问题：

| 常量              | 来源                                                  | 用途                       |
| ----------------- | ----------------------------------------------------- | -------------------------- |
| `__APP_ID__`      | `VITE_APP_ID`，缺省回落到 `vite.config.ts` 的 `appId` | 监控 / 埋点 / 日志区分业务 |
| `__APP_VERSION__` | `createAppViteConfig({ appVersion })`                 | 定位到具体 H5 版本         |
| `__BUILD_TIME__`  | 构建时 `new Date().toISOString()`                     | 确认线上跑的是哪一次构建   |

- 产物结构固定为 `dist/index.html` + `dist/assets/*-[hash].{js,css}`；`ANALYZE=1` 时多出 `dist/stats.html`，不发布。
- **sourcemap（§9.2）**：上传到监控平台（Sentry 等）后，必须从产物中删除 `*.map` 再发 CDN。`scripts/deploy.ts` 会校验这一步，发现残留直接失败并列出文件。

## 5. 四环境对照（§9.3）

| 环境 | 入口域名                 | 用途                 | 调试工具                                 |
| ---- | ------------------------ | -------------------- | ---------------------------------------- |
| dev  | localhost（浏览器 mock） | 本地开发             | Vue DevTools                             |
| test | `h5-test.xxx.com`        | 测试包 App 联调      | vConsole 默认开启                        |
| pre  | `h5-pre.xxx.com`         | 预发验证，连生产数据 | vConsole 按参数开启（URL 加 `?debug=1`） |
| prod | `h5.xxx.com`             | 线上                 | 无                                       |

App 的测试包提供环境切换开关，把 `h5.xxx.com` 映射到 test/pre 域名，**前端无需改代码**。

`scripts/deploy.ts` 的 `--env` 与上表对应；`dev` 在 §9.3 里是 localhost，脚本仍接受 `--env dev` 只是为了给联调环境上传产物，此时域名换成 `h5-dev.xxx.com` / `cdn-dev.xxx.com` 并打印告警。

## 6. 发布流程 5 步（§9.4）

`scripts/deploy.ts` 把 5 步全部打印出来，并校验前置条件（含**工作区是否干净**与**产物是否早于 HEAD 提交**，dry-run 也会执行）；只有第 1 步能真正执行（需要 `--execute --yes` + `UPLOAD_CMD`），其余步骤由人工或 CI 完成。

| 步骤 | 做什么                                                      | 脚本是否执行                          |
| ---- | ----------------------------------------------------------- | ------------------------------------- |
| 1    | CI 构建 → 上传静态资源到 CDN **新版本目录**（不覆盖旧文件） | `--execute --yes` 时执行 `UPLOAD_CMD` |
| 2    | 上传新 HTML 为 `index.<版本>.html`，此时线上无影响          | 只打印目标地址                        |
| 3    | 灰度：Nginx 按 uid 尾号或请求头把部分流量指向新版 HTML      | 只打印灰度口径                        |
| 4    | 全量：把 `index.html` 指向新版本                            | 只打印切换指令                        |
| 5    | 回滚：把 `index.html` 指回上一版本，无需重新构建            | 打印回滚指令                          |

配套命令：

```bash
# 1) 构建（vendor 无关：走 turbo，只构建受影响的业务）
pnpm --filter @h5/app-member build

# 2) 看计划：解析 + 校验 + 缓存头 + 5 步（默认 dry-run，不上传）
pnpm deploy --app member

# 3) 预发环境演练
pnpm deploy --app member --env pre --version 0.2.0

# 4) 真正上传第 1 步（不可撤销，必须两次确认）
UPLOAD_CMD="rsync -av {src} {dest}" pnpm deploy --app member --env prod --execute --yes
```

## 7. 回滚流程

回滚 = 把 `index.html` 指回上一版本，**不重新构建、不动静态资源**：

```bash
# 方式一：软链（推荐，切换原子且可审计）
ln -sfn index.0.1.0+aaaaaaaa.html index.html

# 方式二：改 Nginx 的 $member_rollout 映射，把默认值指回旧版本再 reload
nginx -t && nginx -s reload
```

注意事项：

- 回滚只影响该业务，其他业务不受影响。
- 旧版本资源仍在 CDN 上（保留 30 天），因此回滚不会出现 404。
- 已打开的新版页面不会被强制刷新，用户下次进入才拿到旧版；如有需要，由客户端在版本切换后重新加载 WebView。

## 8. 旧版本资源保留 30 天的理由（§9.1）

1. **已打开的页面会继续懒加载 chunk**：路由级懒加载的资源是点击时才请求的，用户可能停留在旧版页面很久，此时旧资源目录必须还在。
2. **回滚窗口**：出问题到定位、决策、执行回滚通常在数小时内完成，30 天给了充足余量。
3. **灰度期间双版本共存**：灰度未全量时新旧两个版本目录都必须可访问。
4. **CDN 边缘节点缓存未过期**：节点仍可能回源旧路径。

清理策略：只删除**超过 30 天且不是最近 3 个版本**的目录，删除前先核对发布记录。

## 9. 共享包版本与发布约束（§9.5）

- 共享包在 monorepo 内一律用 `workspace:*` 引用（`@h5/bridge`、`@h5/core`、`@h5/styles` 等），不写具体版本号，不做独立发包。
- 修改共享包后，由 turbo 识别受影响的业务一并构建：`turbo run build --filter=...[origin/main]`。
- **破坏性修改**（尤其 `@h5/bridge`）的要求：同一个 PR 内修复所有业务的用法，并由每个受影响业务的负责人确认后再发布。
- 因为 `workspace:*` 会在构建时把共享包源码打进各业务产物，所以**共享包改动必然影响所有依赖它的业务**——发布前必须确认哪些业务被波及，按业务逐个灰度，不要一次全量。

## 10. 发布记录字段（§9.4）

每次发布记录一行，字段固定：

| 字段   | 示例               | 来源                                              |
| ------ | ------------------ | ------------------------------------------------- |
| 业务   | `member`           | `--app`                                           |
| 版本   | `0.1.0+b5f3c3e`    | package.json 版本 + git 短 hash（或 `--version`） |
| commit | `b5f3c3e`          | `git rev-parse --short HEAD`                      |
| 发布人 | `@xingyu`          | 人工填写                                          |
| 时间   | `2026-11-13 14:30` | 人工填写 / CI 时间戳                              |

监控面板按版本对比错误率，异常时按上一节的流程一键回滚。

## 11. `scripts/deploy.ts` 用法

```text
pnpm deploy --app <name> [--version <v>] [--env dev|test|pre|prod] [--execute] [--yes] [--allow-dirty] [--allow-stale] [--help]
pnpm deploy <name>            # 应用名也可以作为第一个位置参数
```

| 参数            | 说明                                                                                                              |
| --------------- | ----------------------------------------------------------------------------------------------------------------- |
| `--app <name>`  | 必填，小写字母开头、仅小写字母/数字/短横线（2-31 位），且是 `apps/` 下含 `package.json` 的目录                    |
| `--version <v>` | 覆盖 package.json 版本，格式 `x.y.z` 或 `x.y.z-tag`                                                               |
| `--env <env>`   | `dev` / `test` / `pre` / `prod`，**默认 `test`**；发 `prod` 必须显式写 `--env prod`，非 prod 会切换域名并醒目告警 |
| `--execute`     | 真正执行上传，默认 dry-run 什么都不做                                                                             |
| `--yes`         | 与 `--execute` 联用，二次确认上传不可撤销                                                                         |
| `--allow-dirty` | 跳过「工作区干净」校验。默认拒绝：有未提交改动时无法证明产物就是这个 commit 构建的（未跟踪文件也算脏）            |
| `--allow-stale` | 跳过「dist 不早于 HEAD 提交」校验。默认拒绝：先构建再发布                                                         |
| `--help`        | 打印帮助                                                                                                          |

dry-run 会打印：解析结果（应用 / 版本 / commit / 发布标识 / 环境 / CDN 目录 / 入口与版本化 HTML）、产物校验、缓存头策略、发布 5 步、回滚指令、发布记录模板。

校验项（不通过则退出码 1，并给出可直接复制的修复命令）：

- `apps/<app>/dist` 存在，且含 `index.html` 与 `assets/`
- `dist` 中没有 `*.map` 残留
- `--env`、`--version` 取值合法
- `--execute` 必须搭配 `--yes`
- **工作区干净**（`git status --porcelain` 为空，未跟踪文件也算脏）；否则用 `--allow-dirty`
- **产物不早于 HEAD 提交**（`dist` 内最新 mtime vs `git log -1`）；否则先 `pnpm --filter <pkg> build`，或 `--allow-stale`

> 最后两项在 dry-run 阶段同样执行——它们的作用是防止「昨天构建、今天提交、上传旧包贴新版本号」。
> 时间粒度是整秒：构建与提交落在同一秒时会被判定为新鲜（最多 1 秒盲区）。

### `UPLOAD_CMD` 配置示例

`UPLOAD_CMD` 是一个命令模板，脚本用两个占位符替换后执行：

- `{src}` = `apps/<app>/dist` 的**绝对路径**
- `{dest}` = `https://cdn.xxx.com/h5/<app>/<version>/`（按 `--env` 切换域名）

```bash
# rsync 到已挂载的 CDN 发布机目录
export UPLOAD_CMD="rsync -av --delete-after {src}/ {dest}"

# 对象存储（凭据来自环境/实例角色，脚本本身不保存任何凭据）
export UPLOAD_CMD="aws s3 sync {src} {dest} --cache-control max-age=31536000,immutable"

# 公司自研 CLI
export UPLOAD_CMD="h5-cli upload --dir {src} --base {dest}"
```

约定：

- 脚本**不内置任何上传实现，也不读取任何凭据**；没有 `UPLOAD_CMD` 时 `--execute` 直接失败，避免"静默什么都没上传"。
- 域名默认是 `xxx.com` 占位，可用 `DEPLOY_ENTRY_HOST` / `DEPLOY_CDN_HOST` 覆盖成真实域名。
- 退出码：`0` 成功（含 dry-run）；`1` 校验/使用错误；`2` 意外失败（例如上传命令返回非 0）。

## 12. 发布前检查清单

> `--allow-dirty` / `--allow-stale` 仅为应急通道：绕过它们意味着放弃「产物与 commit 一一对应」这一前提，
> 事后按版本比对错误率、以及回滚定位都会失去依据。

- [ ] `pnpm typecheck && pnpm lint && pnpm lint:style && pnpm test && pnpm build` 全绿
- [ ] 工作区干净（已提交），且 `dist` 由当前 commit 构建（`deploy` 会校验，勿用 `--allow-*` 绕过）
- [ ] `dist` 内没有 `*.map` 残留，sourcemap 已传监控平台
- [ ] `UPLOAD_CMD` 的 `{dest}` 是**新版本目录**，不会覆盖旧文件
- [ ] test 环境用双端测试包各走一遍关键流程（打开、登录态、导航返回、分享）
- [ ] 发布记录已填（业务 / 版本 / commit / 发布人 / 时间）
- [ ] 回滚用的上一版本号已知（`ls` CDN 版本目录即可）
