# H5 JSBridge 协议（唯一来源）

> 本文件是 H5 与客户端之间的 **协议唯一来源**（设计文档 §5、§12.2）。
> 代码实现位于 `packages/bridge`，业务只能通过 `@h5/bridge` 的导出调用，禁止直接访问
> `window.webkit` / `window.H5Bridge` / `navigator.userAgent`（ESLint 强制）。
> 任何协议变更都必须先改本文件，再改代码，并经双端评审（见「变更流程」）。

## 1. 通道与注入时机

| 端             | 通道                                                          | 说明                                                          |
| -------------- | ------------------------------------------------------------- | ------------------------------------------------------------- |
| iOS            | `window.webkit.messageHandlers.H5Bridge.postMessage(json)`    | WKWebView `WKScriptMessageHandler`，消息体为 **JSON 字符串**  |
| Android        | `window.H5Bridge.postMessage(json)`                           | `addJavascriptInterface` 注入的对象，消息体为 **JSON 字符串** |
| 原生 → H5 回调 | `window.__H5Bridge.callback(callbackId, { code, data, msg })` | 由 H5 在加载时挂载，原生直接调用                              |
| 原生 → H5 事件 | `window.__H5Bridge.emit(event, data)`                         | 由 H5 挂载，原生按需推送                                      |

注入时机（客户端约定）：

- `window.__H5Bridge` 由 **H5 侧**（`@h5/bridge`）在模块加载时挂载到 `window`，无需客户端注入；
  客户端只需保证在调用回调前页面已加载 `@h5/bridge`。
- iOS / Android 的原生通道由客户端在 **`documentStart`** 阶段注入，避免 H5 早期调用丢失。
- H5 启动时先 `await bridge.ready()`（默认最长等待 1000ms），再发起业务调用；超时则按「不在 App 内」降级。
- H5 端调用优先走 iOS 通道，其次走 Android 通道；两者都不存在时立即以 `-2` 失败，不会挂起。

UA 约定：客户端在 UA 后追加 `MyApp/<版本号>`，例如 `MyApp/5.6.0`。H5 通过 `getUAInfo()` 解析出
`os / osVersion / device / appVersion`，用于监控公共字段与兼容判断。

## 2. 协议 JSON 结构

### 2.1 H5 → 原生（调用）

```json
{
  "method": "auth.getToken",
  "params": {},
  "callbackId": "cb_1731470000000_3",
  "version": 1
}
```

| 字段         | 类型     | 必填 | 说明                                                           |
| ------------ | -------- | ---- | -------------------------------------------------------------- |
| `method`     | `string` | 是   | 方法名，见第 4 节方法清单，形如 `领域.方法`                    |
| `params`     | `object` | 是   | 方法参数，无参数时为 `{}`，不得省略                            |
| `callbackId` | `string` | 是   | 本次调用的唯一 ID，格式 `cb_<时间戳>_<自增序号>`               |
| `version`    | `number` | 是   | 协议版本，当前固定为 `1`；客户端必须忽略未知字段以实现向前兼容 |

### 2.2 原生 → H5（回调）

```js
window.__H5Bridge.callback(callbackId, { code: 0, data: {}, msg: '' })
```

| 字段   | 类型     | 必填 | 说明                                       |
| ------ | -------- | ---- | ------------------------------------------ |
| `code` | `number` | 是   | 结果码，见第 3 节；`0` 表示成功            |
| `data` | `any`    | 是   | 成功时的返回数据；失败时可为 `null`        |
| `msg`  | `string` | 否   | 失败原因，用于日志与监控，不直接展示给用户 |

- 同一个 `callbackId` **必须且只能回调一次**；重复回调会被 H5 忽略。
- 回调必须在 `timeout` 之前完成，否则 H5 以 `-1` 超时失败（默认 10000ms，`auth.login` 为 120000ms）。
- `callbackId` 未知（例如已超时）时，H5 会忽略该回调，客户端无需处理。

### 2.3 原生 → H5（事件推送）

```js
window.__H5Bridge.emit('network.change', { type: 'wifi' })
```

事件表见第 6 节。未知事件名会被安全忽略。

## 3. 统一错误码表

