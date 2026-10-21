<template>
  <view class="q-page home-page has-role-tabbar">
    <view class="mh-head">
      <view class="mh-heading">
        <text class="q-eyebrow">{{ today }}</text>
        <text class="q-title">{{ greeting }}，维修组</text>
        <text class="q-description">先处理紧急工单，再安排常规维修。</text>
      </view>
      <view class="mh-bell" @tap="goNotifications">
        <QIcon name="bell" :size="40" />
        <view v-if="unreadCount > 0" class="mh-bell-dot" />
      </view>
    </view>

    <view v-if="error" class="q-error" @tap="load">{{ error }} · 点此重试</view>

    <view class="q-surface mh-summary">
      <view class="mh-summary-head">
        <text class="mh-summary-title">工单概览</text>
        <text class="q-link" @tap="goWork('pool')">全部工单 ›</text>
      </view>
      <view class="mh-stats">
        <view class="mh-stat" @tap="goWork('pool')">
          <text class="mh-stat-number">{{ counts.pool }}</text>
          <text class="mh-stat-label">待接单</text>
        </view>
        <view class="mh-stat" @tap="goWork('active')">
          <text class="mh-stat-number">{{ counts.active }}</text>
          <text class="mh-stat-label">进行中</text>
        </view>
        <view class="mh-stat" @tap="goWork('done')">
          <text class="mh-stat-number">{{ counts.done }}</text>
          <text class="mh-stat-label">已完成</text>
        </view>
      </view>
    </view>

    <view class="q-section-heading"><text>常用功能</text></view>
    <view class="mh-actions">
      <view v-for="action in actions" :key="action.key" class="q-surface mh-action" @tap="openAction(action)">
        <view class="mh-action-icon"><QIcon :name="action.icon" :size="40" /></view>
        <view class="mh-action-copy">
          <text class="mh-action-label">{{ action.label }}</text>
          <text class="mh-action-hint">{{ action.hint }}</text>
        </view>
        <text class="mh-arrow">›</text>
      </view>
    </view>

    <view class="q-section-heading"><text>最新待接单</text><text class="q-link" @tap="goWork('pool')">查看全部 ›</text></view>
    <view v-if="recent.length" class="q-surface mh-orders">
      <view v-for="order in recent" :key="order.id" class="mh-order" @tap="openDetail(order.id)">
        <view class="mh-order-room">{{ order.room?.roomNumber || '—' }}</view>
        <view class="mh-order-copy">
          <text class="mh-order-title">{{ order.title }}</text>
          <text class="mh-order-meta">{{ order.room?.building?.name || '未命名楼栋' }} · {{ categoryLabel(order.category) }}<text v-if="order.priority === 'URGENT'" class="mh-order-urgent"> · 紧急</text></text>
        </view>
        <text class="q-pill warn">待接单</text>
      </view>
    </view>
    <view v-else class="q-surface mh-empty">
      <text class="mh-empty-title">{{ loading ? '正在同步工单…' : '公共池暂无可接工单' }}</text>
      <text v-if="!loading">新工单会出现在这里，下拉可刷新。</text>
    </view>

    <StaffContactCard />

    <text class="q-note">栖居 · 让每一件小事，都有清楚的回应</text>
    <RoleTabBar active="home" />
  </view>
</template>

<script>
import QIcon from '../../components/QIcon.vue'
import RoleTabBar from '../../components/RoleTabBar.vue'
import StaffContactCard from '../../components/StaffContactCard.vue'
import { getWorkbenchOrders, getUnreadCount } from '../../api/index.js'
import { ensureSession, openHome } from '../../utils/session.js'

