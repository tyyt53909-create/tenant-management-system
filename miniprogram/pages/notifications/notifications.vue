<template>
  <view class="page">
    <view class="tabs">
      <view
        :class="['tab-item', filter === 'all' ? 'active' : '']"
        @tap="switchFilter('all')"
      >
        全部
      </view>
      <view
        :class="['tab-item', filter === 'unread' ? 'active' : '']"
        @tap="switchFilter('unread')"
      >
        未读<text v-if="unreadCount > 0" class="tab-badge">{{ unreadCount }}</text>
      </view>
    </view>

    <view class="toolbar" v-if="list.length > 0 && unreadCount > 0">
      <text class="toolbar-action" @tap="handleReadAll">全部标记为已读</text>
    </view>

    <scroll-view class="list-container page-with-tabbar" scroll-y @scrolltolower="loadMore">
      <view
        :class="['notice-item', item.isRead ? 'is-read' : '']"
        v-for="item in list"
        :key="item.id"
        @tap="handleOpen(item)"
      >
        <view class="notice-header">
          <view class="notice-title-wrap">
            <view class="dot" v-if="!item.isRead"></view>
            <text class="notice-title text-break">{{ item.title }}</text>
          </view>
          <text :class="['badge', item.priority === 'URGENT' ? 'badge-error' : 'badge-info']">
            {{ item.priority === 'URGENT' ? '紧急' : '普通' }}
          </text>
        </view>
        <text class="notice-body text-break" v-if="item.body">{{ item.body }}</text>
        <view class="notice-footer">
          <text class="notice-time">{{ formatTime(item.createdAt) }}</text>
          <view class="notice-actions">
            <text class="action" v-if="!item.isRead" @tap.stop="handleRead(item)">标记已读</text>
            <text class="action danger" @tap.stop="handleDelete(item)">删除</text>
          </view>
        </view>
      </view>

      <view class="empty" v-if="list.length === 0 && !loading">
        <text class="empty-title">{{ filter === 'unread' ? '暂无未读通知' : '暂无通知' }}</text>
        <text class="empty-hint">
          {{ filter === 'unread' ? '所有通知都已处理' : '账单提醒、报修进度、保洁安排会显示在这里' }}
        </text>
      </view>

      <view class="loading" v-if="loading">加载中…</view>
      <view class="loading" v-else-if="list.length > 0 && !hasMore">没有更多了</view>
    </scroll-view>
  </view>
</template>

<script>
import {
  getNotifications,
  getUnreadCount,
  markNotificationRead,
  markAllNotificationsRead,
  deleteNotification
} from '../../api/index.js'
import { ensureTenantSession } from '../../utils/session.js'

export default {
  data() {
    return {
      filter: 'all',
      list: [],
      unreadCount: 0,
      page: 1,
      limit: 20,
      total: 0,
      loading: false
    }
  },
  computed: {
    hasMore() {
      return this.list.length < this.total
    }
  },
  onLoad() {
    this.refresh()
  },
  onShow() {
    // 从其他页返回时刷新未读数，避免标记后角标不更新
    if (this.list.length > 0) this.loadUnreadCount()
  },
  methods: {
    async refresh() {
      this.page = 1
      this.list = []
      await Promise.all([this.loadList(), this.loadUnreadCount()])
    },
    async loadList() {
      if (this.loading) return
      this.loading = true
      try {
        if (!await ensureTenantSession()) return
        const params = { page: this.page, limit: this.limit }
        // 注意：不能传 unreadOnly=false —— 后端对 "false" 的解析曾有问题，
        // 关闭筛选时应省略该参数（见 docs/09-待确认清单）
        if (this.filter === 'unread') params.unreadOnly = true
        const res = await getNotifications(params)
        const rows = res.data || []
        this.list = this.page === 1 ? rows : this.list.concat(rows)
        this.total = (res.meta && res.meta.total) || rows.length
      } catch (error) {
        console.error('加载通知失败:', error)
      } finally {
        this.loading = false
      }
    },
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
    loadMore() {
      if (!this.hasMore || this.loading) return
      this.page += 1
      this.loadList()
    },
    switchFilter(f) {
      if (this.filter === f) return
      this.filter = f
      this.refresh()
    },
    async handleRead(item) {
      if (item.isRead) return
      try {
        await markNotificationRead(item.id)
        item.isRead = true
        if (this.unreadCount > 0) this.unreadCount -= 1
        if (this.filter === 'unread') this.list = this.list.filter((n) => n.id !== item.id)
      } catch (error) {
        console.error('标记已读失败:', error)
      }
    },
    async handleOpen(item) {
      await this.handleRead(item)
    },
    async handleReadAll() {
      try {
        await markAllNotificationsRead()
        this.list = this.list.map((n) => ({ ...n, isRead: true }))
        this.unreadCount = 0
        uni.showToast({ title: '已全部标记为已读', icon: 'none' })
        if (this.filter === 'unread') this.refresh()
      } catch (error) {
        console.error('全部已读失败:', error)
      }
    },
    handleDelete(item) {
      uni.showModal({
        title: '删除通知',
        content: '确定删除这条通知吗？删除后不可恢复。',
        confirmText: '确定删除',
        cancelText: '取消',
        success: async (res) => {
          if (!res.confirm) return
          try {
            await deleteNotification(item.id)
            this.list = this.list.filter((n) => n.id !== item.id)
            if (!item.isRead && this.unreadCount > 0) this.unreadCount -= 1
            if (this.total > 0) this.total -= 1
            uni.showToast({ title: '已删除', icon: 'none' })
          } catch (error) {
            console.error('删除通知失败:', error)
          }
        }
      })
    },
    formatTime(value) {
      if (!value) return ''
      const d = new Date(value)
      const now = new Date()
      const diff = now - d
      if (diff < 60 * 1000) return '刚刚'
      if (diff < 60 * 60 * 1000) return Math.floor(diff / 60000) + ' 分钟前'
      if (diff < 24 * 60 * 60 * 1000) return Math.floor(diff / 3600000) + ' 小时前'
      if (diff < 7 * 24 * 60 * 60 * 1000) return Math.floor(diff / 86400000) + ' 天前'
      const pad = (n) => (n < 10 ? '0' + n : '' + n)
      return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
        ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes())
    }
  }
}
</script>

