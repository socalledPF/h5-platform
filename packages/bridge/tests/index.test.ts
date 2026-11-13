import { describe, expect, it } from 'vitest'
import * as bridge from '../src/index'

describe('公开契约（其他包依赖，不得改名或删减）', () => {
  it('协议版本与错误码', () => {
    expect(bridge.BRIDGE_VERSION).toBe(1)
    expect(bridge.CODE).toEqual({
      OK: 0,
      NOT_FOUND: 1001,
      BAD_PARAMS: 1002,
      CANCELED: 1003,
      DENIED: 1004,
      TIMEOUT: -1,
      NOT_IN_APP: -2,
    })
  })

  it('BridgeError 携带 code 与 method', () => {
    const error = new bridge.BridgeError(bridge.CODE.DENIED, 'denied', 'share.open')

    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('BridgeError')
    expect(error.code).toBe(bridge.CODE.DENIED)
    expect(error.method).toBe('share.open')
    expect(error.message).toBe('denied')

    expect(new bridge.BridgeError(bridge.CODE.TIMEOUT, '', 'nav.back').message).toContain(
      'nav.back',
    )
  })

  it('导出全部基础函数', () => {
    const functions = [
      'invoke',
      'on',
      'off',
      'ready',
      'isAvailable',
      'canIUse',
      'getUAInfo',
      'configureMock',
      'setBridgeErrorReporter',
    ] as const

    for (const name of functions) expect(typeof bridge[name]).toBe('function')
  })

  it('领域 API 的方法集合与契约一致', () => {
    expect(Object.keys(bridge.app).sort()).toEqual(['getCapabilities', 'getInfo'])
    expect(Object.keys(bridge.auth).sort()).toEqual(['getToken', 'login', 'logout', 'refreshToken'])
    expect(Object.keys(bridge.nav).sort()).toEqual([
      'back',
      'close',
      'open',
      'setBackInterceptor',
      'setBar',
      'setRightButtons',
      'setTitle',
    ])
    expect(Object.keys(bridge.ui).sort()).toEqual(['alert', 'loading', 'toast'])
    expect(Object.keys(bridge.share).sort()).toEqual(['open'])
    expect(Object.keys(bridge.device).sort()).toEqual([
      'getLocation',
      'getNetwork',
      'scan',
      'vibrate',
    ])
    expect(Object.keys(bridge.media).sort()).toEqual(['chooseImage', 'previewImage', 'saveImage'])
    expect(Object.keys(bridge.storage).sort()).toEqual(['get', 'set'])
    expect(Object.keys(bridge.track).sort()).toEqual(['event'])
  })

  it('方法名常量覆盖 27 个方法且统一为「领域.方法」', () => {
    expect(bridge.METHOD_LIST).toHaveLength(27)
    expect(new Set(bridge.METHOD_LIST).size).toBe(27)
    for (const method of bridge.METHOD_LIST) expect(method).toMatch(/^[a-z]+\.[a-zA-Z]+$/)

    expect(bridge.METHODS.auth.login).toBe('auth.login')
    expect(bridge.METHODS.nav.setRightButtons).toBe('nav.setRightButtons')
    expect(bridge.METHODS.track.event).toBe('track.event')
  })

  it('getUAInfo 在无 App 环境下给出 web 结果', () => {
    expect(bridge.getUAInfo()).toMatchObject({ os: expect.stringMatching(/^(ios|android|web)$/) })
  })
})
