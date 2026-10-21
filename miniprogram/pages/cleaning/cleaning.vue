<template>
  <view class="q-page cleaning-page">
    <view class="cl-head">
      <text class="q-eyebrow">CLEANING / 保洁工作台</text>
      <text class="q-title">把房间交还给人。</text>
      <text class="q-description">先接单，再确认完成。任务由团队共享。</text>
    </view>

    <view class="cl-brief">
      <view class="cl-stat" @tap="switchView('pending')">
        <text class="cl-stat-number">{{ counts.pending }}</text>
        <text class="cl-stat-label">待清洁</text>
      </view>
      <view class="cl-stat" @tap="switchView('cleaning')">
        <text class="cl-stat-number">{{ counts.cleaning }}</text>
        <text class="cl-stat-label">清洁中</text>
      </view>
      <view class="cl-brief-note">
        <text>先接单</text>
        <text>再提交完成</text>
      </view>
    </view>

    <view class="cl-toolbar">
      <text class="cl-sync">{{ loading ? '正在同步任务…' : '以最新房态为准' }}</text>
      <view class="cl-tools">
        <view class="cl-tool" @tap="goToNotifications">
          <text>通知</text>
          <text v-if="unreadCount > 0" class="cl-badge">{{ unreadCount > 99 ? '99+' : unreadCount }}</text>
        </view>
        <view class="cl-tool" @tap="refresh">刷新</view>
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

    <view v-if="loading && rooms.length === 0" class="cl-skeleton">
      <view v-for="n in 3" :key="n" class="cl-skeleton-card" />
    </view>
    <view v-else-if="!error && authorized && visibleRooms.length === 0" class="q-surface cl-empty">
      <view class="cl-empty-icon"><QIcon name="check" :size="56" /></view>
      <text class="cl-empty-title">{{ emptyTitle }}</text>
      <text>{{ emptyHint }}</text>
      <button class="q-outline cl-empty-action" @tap="refresh">刷新任务</button>
    </view>

    <view v-for="room in visibleRooms" :key="room.id" class="q-surface cl-card">
      <view class="cl-card-head">
        <view class="cl-room">
          <text class="cl-room-number">{{ room.roomNumber }}</text>
          <text class="cl-room-floor">{{ room.floor ? `${room.floor}F` : '—' }}</text>
        </view>
        <view class="cl-card-copy">
          <view class="cl-title-row">
            <text class="cl-title">{{ room.buildingName }}</text>
            <text :class="['q-pill', room.cleanStatus === 'CLEANING' ? '' : 'warn']">{{ statusLabel(room) }}</text>
          </view>
          <text class="cl-note">{{ room.cleanStatus === 'CLEANING' ? '清洁完成并检查后，提交完成。' : '准备开始清洁时，请先接单。' }}</text>
          <view class="cl-meta">
            <text>房间 {{ room.roomNumber }}</text>
            <text class="cl-sep">·</text>
            <text>{{ room.floor ? `${room.floor} 楼` : '楼层待确认' }}</text>
          </view>
        </view>
      </view>
      <button class="q-primary cl-action" :disabled="loading || !!busyId" :loading="busyId === room.id" @tap="handleAction(room)">
        {{ room.cleanStatus === 'CLEANING' ? '确认清洁完成' : '接单并开始清洁' }}
      </button>
    </view>

    <button v-if="authorized && rooms.length > 0 && page < totalPages" class="cl-more" :disabled="loading || !!busyId" :loading="loading" @tap="loadMore">加载更多</button>
    <text v-else-if="rooms.length > 0" class="cl-end">已显示全部清洁任务</text>

    <RoleTabBar active="work" variant="cleaner" />
  </view>
</template>

<script>
import QIcon from '../../components/QIcon.vue'
import RoleTabBar from '../../components/RoleTabBar.vue'
import { getUserInfo, getCleaningRooms, startCleaning, completeCleaning, getUnreadCount } from '../../api/index.js'
import { logoutSession, openHome } from '../../utils/session.js'

