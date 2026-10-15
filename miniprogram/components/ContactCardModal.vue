<template>
  <view v-if="visible" class="contact-modal-overlay" @tap.self="close">
    <view class="contact-modal-card">
      <!-- 弹窗顶栏 -->
      <view class="modal-top">
        <view class="header-left">
          <view class="contact-avatar">{{ contact.name?.slice(0, 1) || '管' }}</view>
          <view class="header-titles">
            <view class="name-row">
              <text class="landlord-title">{{ contact.name || '栖居专属管家' }}</text>
              <text class="role-badge">专属房东/管家</text>
            </view>
            <text class="room-subtitle">{{ contact.roomTitle || '栖居居所生活服务' }}</text>
          </view>
        </view>
        <text class="modal-close-btn" @tap="close">✕</text>
      </view>

      <!-- 联系卡片核心区 -->
      <view class="contact-details">
        <!-- 微信号 -->
        <view class="contact-item">
          <view class="item-left">
            <view class="item-icon-box wechat-box">
              <text class="icon-text">微</text>
            </view>
            <view class="item-info">
              <text class="item-label">微信号</text>
              <text class="item-val selectable" :selectable="true">{{ contact.wechat || 'qiju_service' }}</text>
            </view>
          </view>
          <button class="action-btn wechat-btn" @tap="handleCopyWechat">
            复制微信
          </button>
        </view>

        <!-- 联系电话 -->
        <view class="contact-item">
          <view class="item-left">
            <view class="item-icon-box phone-box">
              <text class="icon-text">电</text>
            </view>
            <view class="item-info">
              <text class="item-label">联系电话</text>
              <text class="item-val selectable" :selectable="true">{{ contact.formattedPhone || contact.phone || '138-0013-8000' }}</text>
            </view>
          </view>
          <view class="phone-actions">
            <button class="action-btn call-btn" @tap="handleCall">
              拨打
            </button>
            <button class="action-btn copy-btn" @tap="handleCopyPhone">
              复制
            </button>
          </view>
        </view>
      </view>

      <!-- 服务时间与指引提示 -->
      <view class="service-notice-box">
        <view class="notice-row">
          <text class="notice-icon">⏰</text>
          <text class="notice-text">服务时间：{{ contact.serviceHours || '09:00 - 21:00' }}</text>
        </view>
        <view class="notice-row align-top">
          <text class="notice-icon">💡</text>
          <text class="notice-text">{{ contact.notice || '紧急设施问题（漏水、断电、门锁等）请直接拨打电话，一般咨询可添加微信留言。' }}</text>
        </view>
      </view>

      <!-- 快速快捷入口 -->
      <view class="quick-navs">
        <view class="quick-nav-btn" @tap="goToMaintenance">
          <text class="quick-icon">🛠️</text>
          <text class="quick-label">在线报修</text>
        </view>
        <view class="quick-nav-btn" @tap="goToContract">
          <text class="quick-icon">📄</text>
          <text class="quick-label">查看合同</text>
        </view>
      </view>
    </view>
  </view>
</template>

<script>
import { copyToClipboard, makePhoneCall } from '../utils/contact.js'

export default {
  name: 'ContactCardModal',
  props: {
    visible: {
      type: Boolean,
      default: false
    },
    contact: {
      type: Object,
      default: () => ({})
    }
  },
  methods: {
    close() {
      this.$emit('close')
      this.$emit('update:visible', false)
    },
    handleCopyWechat() {
      copyToClipboard(this.contact.wechat || 'qiju_service', '微信号')
    },
    handleCopyPhone() {
      copyToClipboard(this.contact.phone || '13800138000', '电话号码')
    },
    handleCall() {
      makePhoneCall(this.contact.phone || '13800138000')
    },
    goToMaintenance() {
      this.close()
      uni.switchTab({ url: '/pages/maintenance/maintenance' })
    },
    goToContract() {
      this.close()
      uni.navigateTo({ url: '/pages/contract/contract' })
    }
  }
}
</script>

<style scoped>
.contact-modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.48);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 36rpx;
  backdrop-filter: blur(4rpx);
}

