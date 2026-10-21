<template>
  <view class="q-page cleaner-home has-role-tabbar">
    <view class="ch-head">
      <view class="ch-heading">
        <text class="q-eyebrow">{{ today }}</text>
        <text class="q-title">{{ greeting }}，保洁组</text>
        <text class="q-description">先接单，再确认完成。任务由团队共享。</text>
      </view>
      <view class="ch-bell" @tap="goNotifications">
        <QIcon name="bell" :size="40" />
        <view v-if="unreadCount > 0" class="ch-bell-dot" />
      </view>
    </view>

    <view v-if="error" class="q-error" @tap="load">{{ error }} · 点此重试</view>

    <view class="q-surface ch-summary">
      <view class="ch-summary-head">
        <text class="ch-summary-title">清洁任务</text>
        <text class="q-link" @tap="goWork('all')">全部任务 ›</text>
      </view>
      <view class="ch-stats">
        <view class="ch-stat" @tap="goWork('pending')">
          <text class="ch-stat-number">{{ counts.pending }}</text>
          <text class="ch-stat-label">待清洁</text>
        </view>
        <view class="ch-stat" @tap="goWork('cleaning')">
          <text class="ch-stat-number">{{ counts.cleaning }}</text>
          <text class="ch-stat-label">清洁中</text>
        </view>
      </view>
    </view>

    <view class="q-section-heading"><text>常用功能</text></view>
    <view class="ch-actions">
      <view v-for="action in actions" :key="action.key" class="q-surface ch-action" @tap="openAction(action)">
        <view class="ch-action-icon"><QIcon :name="action.icon" :size="40" /></view>
        <view class="ch-action-copy">
          <text class="ch-action-label">{{ action.label }}</text>
          <text class="ch-action-hint">{{ action.hint }}</text>
        </view>
        <text class="ch-arrow">›</text>
      </view>
    </view>

    <view class="q-section-heading"><text>待清洁房间</text><text class="q-link" @tap="goWork('pending')">查看全部 ›</text></view>
    <view v-if="recent.length" class="q-surface ch-rooms">
      <view v-for="room in recent" :key="room.id" class="ch-room" @tap="openRoom(room)">
        <view class="ch-room-number">{{ room.roomNumber }}</view>
        <view class="ch-room-copy">
          <text class="ch-room-title">{{ room.buildingName }}</text>
          <text class="ch-room-meta">{{ room.floor }} 楼 · 待清洁</text>
        </view>
        <text class="q-pill warn">待接单</text>
      </view>
    </view>
    <view v-else class="q-surface ch-empty">
      <text class="ch-empty-title">{{ loading ? '正在同步任务…' : '暂无待清洁房间' }}</text>
      <text v-if="!loading">新任务会出现在这里，下拉可刷新。</text>
    </view>

    <StaffContactCard />

    <text class="q-note">栖居 · 每一间房，都值得被认真对待</text>
    <RoleTabBar active="home" variant="cleaner" />
  </view>
</template>

<script>
import QIcon from '../../components/QIcon.vue'
import RoleTabBar from '../../components/RoleTabBar.vue'
import StaffContactCard from '../../components/StaffContactCard.vue'
import { getCleaningRooms, getUnreadCount } from '../../api/index.js'
import { ensureSession, openHome } from '../../utils/session.js'

