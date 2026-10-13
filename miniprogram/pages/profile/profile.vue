<template>
  <view class="page">
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
import { getUserInfo } from '../../api/index.js'
import { clearSession, openHome } from '../../utils/session.js'

export default {
  data() {
    return {
      userInfo: {}
    }
  },
  onShow() {
    this.loadUserInfo()
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
  background-color: #f5f5f5;
}

.header {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
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
  background-color: #fff;
  margin: 20rpx;
  border-radius: 16rpx;
  overflow: hidden;
}

.menu-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 30rpx;
  border-bottom: 1rpx solid #f0f0f0;
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
  color: #333;
}

.arrow {
  font-size: 40rpx;
  color: #ccc;
}

.btn-logout {
  width: calc(100% - 40rpx);
  margin: 40rpx 20rpx;
  height: 88rpx;
  background-color: #fff;
  color: #f44336;
  border: 1rpx solid #f0f0f0;
  border-radius: 12rpx;
  font-size: 28rpx;
}
</style>