| code   | 含义                                       | H5 侧处理                          | 是否上报监控 |
| ------ | ------------------------------------------ | ---------------------------------- | ------------ |
| `0`    | 成功                                       | `resolve(data)`                    | 否           |
| `1001` | 方法不存在（App 版本过旧）                 | `reject`，业务走降级（如隐藏入口） | 是           |
| `1002` | 参数错误                                   | `reject`，上报并修参数             | 是           |
| `1003` | 用户取消（取消分享 / 取消授权 / 取消扫码） | `reject`，业务一般静默             | 否           |
| `1004` | 权限拒绝（相机、定位、相册等）             | `reject`，提示引导用户去设置       | 是           |
| `-1`   | 前端超时（H5 侧产生）                      | `reject`，可重试或降级             | 是           |
| `-2`   | 不在 App 环境（H5 侧产生）                 | `reject`，走 mock 或 Web 降级      | 是           |

补充约定：

- H5 侧所有失败都以 `BridgeError` 抛出，携带 `code`（错误码）与 `method`（方法名），便于按方法聚合。
- 非 `0` 且非 `1003` 的结果统一经 `setBridgeErrorReporter()` 注入的上报钩子上报（设计文档 §11.2），
  bridge 本身不依赖 `@h5/monitor`；是否上报由 `@h5/core` 决定。
- 客户端新增错误码时必须同时更新本表；H5 会把未识别的码原样透出，不会吞掉。

## 4. 方法清单

约定：

- 「最低 App 版本」当前为 **占位值** `5.6.0`，客户端联调确认后回填；后续新增方法递增并在此标注。
- 负责人：`@client-ios` / `@client-android` 为双端实现负责人，`@h5-platform` 为 H5 侧接入与维护负责人。
- 入参中「必填=是」的字段缺失时，客户端返回 `1002`。

### 4.1 app

| 方法                  | 用途                                          | 入参       | 返回       | 错误码                      | 最低 App 版本 | 负责人                                       |
| --------------------- | --------------------------------------------- | ---------- | ---------- | --------------------------- | ------------- | -------------------------------------------- |
| `app.getInfo`         | 获取 App 版本、系统、机型、状态栏高度与安全区 | 无（`{}`） | `AppInfo`  | `0` `1001` `1002` `-1` `-2` | 5.6.0         | @client-ios / @client-android / @h5-platform |
| `app.getCapabilities` | 获取当前 App 支持的 Bridge 方法名列表         | 无（`{}`） | `string[]` | `0` `1001` `1002` `-1` `-2` | 5.6.0         | @client-ios / @client-android / @h5-platform |

`AppInfo` 字段：

| 字段              | 类型                          | 必填 | 说明                         |
| ----------------- | ----------------------------- | ---- | ---------------------------- |
| `appVersion`      | `string`                      | 是   | App 版本号，如 `5.6.0`       |
| `os`              | `'ios' \| 'android' \| 'web'` | 是   | 系统                         |
| `osVersion`       | `string`                      | 是   | 系统版本，如 `16.3`          |
| `device`          | `string`                      | 是   | 机型，如 `iPhone`、`Pixel 8` |
| `statusBarHeight` | `number`                      | 是   | 状态栏高度（px）             |
| `safeAreaTop`     | `number`                      | 否   | 安全区顶部（刘海屏）         |
| `safeAreaBottom`  | `number`                      | 否   | 安全区底部（Home 指示条）    |

> H5 接入层 `app.getCapabilities()` 会走缓存：整页只成功请求一次，并发调用共享同一请求。

### 4.2 auth

| 方法                | 用途                                        | 入参       | 返回          | 错误码                                    | 最低 App 版本 | 负责人                                       |
| ------------------- | ------------------------------------------- | ---------- | ------------- | ----------------------------------------- | ------------- | -------------------------------------------- |
| `auth.getToken`     | 获取当前登录态 token                        | 无（`{}`） | `TokenResult` | `0` `1001` `1002` `1004` `-1` `-2`        | 5.6.0         | @client-ios / @client-android / @h5-platform |
| `auth.refreshToken` | 刷新 token（H5 侧 401 后调用）              | 无（`{}`） | `TokenResult` | `0` `1001` `1002` `1004` `-1` `-2`        | 5.6.0         | @client-ios / @client-android / @h5-platform |
| `auth.login`        | 唤起原生登录（可能弹原生登录页，超时 120s） | 无（`{}`） | `void`        | `0` `1001` `1002` `1003` `1004` `-1` `-2` | 5.6.0         | @client-ios / @client-android / @h5-platform |
| `auth.logout`       | 退出登录，原生清理登录态                    | 无（`{}`） | `void`        | `0` `1001` `1002` `-1` `-2`               | 5.6.0         | @client-ios / @client-android / @h5-platform |