export default {
  components: { QIcon, RoleTabBar, StaffContactCard },
  data() {
    const d = new Date()
    return {
      today: `${d.getMonth() + 1}月${d.getDate()}日 · ${['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'][d.getDay()]}`,
      counts: { pending: 0, cleaning: 0 },
      recent: [],
      unreadCount: 0,
      loading: false,
      error: '',
      actions: [
        { key: 'pending', label: '待清洁', hint: '接单并开始清洁', icon: 'check' },
        { key: 'cleaning', label: '清洁中', hint: '确认完成后提交', icon: 'home' },
        { key: 'notifications', label: '通知提醒', hint: '查看任务与系统消息', icon: 'bell' },
        { key: 'settings', label: '设置', hint: '账号、主题与退出', icon: 'user' },
      ],
    }
  },
  computed: {
    greeting() {
      const hour = new Date().getHours()
      return hour < 12 ? '早上好' : hour < 18 ? '下午好' : '晚上好'
    },
  },
  onShow() { this.load() },
  async onPullDownRefresh() {
    try { await this.load() } finally { uni.stopPullDownRefresh() }
  },
  methods: {
    async load() {
      if (this.loading) return
      this.loading = true
      this.error = ''
      try {
        const user = await ensureSession()
        if (!user) return
        if (user.role !== 'CLEANER') {
          openHome(user.role)
          return
        }
        const [rooms, unread] = await Promise.all([
          getCleaningRooms({ page: 1, limit: 100 }),
          getUnreadCount().catch(() => ({ unreadCount: 0 })),
        ])
        const list = (rooms.data || [])
          .filter(room => room.status === 'VACANT' && ['PENDING_CLEAN', 'CLEANING'].includes(room.cleanStatus))
          .map(room => ({
            id: room.id, roomNumber: room.roomNumber, floor: room.floor,
            buildingName: room.building?.name || '未命名楼栋', cleanStatus: room.cleanStatus,
          }))
        this.counts = {
          pending: list.filter(room => room.cleanStatus === 'PENDING_CLEAN').length,
          cleaning: list.filter(room => room.cleanStatus === 'CLEANING').length,
        }
        this.recent = list.filter(room => room.cleanStatus === 'PENDING_CLEAN').slice(0, 2)
        this.unreadCount = unread.unreadCount || 0
      } catch (error) {
        this.error = error.message || '清洁任务未能加载'
      } finally {
        this.loading = false
      }
    },
    openAction(action) {
      if (action.key === 'notifications') return this.goNotifications()
      if (action.key === 'settings') return uni.reLaunch({ url: '/pages/cleaning/settings' })
      this.goWork(action.key)
    },
    goWork(view) {
      uni.reLaunch({ url: `/pages/cleaning/cleaning?view=${view}` })
    },
    goNotifications() {
      uni.navigateTo({ url: '/pages/notifications/notifications' })
    },
    openRoom(room) {
      uni.reLaunch({ url: `/pages/cleaning/cleaning?view=pending&room=${encodeURIComponent(room.id)}` })
    },
  },
}
</script>

<style scoped>
.cleaner-home { padding-bottom: calc(150rpx + env(safe-area-inset-bottom)); }
.ch-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 20rpx; }
.ch-heading { flex: 1; min-width: 0; }
.ch-bell { position: relative; flex-shrink: 0; width: 76rpx; height: 76rpx; display: flex; align-items: center; justify-content: center; border-radius: 50%; background: #fffefa; border: 1rpx solid #e9e6de; }
.ch-bell-dot { position: absolute; top: 14rpx; right: 16rpx; width: 14rpx; height: 14rpx; border-radius: 50%; background: #c16f62; }

.ch-summary { padding: 28rpx 30rpx 24rpx; }
.ch-summary-head { display: flex; align-items: center; justify-content: space-between; gap: 16rpx; }
.ch-summary-title { font-size: 26rpx; font-weight: 550; }
.ch-stats { display: flex; align-items: stretch; margin-top: 26rpx; }
.ch-stat { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 8rpx; padding: 10rpx 0; border-right: 1rpx solid #ece8df; }
.ch-stat:last-child { border-right: none; }
.ch-stat-number { font-size: 50rpx; line-height: 1; letter-spacing: -2rpx; font-weight: 550; color: #4e5845; font-variant-numeric: tabular-nums; }
.ch-stat-label { font-size: 20rpx; color: #817e76; }

.ch-actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16rpx; }
.ch-action { display: flex; align-items: center; gap: 16rpx; padding: 24rpx 22rpx; border-radius: 26rpx; }
.ch-action-icon { width: 66rpx; height: 66rpx; border-radius: 20rpx; background: #ecf0e9; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.ch-action-copy { flex: 1; min-width: 0; }
.ch-action-label { display: block; font-size: 24rpx; font-weight: 550; }
.ch-action-hint { display: block; margin-top: 6rpx; font-size: 18rpx; color: #8e8a80; line-height: 1.5; }
.ch-arrow { color: #a49f95; font-size: 26rpx; flex-shrink: 0; }

.ch-rooms { padding: 8rpx 30rpx; }
.ch-room { display: flex; align-items: center; gap: 18rpx; padding: 24rpx 0; border-bottom: 1rpx solid #ece8df; }
.ch-room:last-child { border-bottom: none; }
.ch-room-number { width: 78rpx; height: 78rpx; border-radius: 18rpx; background: #f0ece3; display: flex; align-items: center; justify-content: center; font-size: 25rpx; font-weight: 600; color: #4e5845; flex-shrink: 0; font-variant-numeric: tabular-nums; }
.ch-room-copy { flex: 1; min-width: 0; }
.ch-room-title { display: block; font-size: 24rpx; font-weight: 550; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ch-room-meta { display: block; margin-top: 8rpx; font-size: 19rpx; color: #8e8a80; }
.ch-empty { padding: 44rpx 30rpx; text-align: center; }
.ch-empty-title { display: block; font-size: 24rpx; font-weight: 550; color: #716b60; }
.ch-empty text:last-child { display: block; margin-top: 10rpx; font-size: 21rpx; color: #8e8a80; line-height: 1.7; }
</style>
