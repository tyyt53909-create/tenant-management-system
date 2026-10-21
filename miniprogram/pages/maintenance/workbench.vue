<template>
  <view class="workbench">
    <view class="wb-header">
      <view class="wb-heading">
        <text class="q-eyebrow">MAINTENANCE / 维修工作台</text>
        <text class="q-title">把问题处理好。</text>
        <text class="q-description">公共池工单先接先得；标记「指派给我」的工单由你负责。</text>
      </view>
      <button class="wb-logout" :disabled="loading || !!busyId" @tap="logout">退出</button>
    </view>

    <view class="wb-toolbar">
      <text>{{ authorized ? `当前 ${total} 单` : loading ? '正在确认登录身份' : '工单暂未加载' }}</text>
      <view class="wb-tools">
        <view class="wb-tool" @tap="goToNotifications">
          <text>通知</text>
          <text v-if="unreadCount > 0" class="wb-badge">{{ unreadCount > 99 ? '99+' : unreadCount }}</text>
        </view>
        <view class="wb-tool" @tap="refresh">刷新</view>
      </view>
    </view>

    <view class="q-tabs">
      <view
        v-for="tab in tabs"
        :key="tab.value"
        :class="['q-tab', { active: view === tab.value }]"
        @tap="switchView(tab.value)"
      >
        {{ tab.label }}
      </view>
    </view>

    <view v-if="error" class="q-error" @tap="refresh">{{ error }} · 点此重试</view>

    <view v-if="loading && orders.length === 0" class="q-skeleton"><view /><view /><view /></view>
    <view v-else-if="!error && authorized && orders.length === 0" class="q-surface q-empty wb-empty">
      <text class="q-empty-title">{{ emptyTitle }}</text>
      <text>{{ emptyHint }}</text>
    </view>

    <view v-for="order in orders" :key="order.id" class="q-surface wb-card" @tap="openDetail(order.id)">
      <view class="wb-card-top">
        <text class="wb-room">{{ order.buildingName }} · {{ order.roomNumber }} <text v-if="order.floor">· {{ order.floor }} 楼</text></text>
        <text :class="['q-pill', priorityClass(order.priority)]">{{ priorityLabel(order.priority) }}</text>
      </view>
      <view class="wb-title-row">
        <text class="wb-title">{{ order.title }}</text>
        <text :class="['q-pill', order.isPool ? 'warn' : '']">{{ statusLabel(order) }}</text>
      </view>
      <text class="wb-desc">{{ order.description }}</text>
      <view class="wb-meta">
        <text>{{ categoryLabel(order.category) }} · {{ formatDate(order.createdAt) }}</text>
        <text v-if="order.photoCount">{{ order.photoCount }} 张照片</text>
      </view>
      <view v-if="view === 'pool'" class="wb-actions">
        <button class="q-primary" :disabled="loading || !!busyId" :loading="busyId === order.id" @tap.stop="claim(order)">
          {{ order.isPool ? '接单处理' : '开始处理' }}
        </button>
      </view>
    </view>

    <button v-if="authorized && orders.length > 0 && page < totalPages" class="wb-more" :disabled="loading || !!busyId" :loading="loading" @tap="loadMore">加载更多</button>
    <text v-else-if="orders.length > 0" class="wb-end">已显示全部工单</text>
  </view>
</template>

<script>
import { getUserInfo, getWorkbenchOrders, claimMaintenance, getUnreadCount } from '../../api/index.js'
import { logoutSession, openHome } from '../../utils/session.js'