`TokenResult` 字段：

| 字段       | 类型     | 必填 | 说明                     |
| ---------- | -------- | ---- | ------------------------ |
| `token`    | `string` | 是   | 登录凭证，H5 只存内存    |
| `expireAt` | `number` | 是   | 过期时间，**毫秒**时间戳 |

> H5 不做登录页；token 只存内存，与原生登录态始终一致。登录态变化时客户端推送 `auth.change` 事件。

### 4.3 nav

| 方法                     | 用途                                                      | 入参                                              | 返回   | 错误码                      | 最低 App 版本 | 负责人                                       |
| ------------------------ | --------------------------------------------------------- | ------------------------------------------------- | ------ | --------------------------- | ------------- | -------------------------------------------- |
| `nav.open`               | 打开新页面（原生新 WebView 或站内路由）                   | `NavTarget`                                       | `void` | `0` `1001` `1002` `-1` `-2` | 5.6.0         | @client-ios / @client-android / @h5-platform |
| `nav.close`              | 关闭当前 WebView                                          | 无（`{}`）                                        | `void` | `0` `1001` `1002` `-1` `-2` | 5.6.0         | @client-ios / @client-android / @h5-platform |
| `nav.back`               | 返回上一页（原生导航返回）                                | 无（`{}`）                                        | `void` | `0` `1001` `1002` `-1` `-2` | 5.6.0         | @client-ios / @client-android / @h5-platform |
| `nav.setTitle`           | 设置原生导航栏标题                                        | `title: string`（必填）                           | `void` | `0` `1001` `1002` `-1` `-2` | 5.6.0         | @client-ios / @client-android / @h5-platform |
| `nav.setBar`             | 设置导航栏样式（标题、背景、文字色、隐藏）                | `NavBarOptions`                                   | `void` | `0` `1001` `1002` `-1` `-2` | 5.6.0         | @client-ios / @client-android / @h5-platform |
| `nav.setRightButtons`    | 设置导航栏右侧按钮                                        | `buttons: NavBarButton[]`（必填，可为空数组清除） | `void` | `0` `1001` `1002` `-1` `-2` | 5.6.0         | @client-ios / @client-android / @h5-platform |
| `nav.setBackInterceptor` | 开启/关闭原生返回拦截（开启后返回会先推 `nav.backPress`） | `enabled: boolean`（必填）                        | `void` | `0` `1001` `1002` `-1` `-2` | 5.6.0         | @client-ios / @client-android / @h5-platform |

`NavTarget` 字段：

| 字段       | 类型                         | 必填 | 说明                                |
| ---------- | ---------------------------- | ---- | ----------------------------------- |
| `url`      | `string`                     | 否   | 目标地址；站内相对路径或绝对 URL    |
| `route`    | `string`                     | 否   | 站内路由路径（H5 侧拼 base 后跳转） |
| `nav`      | `'native' \| 'h5' \| 'none'` | 否   | 目标页导航栏模式                    |
| `external` | `boolean`                    | 否   | 是否外部浏览器打开                  |
| `title`    | `string`                     | 否   | 目标页标题                          |

`NavBarOptions` 字段：

| 字段              | 类型      | 必填 | 说明               |
| ----------------- | --------- | ---- | ------------------ |
| `title`           | `string`  | 否   | 标题               |
| `backgroundColor` | `string`  | 否   | 背景色（十六进制） |
| `textColor`       | `string`  | 否   | 文字颜色           |
| `hidden`          | `boolean` | 否   | 是否隐藏导航栏     |

`NavBarButton` 字段：

| 字段   | 类型     | 必填 | 说明                                           |
| ------ | -------- | ---- | ---------------------------------------------- |
| `id`   | `string` | 是   | 按钮标识，点击时随 `nav.rightButtonClick` 回传 |
| `text` | `string` | 是   | 按钮文案                                       |
| `icon` | `string` | 否   | 图标名（客户端内置图标表）                     |

