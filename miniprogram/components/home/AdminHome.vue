<template>
  <view class="admin-home">
    <view class="home-greeting">
      <view>
        <text class="q-eyebrow">{{ today }}</text>
        <text class="q-title">{{ greeting }}，管理工作台</text>
      </view>
      <view class="home-bell" @tap="goToNotifications">
        <QIcon name="bell" :size="40" />
        <view v-if="unreadCount" class="unread-dot" />
      </view>
    </view>

    <view v-if="failed.length" class="q-error" @tap="loadData">{{ failed.join('、') }}暂未更新 · 点此重试</view>

    <view class="stats-grid">
      <button v-for="(group, key) in taskGroups" :key="key" :class="['stat-card', { 'is-selected': currentFilter === key }]" :aria-pressed="currentFilter === key" @tap="filterByStatus(key)">
        <view :class="['stat-icon', key]"><QIcon name="repair" :size="32" /></view>
        <view class="stat-content">
          <text class="stat-value">{{ stats[key] ?? '—' }}</text>
          <text class="stat-label">{{ group.label }}</text>
        </view>
      </button>
    </view>

    <!-- 今日工单列表 -->
    <view class="q-section-heading">
      <text>{{ currentFilter === 'all' ? '最近工单' : filterLabel }}</text>
      <text v-if="currentFilter !== 'all'" class="q-link" @tap="showAllTasks">显示全部</text>
    </view>
    <view class="q-surface tasks-surface">
      <HomeSkeleton v-if="loading && !filteredTasks.length" label="正在加载工单…" />
      <view v-else-if="!filteredTasks.length" class="q-empty">
        <text>{{ failed.includes('工单') ? '工单暂未更新' : '当前筛选暂无工单' }}</text>
      </view>
      <view
        v-for="task in filteredTasks"
        :key="task.id"
        class="task-item"
        @tap="openTask(task.id)"
      >
        <view :class="['task-status', statusClass(task.status)]">
          {{ statusLabel(task.status) }}
        </view>
        <view class="task-body">
          <text class="task-title">{{ task.title }}</text>
          <view class="task-meta">
            <text>{{ task.room?.roomNumber }}室</text>
            <text v-if="task.assignedTo">· {{ task.assignedTo }}</text>
            <text>· {{ formatDate(task.createdAt) }}</text>
          </view>
          <text v-if="task.description" class="task-desc">{{ task.description }}</text>
        </view>
        <text class="q-arrow">›</text>
      </view>
    </view>

    <!-- 快捷操作 -->
    <view class="q-section-heading"><text>快捷操作</text></view>
    <view class="quick-actions">
      <view class="action-btn" @tap="openWebAdmin">
        <QIcon name="home" :size="36" />
        <text>管理后台</text>
      </view>
      <view class="action-btn" @tap="goToNotifications">
        <QIcon name="bell" :size="36" />
        <text>通知中心</text>
      </view>
    </view>

    <text class="q-note">栖居 · 高效管理，轻松运营</text>
  </view>
</template>

<script>
import QIcon from '../QIcon.vue'
import HomeSkeleton from './HomeSkeleton.vue'
import { getAllMaintenance, getUnreadCount } from '../../api/index.js'

const TASK_GROUPS = {
  pending: { label: '待派工', statuses: ['SUBMITTED', 'ACKNOWLEDGED'] },
  assigned: { label: '已派工', statuses: ['ASSIGNED', 'IN_PROGRESS'] },
  confirm: { label: '待验收', statuses: ['PENDING_CONFIRM'] }
}
const GROUP_ORDER = ['confirm', 'pending', 'assigned']
const TASK_LIMIT = 20
const PRIORITY_ORDER = { URGENT: 2, NORMAL: 1, LOW: 0 }

const statusGroup = status => GROUP_ORDER.find(key => TASK_GROUPS[key].statuses.includes(status))

