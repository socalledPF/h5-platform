import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { h } from 'vue'
import { AppEmpty } from '../src/index'

describe('AppEmpty', () => {
  it('默认文案', () => {
    const wrapper = mount(AppEmpty)

    expect(wrapper.find('.app-empty__description').text()).toBe('暂无数据')
    expect(wrapper.find('svg').exists()).toBe(true)
  })

  it('自定义文案与插图', () => {
    const wrapper = mount(AppEmpty, {
      props: { description: '还没有订单', image: '/empty-order.png' },
    })

    expect(wrapper.find('.app-empty__description').text()).toBe('还没有订单')
    expect(wrapper.find('img').attributes('src')).toBe('/empty-order.png')
    expect(wrapper.find('svg').exists()).toBe(false)
  })

  it('默认插槽放操作按钮', () => {
    const wrapper = mount(AppEmpty, {
      slots: { default: () => h('button', { class: 'go' }, '去逛逛') },
    })

    expect(wrapper.find('.app-empty__action .go').text()).toBe('去逛逛')
  })
})