### 4.4 ui

| 方法         | 用途                                   | 入参                                      | 返回   | 错误码                             | 最低 App 版本 | 负责人                                       |
| ------------ | -------------------------------------- | ----------------------------------------- | ------ | ---------------------------------- | ------------- | -------------------------------------------- |
| `ui.toast`   | 原生 Toast（需要盖住原生导航栏时使用） | `message: string`（必填）+ `ToastOptions` | `void` | `0` `1001` `1002` `-1` `-2`        | 5.6.0         | @client-ios / @client-android / @h5-platform |
| `ui.loading` | 原生 Loading 显隐                      | `show: boolean`（必填）+ `text?: string`  | `void` | `0` `1001` `1002` `-1` `-2`        | 5.6.0         | @client-ios / @client-android / @h5-platform |
| `ui.alert`   | 原生 Alert 对话框                      | `AlertOptions`                            | `void` | `0` `1001` `1002` `1003` `-1` `-2` | 5.6.0         | @client-ios / @client-android / @h5-platform |

`ToastOptions` 字段：

| 字段       | 类型     | 必填 | 说明                          |
| ---------- | -------- | ---- | ----------------------------- |
| `duration` | `number` | 否   | 展示时长（毫秒），默认 `2000` |

`AlertOptions` 字段：

| 字段          | 类型     | 必填 | 说明                               |
| ------------- | -------- | ---- | ---------------------------------- |
| `title`       | `string` | 否   | 标题                               |
| `message`     | `string` | 是   | 正文                               |
| `confirmText` | `string` | 否   | 确认按钮文案，默认「确定」         |
| `cancelText`  | `string` | 否   | 取消按钮文案；不传则只显示确认按钮 |

### 4.5 share

| 方法         | 用途             | 入参           | 返回   | 错误码                                    | 最低 App 版本 | 负责人                                       |
| ------------ | ---------------- | -------------- | ------ | ----------------------------------------- | ------------- | -------------------------------------------- |
| `share.open` | 唤起原生分享面板 | `ShareOptions` | `void` | `0` `1001` `1002` `1003` `1004` `-1` `-2` | 5.6.0         | @client-ios / @client-android / @h5-platform |

`ShareOptions` 字段：

| 字段       | 类型     | 必填 | 说明       |
| ---------- | -------- | ---- | ---------- |
| `title`    | `string` | 否   | 分享标题   |
| `desc`     | `string` | 否   | 分享描述   |
| `link`     | `string` | 是   | 分享链接   |
| `imageUrl` | `string` | 否   | 分享图地址 |

### 4.6 device

| 方法                 | 用途                   | 入参                  | 返回           | 错误码                                    | 最低 App 版本 | 负责人                                       |
| -------------------- | ---------------------- | --------------------- | -------------- | ----------------------------------------- | ------------- | -------------------------------------------- |
| `device.getNetwork`  | 获取当前网络类型       | 无（`{}`）            | `NetworkInfo`  | `0` `1001` `1002` `-1` `-2`               | 5.6.0         | @client-ios / @client-android / @h5-platform |
| `device.getLocation` | 获取定位（会申请权限） | 无（`{}`）            | `LocationInfo` | `0` `1001` `1002` `1004` `-1` `-2`        | 5.6.0         | @client-ios / @client-android / @h5-platform |
| `device.scan`        | 唤起原生扫码           | `ScanOptions`         | `ScanResult`   | `0` `1001` `1002` `1003` `1004` `-1` `-2` | 5.6.0         | @client-ios / @client-android / @h5-platform |
| `device.vibrate`     | 震动反馈               | `durationMs?: number` | `void`         | `0` `1001` `1002` `-1` `-2`               | 5.6.0         | @client-ios / @client-android / @h5-platform |

`NetworkInfo` 字段：

| 字段            | 类型                                                            | 必填 | 说明                       |
| --------------- | --------------------------------------------------------------- | ---- | -------------------------- |
| `type`          | `'wifi' \| '4g' \| '5g' \| '3g' \| '2g' \| 'none' \| 'unknown'` | 是   | 网络类型                   |
| `effectiveType` | `string`                                                        | 否   | 生效网络制式，用于弱网判断 |

