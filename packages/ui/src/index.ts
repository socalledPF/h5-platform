/**
 * @h5/ui —— 跨业务复用的移动端组件。
 *
 * 业务只写一次 `<AppNavBar>`，原生模式与 H5 模式行为一致（设计文档 7.2）：
 *
 * ```vue
 * <AppPage>
 *   <AppNavBar title="我的订单" :right="[{ id: 'help', text: '帮助' }]" @right-click="onHelp" />
 *   <AppSkeleton :loading="loading" :rows="4">
 *     <OrderList :items="items" />
 *   </AppSkeleton>
 *   <AppEmpty v-if="!loading && !items.length" description="还没有订单">
 *     <van-button type="primary" @click="goShopping">去逛逛</van-button>
 *   </AppEmpty>
 * </AppPage>
 * ```

 */

import AppEmpty from './components/AppEmpty.vue'
import AppNavBar from './components/AppNavBar.vue'
import AppPage from './components/AppPage.vue'
import AppSkeleton from './components/AppSkeleton.vue'

/** 包名，供跨包自检与日志区分使用。 */
export const PACKAGE_NAME = '@h5/ui'

export { AppEmpty, AppNavBar, AppPage, AppSkeleton }
export type { AppEmptyProps, AppNavBarProps, AppPageProps, AppSkeletonProps } from './types'