export default {
  data() {
    return {
      authorized: false, view: 'pool', orders: [], total: 0, page: 0, totalPages: 0,
      loading: false, busyId: '', error: '', unreadCount: 0,
      tabs: [
        { value: 'pool', label: '待接单' },
        { value: 'active', label: '进行中' },
        { value: 'done', label: '已完成' },
      ],
    }
  },
  computed: {
    emptyTitle() {
      return { pool: '公共池暂无待接工单', active: '没有进行中的工单', done: '还没有完成的工单' }[this.view]
    },
    emptyHint() {
      return {
        pool: '管理者派单后会出现在这里，下拉可刷新。',
        active: '接单后的工单会在这里，完成后等待租客确认。',
        done: '完成并确认的工单会留在这里，方便回看处理记录。',
      }[this.view]
    },
  },
  onShow() {
    this.refresh()
    this.loadUnreadCount()
  },
  async onPullDownRefresh() {
    try { await this.refresh() } finally { uni.stopPullDownRefresh() }
  },
  onReachBottom() {
    this.loadMore()
  },
  methods: {
    async loadUnreadCount() {
      if (!uni.getStorageSync('access_token')) return
      try {
        const res = await getUnreadCount()
        this.unreadCount = res.unreadCount || 0
      } catch (error) {
        console.warn('加载未读数失败:', error)
      }
    },
    goToNotifications() {
      uni.navigateTo({ url: '/pages/notifications/notifications' })
    },
    async refresh() {
      if (this.loading || this.busyId) return
      this.loading = true
      this.error = ''
      this.authorized = false
      try {
        if (!uni.getStorageSync('access_token')) {
          this.orders = []
          uni.reLaunch({ url: '/pages/login/login' })
          return
        }
        const user = await getUserInfo()
        uni.setStorageSync('user_role', user.role)
        if (user.role !== 'MAINTENANCE') {
          this.orders = []
          openHome(user.role)
          return
        }
        this.authorized = true
        await this.fetchPage(1)
      } catch (error) {
        this.orders = []
        this.error = error.message || '暂时无法加载，请重试'
      } finally {
        this.loading = false
      }
    },
    async fetchPage(page) {
      const result = await getWorkbenchOrders({ view: this.view, page, limit: 20 })
      // 白名单投影：不保存租客姓名、电话等资料，列表只展示维修所需信息。
      const orders = (result.data || []).map(order => ({
        id: order.id,
        title: order.title,
        description: order.description,
        category: order.category,
        priority: order.priority,
        status: order.status,
        assignedTo: order.assignedTo,
        isPool: order.status === 'ASSIGNED' && !order.assignedTo,
        roomNumber: order.room?.roomNumber || '未关联房源',
        floor: order.room?.floor ?? null,
        buildingName: order.room?.building?.name || '未命名楼栋',
        photoCount: Array.isArray(order.photos) ? order.photos.length : 0,
        createdAt: order.createdAt,
      }))
      this.orders = page === 1 ? orders : [...this.orders, ...orders]
      this.page = result.meta.page
      this.totalPages = result.meta.totalPages
      this.total = result.meta.total
    },
    async loadMore() {
      if (!this.authorized || this.loading || this.busyId || this.page >= this.totalPages) return
      this.loading = true
      this.error = ''
      try {
        await this.fetchPage(this.page + 1)
      } catch (error) {
        this.error = error.message || '加载失败，请重试'
      } finally {
        this.loading = false
      }
    },
    switchView(view) {
      if (this.loading || this.busyId || this.view === view) return
      this.view = view
      this.orders = []
      this.page = 0
      this.total = 0
      this.totalPages = 0
      this.refresh()
    },
    async claim(order) {
      if (!this.authorized || this.loading || this.busyId) return
      const confirmed = await new Promise(resolve => uni.showModal({
        title: '承接工单',
        content: `确认承接「${order.title}」并开始处理？`,
        success: result => resolve(result.confirm),
        fail: () => resolve(false),
      }))
      if (!confirmed) return
      this.busyId = order.id
      this.error = ''
      try {
        await claimMaintenance(order.id)
        uni.showToast({ title: '已接单，开始处理', icon: 'success' })
        await this.fetchPage(1)
      } catch (error) {
        if ([404, 409].includes(error.statusCode)) {
          this.error = '工单已被其他维修人员接单，已刷新列表'
          try { await this.fetchPage(1) } catch {
            this.error = '工单状态已变化，请重新加载'
          }
        } else {
          this.error = error.message || '接单失败，请刷新后重试'
        }
      } finally {
        this.busyId = ''
      }
    },
    openDetail(id) {
      uni.navigateTo({ url: `/pages/maintenance/workbench-detail?id=${encodeURIComponent(id)}` })
    },
    priorityLabel(priority) {
      return { LOW: '低', NORMAL: '普通', URGENT: '紧急' }[priority] || priority
    },
    priorityClass(priority) {
      return priority === 'URGENT' ? 'danger' : priority === 'LOW' ? 'quiet' : ''
    },
    categoryLabel(category) {
      return {
        PLUMBING: '水管', ELECTRICAL: '电路', APPLIANCE: '家电',
        FURNITURE: '家具', DOOR_WINDOW: '门窗', OTHER: '其他',
      }[category] || category
    },
    statusLabel(order) {
      if (order.status === 'ASSIGNED') return order.isPool ? '公共池' : '指派给我'
      return {
        IN_PROGRESS: '维修中', PENDING_CONFIRM: '待确认',
        COMPLETED: '已完成', CANCELLED: '已取消',
      }[order.status] || order.status
    },
    formatDate(date) {
      return date?.replace('T', ' ').slice(0, 16) || '—'
    },
    logout() {
      if (this.loading || this.busyId) return
      uni.showModal({
        title: '退出登录',
        content: '确定退出维修工作台吗？',
        success: result => {
          if (!result.confirm) return
          this.authorized = false
          this.orders = []
          logoutSession()
          uni.reLaunch({ url: '/pages/login/login' })
        },
      })
    },
  },
}
</script>

