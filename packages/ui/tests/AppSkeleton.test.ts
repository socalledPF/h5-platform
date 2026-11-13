import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { h } from 'vue'
import { AppSkeleton } from '../src/index'

describe('AppSkeleton', () => {
  it('默认 loading：3 行骨架，不渲染业务内容', () => {
    const wrapper = mount(AppSkeleton, { slots: { default: () => h('p', '真实内容') } })

    expect(wrapper.find('[data-testid="app-skeleton"]').exists()).toBe(true)
    expect(wrapper.findAll('.app-skeleton__row')).toHaveLength(3)
    expect(wrapper.find('.app-skeleton__avatar').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('真实内容')
    expect(wrapper.attributes('aria-busy')).toBe('true')
  })

  it('rows 控制行数，avatar 控制头像块', () => {
    const wrapper = mount(AppSkeleton, { props: { rows: 5, avatar: true } })

    expect(wrapper.findAll('.app-skeleton__row')).toHaveLength(5)
    expect(wrapper.find('.app-skeleton__avatar').exists()).toBe(true)
  })

  it('loading=false 时渲染默认插槽的真实内容', () => {
    const wrapper = mount(AppSkeleton, {
      props: { loading: false },
      slots: { default: () => h('p', '真实内容') },
    })

    expect(wrapper.find('[data-testid="app-skeleton"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('真实内容')
  })
})
