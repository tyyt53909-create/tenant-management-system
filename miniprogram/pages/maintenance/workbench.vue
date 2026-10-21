<template>
  <view class="q-page workbench-page">
    <view class="wb-header">
      <view class="wb-heading">
        <text class="q-eyebrow">MAINTENANCE / 维修工作台</text>
        <text class="q-title">把问题处理好。</text>
        <text class="q-description">公共池工单先接先得；标记「指派给我」的工单由你负责。</text>
      </view>
    </view>

    <view class="wb-brief">
      <view class="wb-brief-main">
        <text class="wb-brief-label">{{ viewLabel }}</text>
        <text class="wb-brief-hint">{{ viewHint }}</text>
      </view>
      <view class="wb-brief-count">
        <text class="wb-brief-number">{{ total }}</text>
        <text class="wb-brief-unit">单</text>
      </view>
    </view>

    <view class="wb-toolbar">
      <text class="wb-sync">{{ loading ? '正在同步工单…' : '以最新工单状态为准' }}</text>
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

    <view class="wb-search">
      <input
        v-model="keyword"
        class="wb-search-input"
        confirm-type="search"
        placeholder="搜索房间、标题或描述"
        placeholder-style="color:#a49f95"
        @confirm="applySearch"
      />
      <text v-if="keyword" class="wb-search-clear" @tap="clearKeyword">×</text>
    </view>
    <scroll-view scroll-x class="wb-filters" :show-scrollbar="false">
      <view
        v-for="option in filterOptions"
        :key="option.key"
        :class="['wb-filter', { active: activeFilter === option.key }]"
        @tap="selectFilter(option.key)"
      >
        {{ option.label }}
      </view>
    </scroll-view>

    <view v-if="error" class="q-error" @tap="refresh">{{ error }} · 点此重试</view>

    <view v-if="loading && orders.length === 0" class="wb-skeleton">
      <view v-for="n in 3" :key="n" class="wb-skeleton-card" />
    </view>
    <view v-else-if="!error && authorized && orders.length === 0" class="q-surface wb-empty">
      <view class="wb-empty-icon"><QIcon name="check" :size="56" /></view>
      <text class="q-empty-title">{{ emptyTitle }}</text>
      <text>{{ emptyHint }}</text>
      <button class="q-outline wb-empty-action" @tap="hasFilters ? clearFilters() : refresh()">{{ hasFilters ? '清除筛选' : '刷新任务' }}</button>
    </view>

    <view v-for="order in orders" :key="order.id" class="q-surface wb-card" @tap="openDetail(order.id)">
      <view class="wb-room">
        <text class="wb-room-number">{{ order.roomNumber }}</text>
        <text class="wb-room-floor">{{ order.floor ? `${order.floor}F` : '—' }}</text>
      </view>
      <view class="wb-card-copy">
        <view class="wb-card-head">
          <text class="wb-card-title">{{ order.title }}</text>
          <text :class="['q-pill', statusClass(order)]">{{ statusLabel(order) }}</text>
        </view>
        <text class="wb-card-desc">{{ order.description }}</text>
        <view class="wb-card-meta">
          <text>{{ order.buildingName }}</text>
          <text class="wb-sep">·</text>
          <text>{{ categoryLabel(order.category) }}</text>
          <text class="wb-sep">·</text>
          <text>{{ formatDate(order.createdAt) }}</text>
        </view>
        <view class="wb-card-foot">
          <view class="wb-tags">
            <text v-if="order.priority === 'URGENT'" class="wb-tag wb-tag-urgent">紧急</text>
            <text v-if="order.photoCount" class="wb-tag">{{ order.photoCount }} 张照片</text>
          </view>
          <button v-if="view === 'pool'" class="wb-claim" :disabled="loading || !!busyId" :loading="busyId === order.id" @tap.stop="claim(order)">
            {{ order.isPool ? '接单' : '开始' }}
          </button>
          <text v-else class="wb-arrow">详情 ›</text>
        </view>
      </view>
    </view>

    <button v-if="authorized && orders.length > 0 && page < totalPages" class="wb-more" :disabled="loading || !!busyId" :loading="loading" @tap="loadMore">加载更多</button>
    <text v-else-if="orders.length > 0" class="wb-end">已显示全部工单</text>

    <RoleTabBar active="work" />
  </view>
</template>

<script>
import QIcon from '../../components/QIcon.vue'
import RoleTabBar from '../../components/RoleTabBar.vue'
import { getUserInfo, getWorkbenchOrders, claimMaintenance, getUnreadCount } from '../../api/index.js'
import { openHome } from '../../utils/session.js'

