<template>
  <view class="q-page settings-page has-role-tabbar">
    <text class="q-eyebrow">SETTINGS / 设置</text>
    <text class="q-title">把工作台调成顺手的样子。</text>
    <text class="q-description">账号、提醒与界面偏好都放在这里。</text>

    <view class="q-surface profile-card">
      <view class="profile-avatar">{{ initial }}</view>
      <view class="profile-copy">
        <text class="profile-email">{{ email || '维修人员' }}</text>
        <text class="profile-role">维修人员 · 栖居</text>
      </view>
    </view>

    <view class="q-section-heading"><text>提醒与偏好</text></view>
    <view class="q-surface settings-list">
      <view class="settings-row" @tap="goNotifications">
        <view class="settings-copy">
          <text class="settings-label">通知提醒</text>
          <text class="settings-hint">工单与系统消息</text>
        </view>
        <text class="settings-value">{{ unreadCount > 0 ? `${unreadCount} 条未读` : '已读完' }}</text>
        <text class="settings-arrow">›</text>
      </view>
      <view class="settings-row" @tap="goTheme">
        <view class="settings-copy">
          <text class="settings-label">主题设置</text>
          <text class="settings-hint">切换界面风格与暗色模式</text>
        </view>
        <text class="settings-arrow">›</text>
      </view>
      <view class="settings-row" @tap="showAbout">
        <view class="settings-copy">
          <text class="settings-label">关于栖居</text>
          <text class="settings-hint">版本与产品说明</text>
        </view>
        <text class="settings-value">v1.0</text>
        <text class="settings-arrow">›</text>
      </view>
    </view>

    <view class="q-section-heading"><text>账号</text></view>
    <view class="q-surface settings-account">
      <button class="q-outline logout-button" @tap="logout">退出登录</button>
    </view>

    <text class="q-note">栖居 · 让每一件小事，都有清楚的回应</text>
    <RoleTabBar active="settings" />
  </view>
</template>

<script>
import RoleTabBar from '../../components/RoleTabBar.vue'
import { getUnreadCount } from '../../api/index.js'
import { ensureSession, openHome, logoutSession } from '../../utils/session.js'

export default {
  components: { RoleTabBar },
  data() {
    return { email: '', unreadCount: 0, loading: false }
  },
  computed: {
    initial() {
      return (this.email || '维').slice(0, 1).toUpperCase()
    },
  },
  onShow() { this.load() },
  methods: {
    async load() {
      if (this.loading) return
      this.loading = true
      try {
        const user = await ensureSession()
        if (!user) return
        if (user.role !== 'MAINTENANCE') {
          openHome(user.role)
          return
        }
        this.email = user.email || ''
        const unread = await getUnreadCount().catch(() => ({ unreadCount: 0 }))
        this.unreadCount = unread.unreadCount || 0
      } finally {
        this.loading = false
      }
    },
    goNotifications() {
      uni.navigateTo({ url: '/pages/notifications/notifications' })
    },
    goTheme() {
      uni.navigateTo({ url: '/pages/theme/theme' })
    },
    showAbout() {
      uni.showModal({
        title: '栖居 · 维修工作台',
        content: '维修人员可以承接公共池工单、处理已指派工单，并提交维修结果。',
        showCancel: false,
        confirmText: '知道了',
      })
    },
    logout() {
      uni.showModal({
        title: '退出登录',
        content: '确定退出维修工作台吗？',
        success: result => {
          if (!result.confirm) return
          logoutSession()
          uni.reLaunch({ url: '/pages/login/login' })
        },
      })
    },
  },
}
</script>

<style scoped>
.settings-page { padding-bottom: calc(150rpx + env(safe-area-inset-bottom)); }
.profile-card { display: flex; align-items: center; gap: 24rpx; padding: 30rpx; }
.profile-avatar { width: 100rpx; height: 100rpx; border-radius: 50%; background: #ecf0e9; color: #4e5845; display: flex; align-items: center; justify-content: center; font-size: 38rpx; font-weight: 600; flex-shrink: 0; }
.profile-copy { flex: 1; min-width: 0; }
.profile-email { display: block; font-size: 27rpx; font-weight: 550; overflow-wrap: anywhere; }
.profile-role { display: block; margin-top: 8rpx; font-size: 20rpx; color: #8e8a80; }
.settings-list { padding: 4rpx 30rpx; }
.settings-row { display: flex; align-items: center; gap: 16rpx; padding: 28rpx 0; border-bottom: 1rpx solid #ece8df; }
.settings-row:last-child { border-bottom: none; }
.settings-copy { flex: 1; min-width: 0; }
.settings-label { display: block; font-size: 25rpx; font-weight: 550; }
.settings-hint { display: block; margin-top: 8rpx; font-size: 19rpx; color: #8e8a80; line-height: 1.6; }
.settings-value { font-size: 21rpx; color: #8e8a80; flex-shrink: 0; }
.settings-arrow { font-size: 28rpx; color: #a49f95; flex-shrink: 0; }
.settings-account { padding: 28rpx; }
.logout-button { width: 100%; color: #ad6356; border-color: #e6c9c0; }
</style>