`LocationInfo` 字段：

| 字段        | 类型     | 必填 | 说明           |
| ----------- | -------- | ---- | -------------- |
| `latitude`  | `number` | 是   | 纬度           |
| `longitude` | `number` | 是   | 经度           |
| `address`   | `string` | 否   | 逆地理后的地址 |

`ScanOptions` 字段：

| 字段             | 类型      | 必填 | 说明                                             |
| ---------------- | --------- | ---- | ------------------------------------------------ |
| `onlyFromCamera` | `boolean` | 否   | 是否只允许相机扫码（默认 `false`，可从相册选图） |

`ScanResult` 字段：

| 字段   | 类型     | 必填 | 说明               |
| ------ | -------- | ---- | ------------------ |
| `text` | `string` | 是   | 扫码得到的原始文本 |

### 4.7 media

| 方法                 | 用途                         | 入参                  | 返回                | 错误码                                    | 最低 App 版本 | 负责人                                       |
| -------------------- | ---------------------------- | --------------------- | ------------------- | ----------------------------------------- | ------------- | -------------------------------------------- |
| `media.chooseImage`  | 选图（相机/相册）            | `ChooseImageOptions`  | `ChooseImageResult` | `0` `1001` `1002` `1003` `1004` `-1` `-2` | 5.6.0         | @client-ios / @client-android / @h5-platform |
| `media.previewImage` | 原生大图预览                 | `PreviewImageOptions` | `void`              | `0` `1001` `1002` `-1` `-2`               | 5.6.0         | @client-ios / @client-android / @h5-platform |
| `media.saveImage`    | 保存图片到相册（会申请权限） | `SaveImageOptions`    | `void`              | `0` `1001` `1002` `1004` `-1` `-2`        | 5.6.0         | @client-ios / @client-android / @h5-platform |

`ChooseImageOptions` 字段：

| 字段         | 类型                  | 必填 | 说明                   |
| ------------ | --------------------- | ---- | ---------------------- |
| `count`      | `number`              | 否   | 最多选择张数，默认 `1` |
| `sourceType` | `'camera' \| 'album'` | 否   | 来源，默认让用户选择   |

`ChooseImageResult` 字段：

| 字段    | 类型       | 必填 | 说明                                  |
| ------- | ---------- | ---- | ------------------------------------- |
| `paths` | `string[]` | 是   | 图片本地路径或可直接用于 `img` 的 URL |

`PreviewImageOptions` 字段：

| 字段    | 类型       | 必填 | 说明               |
| ------- | ---------- | ---- | ------------------ |
| `paths` | `string[]` | 是   | 全部图片地址       |
| `index` | `number`   | 否   | 起始下标，默认 `0` |

`SaveImageOptions` 字段：

| 字段   | 类型     | 必填 | 说明               |
| ------ | -------- | ---- | ------------------ |
| `path` | `string` | 是   | 图片地址或本地路径 |

### 4.8 storage

| 方法          | 用途                          | 入参                                        | 返回                             | 错误码                      | 最低 App 版本 | 负责人                                       |
| ------------- | ----------------------------- | ------------------------------------------- | -------------------------------- | --------------------------- | ------------- | -------------------------------------------- |
| `storage.get` | 读取跨 WebView 共享的轻量数据 | `key: string`（必填）                       | `any \| null`（不存在为 `null`） | `0` `1001` `1002` `-1` `-2` | 5.6.0         | @client-ios / @client-android / @h5-platform |
| `storage.set` | 写入跨 WebView 共享的轻量数据 | `key: string`（必填）+ `value: any`（必填） | `void`                           | `0` `1001` `1002` `-1` `-2` | 5.6.0         | @client-ios / @client-android / @h5-platform |

- 只用于少量、非敏感数据（如引导是否已展示）；token 等登录态禁止写入。
- 值在原生侧自行序列化；`value` 为 `null` 时视为删除该 key。

### 4.9 track

