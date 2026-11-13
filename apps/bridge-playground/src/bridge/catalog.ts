import { CODE, METHODS } from '@h5/bridge'
import type { BridgeMethod } from '@h5/bridge'

type Domain = keyof typeof METHODS

/** 领域中文名：与 docs/bridge-protocol.md 第 4 节的小节一一对应。 */
const DOMAIN_LABELS: Record<Domain, string> = {
  app: 'app · 应用信息',
  auth: 'auth · 登录态',
  nav: 'nav · 导航',
  ui: 'ui · UI 反馈',
  share: 'share · 分享',
  device: 'device · 设备',
  media: 'media · 媒体',
  storage: 'storage · 存储',
  track: 'track · 埋点',
}

/**
 * 每个方法的默认参数：客户端自测时不必自己拼 JSON。
 * 方法名一律取自 METHODS，不在页面里硬编码字符串（设计文档 5.2 / 12.1）。
 */
const DEFAULT_PARAMS: Partial<Record<BridgeMethod, Record<string, unknown>>> = {
  [METHODS.nav.open]: { url: '/activity/', nav: 'none' },
  [METHODS.nav.setTitle]: { title: 'Bridge 调试' },
  [METHODS.nav.setBar]: { title: 'Bridge 调试', backgroundColor: '#ffffff', textColor: '#323233' },
  [METHODS.nav.setRightButtons]: { buttons: [{ id: 'help', text: '帮助' }] },
  [METHODS.nav.setBackInterceptor]: { enabled: true },
  [METHODS.ui.toast]: { message: '来自 bridge-playground 的 Toast' },
  [METHODS.ui.loading]: { show: true, text: '加载中' },
  [METHODS.ui.alert]: { message: '来自 bridge-playground 的 Alert', confirmText: '好' },
  [METHODS.share.open]: {
    title: 'Bridge 调试页',
    desc: '客户端自测与回归用',
    link: 'https://h5.example.com/bridge-playground/',
  },
  [METHODS.device.vibrate]: { durationMs: 30 },
  [METHODS.media.saveImage]: { url: 'https://img.example.com/demo.png' },
  [METHODS.media.previewImage]: { urls: ['https://img.example.com/demo.png'], current: 0 },
  [METHODS.storage.set]: { key: 'playground-demo', value: 'hello' },
  [METHODS.storage.get]: { key: 'playground-demo' },
  [METHODS.track.event]: { event: 'playground_call', params: { source: 'bridge-playground' } },
}

export interface MethodEntry {
  method: BridgeMethod
  /** 展示用短名（去掉领域前缀）。 */
  name: string
  /** params 编辑器的初始 JSON。 */
  paramsJson: string
}

export interface DomainGroup {
  domain: Domain
  label: string
  methods: MethodEntry[]
}

/** 按领域分组的全部 Bridge 方法，顺序与协议文档一致。 */
export const METHOD_GROUPS: DomainGroup[] = (Object.keys(METHODS) as Domain[]).map((domain) => ({
  domain,
  label: DOMAIN_LABELS[domain],
  methods: (Object.values(METHODS[domain]) as BridgeMethod[]).map((method) => ({
    method,
    name: method.slice(method.indexOf('.') + 1),
    paramsJson: JSON.stringify(DEFAULT_PARAMS[method] ?? {}, null, 2),
  })),
}))

/** 错误码说明：调试页要能让客户端一眼看出 mock 与原生、超时与方法缺失的区别。 */
export const CODE_LABELS: Record<number, string> = {
  [CODE.OK]: '0 · 成功',
  [CODE.NOT_FOUND]: '1001 · 方法不存在（App 版本过旧）',
  [CODE.BAD_PARAMS]: '1002 · 参数错误',
  [CODE.CANCELED]: '1003 · 用户取消',
  [CODE.DENIED]: '1004 · 权限拒绝',
  [CODE.TIMEOUT]: '-1 · 超时（H5 侧产生，原生未在超时时间内回调）',
  [CODE.NOT_IN_APP]: '-2 · 不在 App 内（H5 侧产生，没有原生通道）',
}

/** -1 / -2 的环境提示：这两种码不来自客户端实现，需要单独解释。 */
export const CODE_HINTS: Record<number, string> = {
  [CODE.NOT_IN_APP]:
    '当前没有原生通道：浏览器里属正常（core 已开 mock，理论上不会出现），App 内出现请确认客户端在 documentStart 注入了通道。',
  [CODE.TIMEOUT]:
    '原生在超时时间内没有回调：先在 App 内重试一次，仍超时请把方法与时间点同步给客户端。',
}