export default {
  components: { QIcon, RoleTabBar, StaffContactCard },
  data() {
    const d = new Date()
    return {
      today: `${d.getMonth() + 1}月${d.getDate()}日 · ${['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'][d.getDay()]}`,
      counts: { pool: 0, active: 0, done: 0 },
      recent: [],
      unreadCount: 0,
      loading: false,
      error: '',
      actions: [
        { key: 'pool', label: '待接单', hint: '公共池先接先得', icon: 'repair' },
        { key: 'active', label: '进行中', hint: '继续处理已接工单', icon: 'check' },
        { key: 'notifications', label: '通知提醒', hint: '查看工单与系统消息', icon: 'bell' },
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
        if (user.role !== 'MAINTENANCE') {
          openHome(user.role)
          return
        }
        const [pool, active, done, unread] = await Promise.all([
          getWorkbenchOrders({ view: 'pool', page: 1, limit: 3 }),
          getWorkbenchOrders({ view: 'active', page: 1, limit: 1 }),
          getWorkbenchOrders({ view: 'done', page: 1, limit: 1 }),
          getUnreadCount().catch(() => ({ unreadCount: 0 })),
        ])
        this.counts = {
          pool: pool.meta?.total || 0,
          active: active.meta?.total || 0,
          done: done.meta?.total || 0,
        }
        this.recent = (pool.data || []).slice(0, 2)
        this.unreadCount = unread.unreadCount || 0
      } catch (error) {
        this.error = error.message || '工单概览未能加载'
      } finally {
        this.loading = false
      }
    },
    openAction(action) {
      if (action.key === 'notifications') return this.goNotifications()
      if (action.key === 'settings') return uni.reLaunch({ url: '/pages/maintenance/settings' })
      this.goWork(action.key)
    },
    goWork(view) {
      uni.reLaunch({ url: `/pages/maintenance/workbench?view=${view}` })
    },
    goNotifications() {
      uni.navigateTo({ url: '/pages/notifications/notifications' })
    },
    openDetail(id) {
      uni.navigateTo({ url: `/pages/maintenance/detail?id=${encodeURIComponent(id)}` })
    },
    categoryLabel(category) {
      return {
        PLUMBING: '水管', ELECTRICAL: '电路', APPLIANCE: '家电',
        FURNITURE: '家具', DOOR_WINDOW: '门窗', OTHER: '其他',
      }[category] || category
    },
  },
}
</script>

<style scoped>
.home-page { padding-bottom: calc(150rpx + env(safe-area-inset-bottom)); }
.mh-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 20rpx; }
.mh-heading { flex: 1; min-width: 0; }
.mh-bell { position: relative; flex-shrink: 0; width: 76rpx; height: 76rpx; display: flex; align-items: center; justify-content: center; border-radius: 50%; background: #fffefa; border: 1rpx solid #e9e6de; }
.mh-bell-dot { position: absolute; top: 14rpx; right: 16rpx; width: 14rpx; height: 14rpx; border-radius: 50%; background: #c16f62; }

.mh-summary { padding: 28rpx 30rpx 24rpx; }
.mh-summary-head { display: flex; align-items: center; justify-content: space-between; gap: 16rpx; }
.mh-summary-title { font-size: 26rpx; font-weight: 550; }
.mh-stats { display: flex; align-items: stretch; margin-top: 26rpx; }
.mh-stat { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 8rpx; padding: 10rpx 0; border-right: 1rpx solid #ece8df; }
.mh-stat:last-child { border-right: none; }
.mh-stat-number { font-size: 50rpx; line-height: 1; letter-spacing: -2rpx; font-weight: 550; color: #4e5845; font-variant-numeric: tabular-nums; }
.mh-stat-label { font-size: 20rpx; color: #817e76; }

.mh-actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16rpx; }
.mh-action { display: flex; align-items: center; gap: 16rpx; padding: 24rpx 22rpx; border-radius: 26rpx; }
.mh-action-icon { width: 66rpx; height: 66rpx; border-radius: 20rpx; background: #ecf0e9; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.mh-action-copy { flex: 1; min-width: 0; }
.mh-action-label { display: block; font-size: 24rpx; font-weight: 550; }
.mh-action-hint { display: block; margin-top: 6rpx; font-size: 18rpx; color: #8e8a80; line-height: 1.5; }
.mh-arrow { color: #a49f95; font-size: 26rpx; flex-shrink: 0; }

.mh-orders { padding: 8rpx 30rpx; }
.mh-order { display: flex; align-items: center; gap: 18rpx; padding: 24rpx 0; border-bottom: 1rpx solid #ece8df; }
.mh-order:last-child { border-bottom: none; }
.mh-order-room { width: 78rpx; height: 78rpx; border-radius: 18rpx; background: #f0ece3; display: flex; align-items: center; justify-content: center; font-size: 25rpx; font-weight: 600; color: #4e5845; flex-shrink: 0; font-variant-numeric: tabular-nums; }
.mh-order-copy { flex: 1; min-width: 0; }
.mh-order-title { display: block; font-size: 24rpx; font-weight: 550; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mh-order-meta { display: block; margin-top: 8rpx; font-size: 19rpx; color: #8e8a80; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mh-order-urgent { color: #ad735a; }
.mh-empty { padding: 44rpx 30rpx; text-align: center; }
.mh-empty-title { display: block; font-size: 24rpx; font-weight: 550; color: #716b60; }
.mh-empty text:last-child { display: block; margin-top: 10rpx; font-size: 21rpx; color: #8e8a80; line-height: 1.7; }
</style>