export default {
  components: { QIcon, RoleTabBar },
  data() {
    return {
      authorized: false, rooms: [], total: 0, page: 0, totalPages: 0,
      loading: false, busyId: '', error: '', unreadCount: 0,
      view: 'all',
      tabs: [
        { value: 'all', label: '全部' },
        { value: 'pending', label: '待接单' },
        { value: 'cleaning', label: '清洁中' },
      ],
    }
  },
  computed: {
    counts() {
      return {
        pending: this.rooms.filter(room => room.cleanStatus === 'PENDING_CLEAN').length,
        cleaning: this.rooms.filter(room => room.cleanStatus === 'CLEANING').length,
      }
    },
    visibleRooms() {
      if (this.view === 'pending') return this.rooms.filter(room => room.cleanStatus === 'PENDING_CLEAN')
      if (this.view === 'cleaning') return this.rooms.filter(room => room.cleanStatus === 'CLEANING')
      return this.rooms
    },
    emptyTitle() {
      return {
        all: '暂无待处理房间',
        pending: '没有待接单的房间',
        cleaning: '没有清洁中的房间',
      }[this.view]
    },
    emptyHint() {
      return {
        all: '新的清洁任务会在这里显示，下拉可刷新。',
        pending: '新任务到达后会出现在这里。',
        cleaning: '接单后的房间会在这里，完成后记得提交。',
      }[this.view]
    },
  },
  onLoad(query) {
    if (['all', 'pending', 'cleaning'].includes(query?.view)) this.view = query.view
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
      // 无 token 时不发请求：该方法与 refresh() 并发，
      // 若在会话确认前发出会拿到 401，被 request 层踢回登录页
      if (!uni.getStorageSync('access_token')) return
      try {
        const res = await getUnreadCount()
        this.unreadCount = res.unreadCount || 0
      } catch (error) {
        // 未读数失败不影响主流程（不弹错、不跳转）
        console.warn('加载未读数失败:', error)
      }
    },
    goToNotifications() {
      uni.navigateTo({ url: '/pages/notifications/notifications' })
    },
    switchView(view) {
      if (this.loading || this.busyId || this.view === view) return
      this.view = view
      uni.pageScrollTo({ scrollTop: 0, duration: 0 })
    },
    statusLabel(room) {
      return room.cleanStatus === 'CLEANING' ? '清洁中' : '待清洁'
    },
    async refresh() {
      if (this.loading || this.busyId) return
      this.loading = true
      this.error = ''
      this.authorized = false
      try {
        if (!uni.getStorageSync('access_token')) {
          this.rooms = []
          uni.reLaunch({ url: '/pages/login/login' })
          return
        }
        const user = await getUserInfo()
        uni.setStorageSync('user_role', user.role)
        if (user.role !== 'CLEANER') {
          this.rooms = []
          openHome(user.role)
          return
        }
        this.authorized = true
        await this.fetchPage(1)
      } catch (error) {
        this.rooms = []
        this.error = error.message || '暂时无法加载，请重试'
      } finally {
        this.loading = false
      }
    },
    async fetchPage(page) {
      const result = await getCleaningRooms({ page, limit: 20 })
      // 白名单投影：即使接口新增字段，也不保存/显示租客及合同资料。
      const rooms = (result.data || [])
        .filter(room => room.status === 'VACANT' && ['PENDING_CLEAN', 'CLEANING'].includes(room.cleanStatus))
        .map(room => ({
          id: room.id, roomNumber: room.roomNumber, floor: room.floor,
          buildingName: room.building?.name || '未命名楼栋',
          cleanStatus: room.cleanStatus, version: room.version
        }))
      this.rooms = page === 1 ? rooms : [...this.rooms, ...rooms]
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
    async handleAction(room) {
      if (!this.authorized || this.loading || this.busyId) return
      if (!Number.isInteger(room.version) || room.version < 0) {
        this.error = '房间版本信息缺失，请刷新后重试'
        return
      }
      this.busyId = room.id
      this.error = ''
      try {
        if (room.cleanStatus === 'CLEANING') {
          const confirmed = await new Promise(resolve => uni.showModal({
            title: '确认清洁完成',
            content: `确认 ${room.roomNumber} 房已完成清洁？完成后将从任务列表移除。`,
            success: result => resolve(result.confirm), fail: () => resolve(false)
          }))
          if (!confirmed) return
          await completeCleaning(room.id, room.version)
        } else if (room.cleanStatus === 'PENDING_CLEAN') {
          await startCleaning(room.id, room.version)
        } else {
          return
        }
        uni.showToast({ title: room.cleanStatus === 'CLEANING' ? '清洁已完成' : '已开始清洁', icon: 'success' })
        // 不直接相信本地状态，重新获取版本及共享列表。
        await this.fetchPage(1)
      } catch (error) {
        if ([400, 404, 409].includes(error.statusCode)) {
          this.error = '任务状态已变化，已重新加载，请确认后再操作'
          try { await this.fetchPage(1) } catch {
            this.rooms = []
            this.error = '任务状态已变化，但刷新失败，请重新加载后再操作'
          }
        } else {
          this.error = error.message || '操作失败，请刷新列表确认状态'
        }
      } finally {
        this.busyId = ''
      }
    },
    logout() {
      if (this.loading || this.busyId) return
      uni.showModal({
        title: '退出登录', content: '确定退出保洁工作台吗？',
        success: result => {
          if (!result.confirm) return
          this.authorized = false
          this.rooms = []
          logoutSession()
          uni.reLaunch({ url: '/pages/login/login' })
        }
      })
    }
  }
}
</script>