.contact-modal-card {
  width: 100%;
  max-width: 620rpx;
  background: #fffefa;
  border-radius: 36rpx;
  padding: 40rpx 36rpx 36rpx;
  box-shadow: 0 16rpx 48rpx rgba(48, 47, 42, 0.18);
  border: 1rpx solid #eedec9;
  box-sizing: border-box;
}

.modal-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 32rpx;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 20rpx;
  flex: 1;
}

.contact-avatar {
  width: 88rpx;
  height: 88rpx;
  background: #515c43;
  color: #fffefa;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 36rpx;
  font-weight: 600;
  flex-shrink: 0;
  box-shadow: 0 6rpx 16rpx rgba(81, 92, 67, 0.25);
}

.header-titles {
  flex: 1;
  min-width: 0;
}

.name-row {
  display: flex;
  align-items: center;
  gap: 12rpx;
  flex-wrap: wrap;
}

.landlord-title {
  font-size: 32rpx;
  font-weight: 600;
  color: #302f2a;
}

.role-badge {
  font-size: 20rpx;
  color: #515c43;
  background: #ecf0e9;
  padding: 4rpx 14rpx;
  border-radius: 12rpx;
  font-weight: 500;
}

.room-subtitle {
  display: block;
  font-size: 22rpx;
  color: #8c857b;
  margin-top: 6rpx;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.modal-close-btn {
  font-size: 34rpx;
  color: #a49f95;
  padding: 8rpx 12rpx;
  cursor: pointer;
  line-height: 1;
}

.contact-details {
  display: flex;
  flex-direction: column;
  gap: 20rpx;
  margin-bottom: 28rpx;
}

.contact-item {
  background: #fbf9f4;
  border: 1rpx solid #ede8de;
  border-radius: 24rpx;
  padding: 24rpx;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16rpx;
}

.item-left {
  display: flex;
  align-items: center;
  gap: 18rpx;
  flex: 1;
  min-width: 0;
}

.item-icon-box {
  width: 60rpx;
  height: 60rpx;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.wechat-box {
  background: #e8f5e9;
  color: #2e7d32;
}

.phone-box {
  background: #eef2eb;
  color: #515c43;
}

.icon-text {
  font-size: 24rpx;
  font-weight: 600;
}

.item-info {
  flex: 1;
  min-width: 0;
}

.item-label {
  display: block;
  font-size: 20rpx;
  color: #8c857b;
  margin-bottom: 4rpx;
}

.item-val {
  display: block;
  font-size: 28rpx;
  font-weight: 600;
  color: #302f2a;
  word-break: break-all;
}

.phone-actions {
  display: flex;
  gap: 12rpx;
  flex-shrink: 0;
}

.action-btn {
  font-size: 24rpx;
  height: 64rpx;
  line-height: 64rpx;
  padding: 0 24rpx;
  border-radius: 16rpx;
  font-weight: 550;
  margin: 0;
  border: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.action-btn::after {
  border: none;
}

.wechat-btn {
  background: #2e7d32;
  color: #ffffff;
  box-shadow: 0 4rpx 12rpx rgba(46, 125, 50, 0.2);
}

.call-btn {
  background: #515c43;
  color: #ffffff;
  box-shadow: 0 4rpx 12rpx rgba(81, 92, 67, 0.2);
}

.copy-btn {
  background: #ece8df;
  color: #68715b;
}

.service-notice-box {
  background: #f6f4ec;
  border-radius: 20rpx;
  padding: 20rpx 24rpx;
  margin-bottom: 28rpx;
  display: flex;
  flex-direction: column;
  gap: 12rpx;
}

.notice-row {
  display: flex;
  gap: 12rpx;
  align-items: center;
}

.notice-row.align-top {
  align-items: flex-start;
}

.notice-icon {
  font-size: 24rpx;
  flex-shrink: 0;
  line-height: 1.4;
}

.notice-text {
  font-size: 22rpx;
  color: #7a756c;
  line-height: 1.4;
}

.quick-navs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16rpx;
}

.quick-nav-btn {
  background: #fffefa;
  border: 1rpx solid #e2ded5;
  border-radius: 20rpx;
  padding: 18rpx 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10rpx;
  cursor: pointer;
}

.quick-icon {
  font-size: 26rpx;
}

.quick-label {
  font-size: 24rpx;
  font-weight: 500;
  color: #515c43;
}
</style>