export default {
  components: { QIcon, HomeSkeleton },
  data() {
    const d = new Date()
    return {
      today: `${d.getMonth() + 1}月${d.getDate()}日 · ${['星期日','星期一','星期二','星期三','星期四','星期五','星期六'][d.getDay()]}`,
      greeting: d.getHours() < 12 ? '早上好' : d.getHours() < 18 ? '下午好' : '晚上好',
      taskGroups: TASK_GROUPS,
      tasksByGroup: {},
      unreadCount: 0,
      loading: true,
      refreshing: false,
      failed: [],
      currentFilter: 'all',
      stats: {}
    }
  },
  computed: {
    filteredTasks() {
      if (this.currentFilter === 'all') {
        return GROUP_ORDER.flatMap(key => this.tasksByGroup[key] || []).slice(0, TASK_LIMIT)
      }
      return this.tasksByGroup[this.currentFilter] || []
    },
    filterLabel() {
      return `${TASK_GROUPS[this.currentFilter]?.label || ''}工单`
    }
  },
  methods: {
    async loadData() {
      if (this.refreshing) return
      this.loading = true
      this.refreshing = true
      const [groups, unread] = await Promise.allSettled([
        Promise.all(Object.entries(TASK_GROUPS).map(async ([key, group]) => {
          const pages = await Promise.all(group.statuses.map(status => getAllMaintenance({ page: 1, limit: TASK_LIMIT, status })))
          const count = pages.reduce((total, page) => total + page.meta.total, 0)
          const tasks = pages.flatMap(page => page.data).sort((first, second) =>
            PRIORITY_ORDER[second.priority] - PRIORITY_ORDER[first.priority] || Date.parse(second.createdAt) - Date.parse(first.createdAt)
          )
          return { key, count, tasks: tasks.slice(0, TASK_LIMIT) }
        })),
        getUnreadCount()
      ])

      this.failed = []
      if (groups.status === 'fulfilled') {
        this.tasksByGroup = Object.fromEntries(groups.value.map(({ key, tasks }) => [key, tasks]))
        this.stats = Object.fromEntries(groups.value.map(({ key, count }) => [key, count]))
      } else {
        this.failed.push('工单')
      }
      if (unread.status === 'fulfilled') this.unreadCount = unread.value.unreadCount
      else this.failed.push('未读通知')
      this.loading = false
      this.refreshing = false
    },
    filterByStatus(type) {
      this.currentFilter = type
    },
    showAllTasks() {
      this.currentFilter = 'all'
    },
    statusLabel(status) {
      const labels = {
        SUBMITTED: '已提交',
        ACKNOWLEDGED: '已受理',
        ASSIGNED: '已派工',
        IN_PROGRESS: '维修中',
        PENDING_CONFIRM: '待验收'
      }
      return labels[status] || status
    },
    statusClass(status) {
      return statusGroup(status) || ''
    },
    formatDate(dateStr) {
      if (!dateStr) return ''
      const d = new Date(dateStr)
      const now = new Date()
      const diff = now.getTime() - d.getTime()
      const days = Math.floor(diff / (1000 * 60 * 60 * 24))

      if (days === 0) return '今天'
      if (days === 1) return '昨天'
      if (days < 7) return `${days}天前`
      return `${d.getMonth() + 1}/${d.getDate()}`
    },
    openTask(id) {
      // 管理者可能需要跳转到管理后台，暂时跳转到小程序详情页
      uni.navigateTo({
        url: `/packageA/maintenance/detail?id=${encodeURIComponent(id)}`
      })
    },
    openWebAdmin() {
      uni.showToast({
        title: '请在电脑浏览器访问管理后台',
        icon: 'none',
        duration: 2000
      })
    },
    goToNotifications() {
      uni.navigateTo({ url: '/packageA/notifications/notifications' })
    }
  }
}
</script>

<style scoped>
.admin-home { padding-bottom: 40rpx; }
.home-greeting { display: flex; align-items: center; justify-content: space-between; gap: 16rpx; margin-bottom: 30rpx; }
.home-greeting .q-title { font-size: 52rpx; letter-spacing: -2.5rpx; font-weight: 600; }
.home-bell { position: relative; width: 74rpx; height: 74rpx; background: #fffefa; border-radius: 50%; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.unread-dot { position: absolute; right: 16rpx; top: 12rpx; width: 10rpx; height: 10rpx; border-radius: 50%; background: #ad735a; }

.stats-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16rpx; margin-bottom: 30rpx; }
.stat-card { width: 100%; margin: 0; line-height: 1.3; background: #fffefa; border: 1rpx solid #e9e6de; border-radius: 20rpx; padding: 24rpx 12rpx; display: flex; flex-direction: column; align-items: center; gap: 16rpx; }
.stat-card::after { border: 0; }
.stat-card.is-selected { border-color: #68715b; background: #ecf0e9; }
.stat-card:active, .action-btn:active { background: #ecf0e9; }
.stat-icon { width: 64rpx; height: 64rpx; border-radius: 50%; display: flex; align-items: center; justify-content: center; }
.stat-icon.pending { background: #fef3e8; color: #ad735a; }
.stat-icon.assigned { background: #e8f0fe; color: #4285f4; }
.stat-icon.confirm { background: #e8f5e9; color: #2e7d32; }
.stat-content { display: flex; flex-direction: column; align-items: center; gap: 6rpx; }
.stat-value { font-size: 36rpx; font-weight: 600; color: #302f2a; }
.stat-label { font-size: 22rpx; color: #817e76; }

.tasks-surface { padding: 10rpx 32rpx; margin-bottom: 24rpx; }
.task-item { display: flex; align-items: flex-start; gap: 16rpx; padding: 24rpx 0; border-bottom: 1rpx solid #e9e6de; }
.task-item:last-child { border: 0; }
.task-status { font-size: 20rpx; padding: 6rpx 12rpx; border-radius: 8rpx; white-space: nowrap; flex-shrink: 0; margin-top: 4rpx; }
.task-status.pending { background: #fef3e8; color: #ad735a; }
.task-status.assigned { background: #e8f0fe; color: #4285f4; }
.task-status.confirm { background: #e8f5e9; color: #2e7d32; }
.task-body { flex: 1; min-width: 0; }
.task-title { display: block; font-size: 25rpx; font-weight: 550; margin-bottom: 8rpx; }
.task-meta { display: flex; gap: 8rpx; font-size: 20rpx; color: #817e76; margin-bottom: 8rpx; }
.task-desc { display: block; font-size: 22rpx; color: #817e76; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.q-arrow { font-size: 34rpx; color: #a49f95; flex-shrink: 0; margin-top: 4rpx; }

.quick-actions { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16rpx; margin-bottom: 30rpx; }
.action-btn { background: #fffefa; border: 1rpx solid #e9e6de; border-radius: 20rpx; padding: 32rpx 0; display: flex; flex-direction: column; align-items: center; gap: 16rpx; font-size: 24rpx; }
</style>