<style scoped>
.page {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background-color: var(--color-bg-secondary, #f5f5f5);
}

.tabs {
  display: flex;
  background-color: var(--color-bg-primary, #fff);
  padding: 20rpx 0;
}

.tab-item {
  flex: 1;
  text-align: center;
  font-size: 28rpx;
  color: var(--color-text-secondary, #666);
  padding: 20rpx 0;
  position: relative;
}

.tab-item.active {
  color: var(--color-primary, #1677ff);
  font-weight: bold;
}

.tab-item.active::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 50%;
  transform: translateX(-50%);
  width: 60rpx;
  height: 4rpx;
  background-color: var(--color-primary, #1677ff);
  border-radius: 2rpx;
}

.tab-badge {
  display: inline-block;
  margin-left: 8rpx;
  min-width: 32rpx;
  height: 32rpx;
  line-height: 32rpx;
  padding: 0 8rpx;
  border-radius: 16rpx;
  background-color: var(--color-error, #ff4d4f);
  color: #fff;
  font-size: 20rpx;
  font-weight: normal;
}

.toolbar {
  display: flex;
  justify-content: flex-end;
  padding: 12rpx 24rpx;
  background-color: var(--color-bg-primary, #fff);
  border-bottom: 1rpx solid var(--color-border-light, #f0f0f0);
}

.toolbar-action {
  font-size: 26rpx;
  color: var(--color-primary, #1677ff);
}

.list-container {
  flex: 1;
  padding: 20rpx;
}

.notice-item {
  background-color: var(--color-bg-primary, #fff);
  border-radius: 16rpx;
  padding: 28rpx;
  margin-bottom: 20rpx;
}

.notice-item.is-read {
  opacity: 0.62;
}

.notice-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16rpx;
  margin-bottom: 12rpx;
}

.notice-title-wrap {
  display: flex;
  align-items: center;
  min-width: 0;
  flex: 1;
}

.dot {
  width: 14rpx;
  height: 14rpx;
  border-radius: 50%;
  background-color: var(--color-error, #ff4d4f);
  margin-right: 12rpx;
  flex-shrink: 0;
}

.notice-title {
  font-size: 30rpx;
  font-weight: bold;
  color: var(--color-text-primary, #333);
}

.notice-body {
  display: block;
  font-size: 26rpx;
  color: var(--color-text-secondary, #666);
  line-height: 1.6;
  margin-bottom: 16rpx;
}

.notice-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-top: 16rpx;
  border-top: 1rpx solid var(--color-border-light, #f0f0f0);
}

.notice-time {
  font-size: 24rpx;
  color: var(--color-text-tertiary, #999);
}

.notice-actions {
  display: flex;
  gap: 24rpx;
}

.action {
  font-size: 26rpx;
  color: var(--color-primary, #1677ff);
}

.action.danger {
  color: var(--color-error, #ff4d4f);
}

.empty-title {
  display: block;
  margin-bottom: 12rpx;
}

.empty-hint {
  display: block;
  font-size: 24rpx;
  color: #bbb;
  line-height: 1.6;
}
</style>