<style scoped>
.workbench { min-height: 100vh; box-sizing: border-box; padding: calc(42rpx + var(--status-bar-height, 0px)) 36rpx 64rpx; background: #f5f2ec; color: #302f2a; }
.wb-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 20rpx; margin-bottom: 36rpx; }
.wb-heading { flex: 1; min-width: 0; }
.wb-logout { flex-shrink: 0; margin: 0; padding: 16rpx 8rpx; background: transparent; color: #68715b; font-size: 24rpx; line-height: 1.5; }
.wb-logout::after { border: none; }
.wb-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 16rpx; font-size: 24rpx; color: #817e76; margin-bottom: 8rpx; }
.wb-tools { display: flex; align-items: center; gap: 24rpx; }
.wb-tool { display: flex; align-items: center; gap: 6rpx; color: #68715b; }
.wb-badge { min-width: 30rpx; height: 30rpx; line-height: 30rpx; padding: 0 8rpx; border-radius: 15rpx; background: #c16f62; color: #fffefa; font-size: 18rpx; text-align: center; }
.wb-empty { margin-top: 24rpx; }
.wb-card { margin-bottom: 24rpx; padding: 30rpx; }
.wb-card-top { display: flex; align-items: center; justify-content: space-between; gap: 16rpx; }
.wb-room { font-size: 22rpx; color: #817e76; overflow-wrap: anywhere; }
.wb-title-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 16rpx; margin-top: 18rpx; }
.wb-title { flex: 1; min-width: 0; font-size: 30rpx; font-weight: 550; line-height: 1.45; }
.wb-desc { display: block; margin-top: 14rpx; font-size: 23rpx; color: #817e76; line-height: 1.7; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.wb-meta { display: flex; align-items: center; justify-content: space-between; gap: 16rpx; margin-top: 20rpx; font-size: 20rpx; color: #a49f95; }
.wb-actions { margin-top: 24rpx; }
.wb-actions .q-primary { min-height: 76rpx; font-size: 24rpx; border-radius: 18rpx; }
.wb-more { margin-top: 8rpx; padding: 22rpx; background: transparent; color: #68715b; font-size: 24rpx; border: 1rpx solid #d7d8cc; border-radius: 20rpx; }
.wb-more::after { border: none; }
.wb-end { display: block; text-align: center; padding: 24rpx; font-size: 20rpx; color: #a49f95; }
button[disabled] { opacity: .55; }
</style>