export default {
  components: { QIcon, RoleTabBar },
  data() {
    return {
      authorized: false, view: 'pool', orders: [], total: 0, page: 0, totalPages: 0,
      loading: false, busyId: '', error: '', unreadCount: 0,
      keyword: '', activeFilter: 'all',
      filterOptions: [
        { key: 'all', label: '全部' },
        { key: 'urgent', label: '紧急' },
        { key: 'PLUMBING', label: '水管' },
        { key: 'ELECTRICAL', label: '电路' },
        { key: 'APPLIANCE', label: '家电' },
        { key: 'FURNITURE', label: '家具' },
        { key: 'DOOR_WINDOW', label: '门窗' },
        { key: 'OTHER', label: '其他' },
      ],
      tabs: [
        { value: 'pool', label: '待接单' },
        { value: 'active', label: '进行中' },
        { value: 'done', label: '已完成' },
      ],
    }
  },
  computed: {
    hasFilters() {
      return this.activeFilter !== 'all' || this.keyword.trim().length > 0
    },
    filterParams() {
      if (this.activeFilter === 'urgent') return { priority: 'URGENT' }
      if (this.activeFilter !== 'all') return { category: this.activeFilter }
      return {}
    },
    viewLabel() {
      return { pool: '待接单', active: '进行中', done: '已完成' }[this.view]
    },
    viewHint() {
      return {
        pool: '公共池先接先得，紧急工单优先处理',
        active: '已接下的工单，处理完请提交结果',
        done: '确认完成的工单会留在这里',
      }[this.view]
    },
    emptyTitle() {
      if (this.hasFilters) return '没有符合条件的工单'
      return { pool: '公共池暂无待接工单', active: '没有进行中的工单', done: '还没有完成的工单' }[this.view]
    },
    emptyHint() {
      if (this.hasFilters) return '试试清除筛选，或换一个关键字。'
      return {
        pool: '管理者派单后会出现在这里，下拉可刷新。',
        active: '接单后的工单会在这里，完成后等待租客确认。',
        done: '完成并确认的工单会留在这里，方便回看处理记录。',
      }[this.view]
    },
  },
  onLoad(query) {
    if (['pool', 'active', 'done'].includes(query?.view)) this.view = query.view
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
      const params = { view: this.view, page, limit: 20, ...this.filterParams }
      const keyword = this.keyword.trim()
      if (keyword) params.keyword = keyword
      const result = await getWorkbenchOrders(params)
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
    selectFilter(key) {
      if (this.loading || this.busyId || this.activeFilter === key) return
      this.activeFilter = key
      this.refresh()
    },
    applySearch() {
      if (this.loading || this.busyId) return
      this.refresh()
    },
    clearKeyword() {
      if (!this.keyword) return
      this.keyword = ''
      this.refresh()
    },
    clearFilters() {
      if (!this.hasFilters) return
      this.activeFilter = 'all'
      this.keyword = ''
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
      uni.navigateTo({ url: `/pages/maintenance/detail?id=${encodeURIComponent(id)}` })
    },
    statusClass(order) {
      if (order.isPool || order.status === 'PENDING_CONFIRM') return 'warn'
      if (order.status === 'COMPLETED' || order.status === 'CANCELLED') return 'quiet'
      return ''
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
  },
}
</script>

<style scoped>
.workbench-page { padding-bottom: calc(150rpx + env(safe-area-inset-bottom)); }
.wb-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 20rpx; margin-bottom: 30rpx; }
.wb-heading { flex: 1; min-width: 0; }