| 方法          | 用途                                      | 入参                                      | 返回   | 错误码                      | 最低 App 版本 | 负责人                                       |
| ------------- | ----------------------------------------- | ----------------------------------------- | ------ | --------------------------- | ------------- | -------------------------------------------- |
| `track.event` | 埋点上报，走 App 埋点 SDK，与原生同一会话 | `name: string`（必填）+ `params?: object` | `void` | `0` `1001` `1002` `-1` `-2` | 5.6.0         | @client-ios / @client-android / @h5-platform |

- 登录态、uid 由原生补齐，H5 不重复传。
- 不在 App 内时降级到 Web 埋点接口（由 `@h5/monitor` 实现，不经 Bridge）。

## 5. 事件推送表

原生 → H5 推送，H5 侧用 `bridge.on(event, fn)` 订阅，返回取消订阅函数。

| 事件                   | 触发时机                                   | 载荷                        | 最低 App 版本 | 负责人                                       |
| ---------------------- | ------------------------------------------ | --------------------------- | ------------- | -------------------------------------------- |
| `page.resume`          | 页面重新可见（WebView 回到前台）           | 无（`undefined`）           | 5.6.0         | @client-ios / @client-android / @h5-platform |
| `page.pause`           | 页面进入后台                               | 无（`undefined`）           | 5.6.0         | @client-ios / @client-android / @h5-platform |
| `network.change`       | 网络类型变化                               | `NetworkInfo`               | 5.6.0         | @client-ios / @client-android / @h5-platform |
| `nav.rightButtonClick` | 用户点击原生导航栏右侧按钮                 | `NavBarButton`              | 5.6.0         | @client-ios / @client-android / @h5-platform |
| `nav.backPress`        | 开启 `nav.setBackInterceptor` 后用户点返回 | 无（`undefined`）           | 5.6.0         | @client-ios / @client-android / @h5-platform |
| `auth.change`          | 登录态变化（登录、登出、token 刷新）       | `{ token: string \| null }` | 5.6.0         | @client-ios / @client-android / @h5-platform |

约定：

- 载荷必须是可 JSON 序列化的对象；无载荷事件传 `null` 或省略第二个参数均可。
- 单个监听器抛错不会影响其他监听器（H5 侧已 try/catch）。
- 事件名只增不改；废弃事件保留推送直至大版本下线，并在本表标注「已废弃」。

## 6. 就绪与能力探测流程

```
App 启动 WebView
  → 客户端在 documentStart 注入通道（iOS: window.webkit.messageHandlers.H5Bridge / Android: window.H5Bridge）
  → H5 加载 @h5/bridge，挂载 window.__H5Bridge
  → createH5App：await bridge.ready()        // 默认 1000ms，命中即 true，超时 false
  → 首个 canIUse / getInfo 触发一次 app.getCapabilities()，结果缓存在内存
  → 业务：bridge.canIUse('share.open') ? 显示分享按钮 : 隐藏入口
  → 每次调用：method + callbackId 发出 → 原生回调 code/data/msg → resolve / reject
```

关键规则：

1. `ready(timeoutMs = 1000)`：短轮询注入对象 + 硬截止时间，命中立即 `true`，超时 `false`；可并发、可重复调用。
2. `canIUse(method)` **同步**，对缓存判断；**能力未知且通道存在（或开启 mock）时返回 `true`**，
   避免旧版 App 上误判把功能整块隐藏；能力列表加载失败时保持「未知」状态，后续调用可重试。
3. 能力列表整页只成功请求一次；本页生命周期的后续判断都走缓存。
4. 方法不存在（`1001`）必须作为失败抛出，业务据此降级，不得静默吞掉。

## 7. 版本兼容规则

- **只增不改**：已发布的方法名、参数名、返回字段、事件名不得删除或改语义。
- **改语义就新增方法名**：例如 `share.open` 语义需要变化时新增 `share.openV2`，旧方法保留至大版本下线。
- 新增**可选**参数可直接加；新增**必填**参数必须通过新方法名或按参数存在性做兼容分支。
- 返回对象只允许新增字段；客户端不得依赖 H5 一定读取某个字段。
- 每个方法必须标注最低 App 版本；H5 在低于该版本的 App 上必须能通过 `canIUse` + `1001` 双保险降级。
- 协议 `version` 字段用于破坏性变更探测；`version` 递增时表示旧 H5 可能无法工作，需双端灰度。

## 8. 浏览器 mock 行为说明

