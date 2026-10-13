<template>
  <view class="work-page">
    <view class="work-header">
      <view>
        <text class="eyebrow">房间清洁</text>
        <text class="heading">保洁工作台</text>
        <text class="subtitle">先接单，再确认完成。列表由团队共享。</text>
      </view>
      <button class="text-button" :disabled="loading || !!busyId" @tap="logout">退出</button>
    </view>

    <view class="toolbar">
      <text>{{ authorized ? `待处理 ${total} 间` : loading ? '正在确认登录身份' : '任务暂未加载' }}</text>
      <button class="text-button" :disabled="loading || !!busyId" @tap="refresh">刷新</button>
    </view>

    <view v-if="error" class="notice" role="alert">
      <text>{{ error }}</text>
      <button class="retry-button" :disabled="loading || !!busyId" @tap="refresh">重新加载</button>
    </view>
    <view v-if="loading && rooms.length === 0" class="empty-state">
      <text>正在加载清洁任务…</text>
    </view>
    <view v-else-if="!error && authorized && rooms.length === 0" class="empty-state">
      <text class="empty-title">暂无待清洁房间</text>
      <text>新的清洁任务会在这里显示，下拉可刷新。</text>
    </view>

    <view v-for="room in rooms" :key="room.id" class="room-card">
      <view class="room-top">
        <view>
          <text class="location">{{ room.buildingName }} · {{ room.floor }} 楼</text>
          <text class="room-number">{{ room.roomNumber }} <text class="room-unit">房</text></text>
        </view>
        <text :class="['status', room.cleanStatus === 'CLEANING' ? 'in-progress' : 'pending']">
          {{ room.cleanStatus === 'CLEANING' ? '清洁中' : '待清洁' }}
        </text>
      </view>
      <text class="task-note">{{ room.cleanStatus === 'CLEANING' ? '确认房间已清洁后，提交完成。' : '准备开始清洁时，请先接单。' }}</text>
      <button class="action-button" :disabled="loading || !!busyId" :loading="busyId === room.id"
        @tap="handleAction(room)">
        {{ room.cleanStatus === 'CLEANING' ? '确认清洁完成' : '接单并开始清洁' }}
      </button>
    </view>

    <button v-if="authorized && rooms.length > 0 && page < totalPages" class="more-button"
      :disabled="loading || !!busyId" :loading="loading" @tap="loadMore">加载更多</button>
    <text v-else-if="rooms.length > 0" class="list-end">已显示全部清洁任务</text>
  </view>
</template>

<script>
import { getUserInfo, getCleaningRooms, startCleaning, completeCleaning } from '../../api/index.js'
import { clearSession, openHome } from '../../utils/session.js'

export default {
  data() {
    return {
      authorized: false, rooms: [], total: 0, page: 0, totalPages: 0,
      loading: false, busyId: '', error: ''
    }
  },
  onShow() {
    this.refresh()
  },
  async onPullDownRefresh() {
    try { await this.refresh() } finally { uni.stopPullDownRefresh() }
  },
  onReachBottom() {
    this.loadMore()
  },
  methods: {
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
          clearSession()
          uni.reLaunch({ url: '/pages/login/login' })
        }
      })
    }
  }
}
</script>

<style scoped>
.work-page { --accent: #176b50; --ink: #1d3029; min-height: 100vh; box-sizing: border-box; padding: 40rpx 28rpx 64rpx; background: #f4f6f3; color: var(--ink); }
.work-header, .toolbar, .room-top { display: flex; align-items: center; justify-content: space-between; gap: 20rpx; }
.work-header { align-items: flex-start; margin-bottom: 40rpx; }
.eyebrow, .heading, .subtitle, .location, .room-number, .task-note, .list-end { display: block; }
.eyebrow { font-size: 24rpx; color: var(--accent); margin-bottom: 12rpx; }
.heading { font-size: 44rpx; font-weight: 700; }
.subtitle { margin-top: 14rpx; font-size: 25rpx; color: #596b61; line-height: 1.6; }
.toolbar { font-size: 28rpx; margin-bottom: 20rpx; }
button { margin: 0; font-size: 28rpx; line-height: 1.5; }
button::after { border: none; }
.text-button { flex-shrink: 0; padding: 16rpx; background: transparent; color: var(--accent); }
.room-card { margin-bottom: 24rpx; padding: 32rpx; border: 1rpx solid #dfe6df; border-radius: 16rpx; background: #fff; }
.location { font-size: 25rpx; color: #596b61; overflow-wrap: anywhere; }
.room-number { margin-top: 12rpx; font-size: 44rpx; font-weight: 700; overflow-wrap: anywhere; }
.room-unit { font-size: 26rpx; font-weight: 400; }
.status { flex-shrink: 0; font-size: 24rpx; padding: 10rpx 16rpx; border-radius: 8rpx; }
.pending { background: #fff2d7; color: #785208; }
.in-progress { background: #e5f2eb; color: #176b50; }
.task-note { font-size: 25rpx; color: #596b61; margin: 28rpx 0 20rpx; }
.action-button { width: 100%; padding: 22rpx; background: var(--accent); color: #fff; border-radius: 10rpx; }
.more-button, .retry-button { padding: 20rpx; background: #fff; color: var(--accent); border-radius: 10rpx; }
button[disabled] { opacity: .5; }
.empty-state { display: flex; flex-direction: column; gap: 16rpx; padding: 80rpx 24rpx; font-size: 27rpx; color: #596b61; text-align: center; }
.empty-title { color: var(--ink); font-size: 32rpx; font-weight: 600; }
.notice { padding: 24rpx; background: #fff2df; color: #784f16; font-size: 27rpx; line-height: 1.6; margin-bottom: 24rpx; border-radius: 10rpx; }
.retry-button { margin-top: 16rpx; }
.list-end { padding: 24rpx; font-size: 24rpx; text-align: center; color: #596b61; }
</style>
