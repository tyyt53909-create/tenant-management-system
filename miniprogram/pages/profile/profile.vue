<template>
  <view class="page page-with-tabbar">
    <view class="header">
      <view class="user-info">
        <image class="avatar" src="/static/avatar-default.png" mode="aspectFill"></image>
        <view class="info">
          <text class="name">{{ userInfo.name || '租客' }}</text>
          <text class="phone">{{ userInfo.phone || '' }}</text>
        </view>
      </view>
    </view>

    <view class="menu-list">
      <view class="menu-item" @tap="goToNotifications">
        <view class="item-left">
          <text class="icon">🔔</text>
          <text class="text">通知提醒</text>
          <text class="menu-badge" v-if="unreadCount > 0">{{ unreadCount > 99 ? '99+' : unreadCount }}</text>
        </view>
        <text class="arrow">›</text>
      </view>
      <view class="menu-item" @tap="goToContract">
        <view class="item-left">
          <text class="icon">📄</text>
          <text class="text">我的合同</text>
        </view>
        <text class="arrow">›</text>
      </view>
      <view class="menu-item" @tap="goToAccount">
        <view class="item-left">
          <text class="icon">💰</text>
          <text class="text">账户余额</text>
        </view>
        <text class="arrow">›</text>
      </view>
    </view>

    <view class="menu-list">
      <view class="menu-item" @tap="showAbout">
        <view class="item-left">
          <text class="icon">ℹ️</text>
          <text class="text">关于我们</text>
        </view>
        <text class="arrow">›</text>
      </view>
      <view class="menu-item" @tap="showContact">
        <view class="item-left">
          <text class="icon">📞</text>
          <text class="text">联系客服</text>
        </view>
        <text class="arrow">›</text>
      </view>
    </view>

    <button class="btn-logout" @tap="logout">退出登录</button>
  </view>
</template>

<script>
import { getUserInfo, getUnreadCount } from '../../api/index.js'
import { clearSession, openHome } from '../../utils/session.js'

export default {
  data() {
    return {
      userInfo: {},
      unreadCount: 0
    }
  },
  onShow() {
    this.loadUserInfo()
    this.loadUnreadCount()
  },
  methods: {
    async loadUserInfo() {
      try {
        const res = await getUserInfo()
        uni.setStorageSync('user_role', res.role)
        if (res.role === 'CLEANER') {
          openHome(res.role)
          return
        }
        this.userInfo = res.tenant || {}
      } catch (error) {
        console.error('加载用户信息失败:', error)
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
    goToNotifications() {
      uni.navigateTo({ url: '/pages/notifications/notifications' })
    },
    goToContract() {
      uni.navigateTo({ url: '/pages/contract/contract' })
    },
    goToAccount() {
      uni.navigateTo({ url: '/pages/account/account' })
    },
    showAbout() {
      uni.showModal({
        title: '关于我们',
        content: '租客管理系统 v1.0.0\n\n为租客提供便捷的租房管理服务',
        showCancel: false
      })
    },
    showContact() {
      uni.showModal({
        title: '联系客服',
        content: '客服电话：400-xxx-xxxx\n工作时间：9:00-18:00',
        showCancel: false
      })
    },
    logout() {
      uni.showModal({
        title: '确认退出',
        content: '确定要退出登录吗？',
        success: (res) => {
          if (res.confirm) {
            clearSession()
            uni.reLaunch({ url: '/pages/login/login' })
          }
        }
      })
    }
  }
}
</script>

<style scoped>
.page {
  min-height: 100vh;
  background-color: var(--color-bg-secondary);
}

.header {
  background: linear-gradient(135deg, #7a8469 0%, #68715b 100%);
  padding: 60rpx 30rpx;
}

.user-info {
  display: flex;
  align-items: center;
}

.avatar {
  width: 120rpx;
  height: 120rpx;
  border-radius: 50%;
  margin-right: 30rpx;
  background-color: #fff;
}

.info {
  display: flex;
  flex-direction: column;
  color: #fff;
}

.name {
  font-size: 36rpx;
  font-weight: bold;
  margin-bottom: 12rpx;
}

.phone {
  font-size: 26rpx;
  opacity: 0.9;
}

.menu-list {
  background-color: var(--color-bg-primary);
  margin: 20rpx;
  border-radius: var(--radius-lg);
  overflow: hidden;
  box-shadow: var(--shadow-sm);
}

.menu-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 30rpx;
  border-bottom: 1rpx solid var(--color-border-light);
  transition: background-color 0.2s;
}

.menu-item:active {
  background-color: var(--color-bg-tertiary);
}

.menu-item:last-child {
  border-bottom: none;
}

.item-left {
  display: flex;
  align-items: center;
}

.icon {
  font-size: 40rpx;
  margin-right: 20rpx;
}

.text {
  font-size: 28rpx;
  color: var(--color-text-primary);
}

.menu-badge {
  margin-left: 16rpx;
  min-width: 34rpx;
  height: 34rpx;
  line-height: 34rpx;
  padding: 0 10rpx;
  border-radius: 17rpx;
  background-color: var(--color-warning);
  color: #fff;
  font-size: 20rpx;
  text-align: center;
}

.arrow {
  font-size: 40rpx;
  color: var(--color-text-tertiary);
}

.btn-logout {
  width: calc(100% - 40rpx);
  margin: 40rpx 20rpx;
  height: 88rpx;
  background-color: var(--color-bg-primary);
  color: var(--color-error);
  border: 1rpx solid var(--color-border);
  border-radius: var(--radius-md);
  font-size: 28rpx;
  box-shadow: var(--shadow-sm);
}

.btn-logout:active {
  opacity: 0.8;
  transform: scale(0.98);
}
</style>