`env.isApp === false`（PC 浏览器、E2E、本地开发）时由 `@h5/core` 调用
`configureMock(adapter)` 开启 mock。开启后 `invoke` 直接走 mock 实现，不依赖原生通道，
`ready()` 立即返回 `true`，`canIUse()` 在能力未知时返回 `true`。

| 方法                                                              | 默认行为（未注入 adapter）                                                                                                          |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `app.getInfo`                                                     | 由 UA 解析出 `os / osVersion / device`，`appVersion = 'mock'`，`statusBarHeight = 0`，安全区为 `0`                                  |
| `app.getCapabilities`                                             | 返回全部已定义方法名                                                                                                                |
| `auth.getToken` / `auth.refreshToken`                             | 返回 `{ token: 'mock-token', expireAt: 当前时间 + 7 天 }`；注入了 `getToken` 则用其返回值，返回 `null` 表示未登录（以 `1004` 拒绝） |
| `auth.login` / `auth.logout`                                      | 直接 resolve                                                                                                                        |
| `nav.open` / `nav.back`                                           | `history.pushState` / `history.back`（`external` 时 `window.open`）                                                                 |
| `nav.close` / `setBar` / `setRightButtons` / `setBackInterceptor` | 直接 resolve                                                                                                                        |
| `nav.setTitle`                                                    | 设置 `document.title`                                                                                                               |
| `ui.toast` / `ui.alert` / `ui.loading`                            | `console.info` 输出                                                                                                                 |
| `share.open`                                                      | `console.info` 输出链接                                                                                                             |
| `device.getNetwork`                                               | 由 `navigator.onLine` / `navigator.connection` 推断                                                                                 |
| `device.getLocation`                                              | `{ latitude: 0, longitude: 0 }`（可注入 `location`）                                                                                |
| `device.scan`                                                     | `{ text: '' }`                                                                                                                      |
| `device.vibrate`                                                  | `navigator.vibrate` 可用时调用，否则忽略                                                                                            |
| `media.chooseImage`                                               | `{ paths: [] }`                                                                                                                     |
| `media.previewImage` / `media.saveImage`                          | 直接 resolve                                                                                                                        |
| `storage.get` / `storage.set`                                     | 默认 `localStorage`（key 前缀 `h5:bridge:mock:`，值为 JSON）；不可用时退化为内存 Map                                                |
| `track.event`                                                     | `console.info` 输出                                                                                                                 |
| 未定义的方法                                                      | 以 `1001` 拒绝（与真机一致）                                                                                                        |

可注入能力（`MockAdapter`）：`toast`、`alert`、`getToken`、`storage`、`capabilities`、
`trackEvent`、`location`、`network`、`share`、`open`、`handlers`（任意方法的自定义实现）。
注入的 `storage` 使用原始 key（不加前缀），便于与业务存储对齐。

mock 的硬约束：**bridge 不依赖 vant / vue / axios**，所有 UI 行为都由 `@h5/core` 注入；
未注入时 mock 必须仍可跑通，且不抛错。

## 9. 变更流程

1. **提需求**：H5 提出方法与参数草案（用途、入参、返回、错误码、最低 App 版本）。
2. **双方评审**：本文档改动 + 客户端实现方案一起评审，确认错误码与降级路径。
3. **客户端实现**：双端实现并在测试包中提供，同步在 Bridge 调试页（`apps/bridge-playground`）可调用。
4. **H5 接入**：在 `packages/bridge` 增加方法名常量、类型与 API，补 mock 实现与单测。
5. **回归**：双端测试包各跑一遍调试页，标注最低版本并发布协议文档更新。

禁止事项：

- 禁止只改代码不改本文档；
- 禁止删除/改名已上线的方法与事件；
- 禁止业务绕过 `@h5/bridge` 直接访问 `window.webkit` / `window.H5Bridge`（ESLint 拦截）。

## 10. 变更记录

| 日期       | 版本   | 变更内容                                                                                      | 变更人       |
| ---------- | ------ | --------------------------------------------------------------------------------------------- | ------------ |
| 2026-11-13 | v1.0.0 | 首版：定义通道与注入时机、协议 JSON 结构、错误码表、27 个方法、6 个事件、能力探测与 mock 行为 | @h5-platform |