.wb-brief { display: flex; align-items: center; justify-content: space-between; gap: 24rpx; padding: 26rpx 30rpx; margin-bottom: 20rpx; border: 1rpx solid #dfe4d9; border-radius: 24rpx; background: #ecf0e9; }
.wb-brief-main { flex: 1; min-width: 0; }
.wb-brief-label { display: block; font-size: 24rpx; font-weight: 550; color: #4e5845; }
.wb-brief-hint { display: block; margin-top: 8rpx; font-size: 20rpx; line-height: 1.6; color: #68715b; }
.wb-brief-count { display: flex; align-items: baseline; gap: 4rpx; flex-shrink: 0; }
.wb-brief-number { font-size: 56rpx; line-height: 1; letter-spacing: -2rpx; font-weight: 550; color: #4e5845; font-variant-numeric: tabular-nums; }
.wb-brief-unit { font-size: 20rpx; color: #68715b; }

.wb-search { display: flex; align-items: center; gap: 10rpx; height: 76rpx; margin-top: 18rpx; padding: 0 24rpx; border: 1rpx solid #e9e6de; border-radius: 20rpx; background: #fffefa; }
.wb-search-input { flex: 1; min-width: 0; height: 76rpx; font-size: 23rpx; color: #302f2a; }
.wb-search-clear { width: 40rpx; height: 40rpx; line-height: 38rpx; text-align: center; border-radius: 50%; background: #f0ece3; color: #817e76; font-size: 28rpx; flex-shrink: 0; }
.wb-filters { width: 100%; margin-top: 14rpx; white-space: nowrap; }
.wb-filter { display: inline-flex; align-items: center; margin-right: 10rpx; padding: 11rpx 22rpx; border-radius: 14rpx; background: #ebe7df; color: #817e76; font-size: 21rpx; line-height: 1.4; }
.wb-filter.active { background: #68715b; color: #fffefa; }

.wb-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 16rpx; font-size: 22rpx; color: #817e76; margin-bottom: 8rpx; }
.wb-sync { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wb-tools { display: flex; align-items: center; gap: 24rpx; flex-shrink: 0; }
.wb-tool { display: flex; align-items: center; gap: 6rpx; color: #68715b; }
.wb-badge { min-width: 30rpx; height: 30rpx; line-height: 30rpx; padding: 0 8rpx; border-radius: 15rpx; background: #c16f62; color: #fffefa; font-size: 18rpx; text-align: center; }

.wb-skeleton { display: flex; flex-direction: column; gap: 20rpx; margin-top: 24rpx; }
.wb-skeleton-card { height: 190rpx; border-radius: 28rpx; background: #e9e5dc; animation: wb-pulse 1.5s ease-in-out infinite; }
@keyframes wb-pulse { 50% { opacity: .5 } }

.wb-empty { margin-top: 24rpx; padding: 56rpx 30rpx; display: flex; flex-direction: column; align-items: center; }
.wb-empty-icon { width: 104rpx; height: 104rpx; border-radius: 50%; background: #ecf0e9; display: flex; align-items: center; justify-content: center; margin-bottom: 22rpx; }
.wb-empty-action { margin-top: 26rpx; min-width: 220rpx; }

.wb-card { display: flex; gap: 22rpx; padding: 28rpx 26rpx; margin-bottom: 20rpx; transition: transform .18s ease-out, background-color .18s ease-out; }
.wb-card:active { transform: scale(.992); background: #fdfbf6; }
.wb-room { width: 96rpx; height: 96rpx; align-self: flex-start; padding: 10rpx 6rpx; box-sizing: border-box; border-radius: 22rpx; background: #f0ece3; display: flex; flex-direction: column; align-items: center; justify-content: center; flex-shrink: 0; }
.wb-room-number { font-size: 32rpx; line-height: 1.1; letter-spacing: -1rpx; font-weight: 600; color: #4e5845; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; text-align: center; }
.wb-room-floor { margin-top: 6rpx; font-size: 18rpx; color: #8e8a80; }
.wb-card-copy { flex: 1; min-width: 0; }
.wb-card-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12rpx; }
.wb-card-title { flex: 1; min-width: 0; font-size: 28rpx; font-weight: 550; line-height: 1.45; overflow-wrap: anywhere; }
.wb-card-desc { margin-top: 10rpx; font-size: 22rpx; line-height: 1.7; color: #716b60; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.wb-card-meta { display: flex; align-items: center; flex-wrap: wrap; gap: 6rpx; margin-top: 14rpx; font-size: 19rpx; color: #8e8a80; }
.wb-sep { color: #c9c4b8; }
.wb-card-foot { display: flex; align-items: center; justify-content: space-between; gap: 16rpx; margin-top: 18rpx; }
.wb-tags { display: flex; align-items: center; flex-wrap: wrap; gap: 10rpx; flex: 1; min-width: 0; }
.wb-tag { padding: 6rpx 12rpx; border-radius: 10rpx; background: #f0ece3; color: #716b60; font-size: 18rpx; line-height: 1.5; }
.wb-tag-urgent { background: #f8ece5; color: #ad735a; }
.wb-claim { flex-shrink: 0; margin: 0; padding: 16rpx 26rpx; border-radius: 16rpx; background: #68715b; color: #fffefa; font-size: 22rpx; line-height: 1.4; }
.wb-claim::after { border: none; }
.wb-arrow { flex-shrink: 0; font-size: 20rpx; color: #8e8a80; }

.wb-more { margin-top: 8rpx; padding: 22rpx; background: transparent; color: #68715b; font-size: 24rpx; border: 1rpx solid #d7d8cc; border-radius: 20rpx; }
.wb-more::after { border: none; }
.wb-end { display: block; text-align: center; padding: 24rpx; font-size: 20rpx; color: #8e8a80; }
button[disabled] { opacity: .55; }
@media (prefers-reduced-motion: reduce) {
  .wb-card { transition: none; }
  .wb-skeleton-card { animation: none; }
}
</style>