<style scoped>
.cleaning-page { padding-bottom: calc(150rpx + env(safe-area-inset-bottom)); }
.cl-head { margin-bottom: 30rpx; }
.cl-brief { display: flex; align-items: center; gap: 0; padding: 24rpx 26rpx; margin-bottom: 20rpx; border: 1rpx solid #dfe4d9; border-radius: 24rpx; background: #ecf0e9; }
.cl-stat { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 6rpx; border-right: 1rpx solid #dbe2d7; }
.cl-stat-number { font-size: 46rpx; line-height: 1; letter-spacing: -2rpx; font-weight: 550; color: #4e5845; font-variant-numeric: tabular-nums; }
.cl-stat-label { font-size: 19rpx; color: #68715b; }
.cl-brief-note { flex: 1.1; padding-left: 24rpx; }
.cl-brief-note text { display: block; font-size: 19rpx; color: #68715b; line-height: 1.6; }
.cl-brief-note text:first-child { font-weight: 550; }

.cl-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 16rpx; font-size: 22rpx; color: #817e76; margin-bottom: 8rpx; }
.cl-sync { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cl-tools { display: flex; align-items: center; gap: 24rpx; flex-shrink: 0; }
.cl-tool { display: flex; align-items: center; gap: 6rpx; color: #68715b; }
.cl-badge { min-width: 30rpx; height: 30rpx; line-height: 30rpx; padding: 0 8rpx; border-radius: 15rpx; background: #c16f62; color: #fffefa; font-size: 18rpx; text-align: center; }

.cl-skeleton { display: flex; flex-direction: column; gap: 20rpx; margin-top: 24rpx; }
.cl-skeleton-card { height: 230rpx; border-radius: 28rpx; background: #e9e5dc; animation: cl-pulse 1.5s ease-in-out infinite; }
@keyframes cl-pulse { 50% { opacity: .5 } }
@media (prefers-reduced-motion: reduce) { .cl-skeleton-card { animation: none; } }

.cl-empty { margin-top: 24rpx; padding: 56rpx 30rpx; display: flex; flex-direction: column; align-items: center; }
.cl-empty-icon { width: 104rpx; height: 104rpx; border-radius: 50%; background: #ecf0e9; display: flex; align-items: center; justify-content: center; margin-bottom: 22rpx; }
.cl-empty-title { display: block; font-size: 24rpx; font-weight: 550; color: #716b60; }
.cl-empty text:not(.cl-empty-title):not(.cl-empty-icon) { display: block; margin-top: 10rpx; font-size: 21rpx; color: #8e8a80; line-height: 1.7; text-align: center; }
.cl-empty-action { margin-top: 26rpx; min-width: 220rpx; }

.cl-card { margin-bottom: 20rpx; padding: 28rpx 26rpx; }
.cl-card-head { display: flex; gap: 22rpx; }
.cl-room { width: 96rpx; height: 96rpx; align-self: flex-start; padding: 10rpx 6rpx; box-sizing: border-box; border-radius: 22rpx; background: #f0ece3; display: flex; flex-direction: column; align-items: center; justify-content: center; flex-shrink: 0; }
.cl-room-number { font-size: 32rpx; line-height: 1.1; letter-spacing: -1rpx; font-weight: 600; color: #4e5845; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; text-align: center; }
.cl-room-floor { margin-top: 6rpx; font-size: 18rpx; color: #8e8a80; }
.cl-card-copy { flex: 1; min-width: 0; }
.cl-title-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 12rpx; }
.cl-title { flex: 1; min-width: 0; font-size: 28rpx; font-weight: 550; line-height: 1.45; overflow-wrap: anywhere; }
.cl-note { display: block; margin-top: 10rpx; font-size: 22rpx; line-height: 1.7; color: #716b60; }
.cl-meta { display: flex; align-items: center; flex-wrap: wrap; gap: 6rpx; margin-top: 14rpx; font-size: 19rpx; color: #8e8a80; }
.cl-sep { color: #c9c4b8; }
.cl-action { margin-top: 24rpx; min-height: 78rpx; font-size: 24rpx; border-radius: 20rpx; }

.cl-more { margin-top: 8rpx; padding: 22rpx; background: transparent; color: #68715b; font-size: 24rpx; border: 1rpx solid #d7d8cc; border-radius: 20rpx; }
.cl-more::after { border: none; }
.cl-end { display: block; text-align: center; padding: 24rpx; font-size: 20rpx; color: #8e8a80; }
button[disabled] { opacity: .55; }
</style>
