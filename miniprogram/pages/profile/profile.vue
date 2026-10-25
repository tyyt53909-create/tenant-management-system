<template>
  <view class="q-page page-with-tabbar">
    <text class="q-eyebrow">MY SPACE / 我的生活</text>
    <text class="q-title">居住的小事，都在这里。</text>
    <view v-if="error" class="q-error" @tap="loadUserInfo">{{ error }} · 点此重试</view>

    <!-- 租客名片 -->
    <view class="profile-card q-surface">
      <view class="profile-avatar">{{ userInfo.name?.slice(0, 1) || '栖' }}</view>
      <view>
        <text class="profile-name">{{ userInfo.name || '租客' }}</text>
        <text class="profile-phone">{{ maskedPhone || userEmail || '欢迎来到栖居' }}</text>
      </view>
      <text class="q-pill">{{ currentRoomTitle || '未绑定房源' }}</text>
    </view>

    <!-- 未绑定房源提示横幅 -->
    <view v-if="!currentRoomTitle" class="q-surface invite-banner">
      <view class="invite-banner-body">
        <text class="invite-banner-title">🔑 绑定房源邀请码</text>
        <text class="invite-banner-desc">已获得房源？输入管理员发放的邀请码，立即关联房间、合同与账单。</text>
      </view>
      <button class="invite-banner-btn" @tap="openBindModal">输入邀请码</button>
    </view>

    <!-- 专属房东与管家联系卡片 -->
    <view class="q-section-heading">
      <text>专属管家与房东</text>
      <text class="q-link" @tap="showContact">联系详情 ›</text>
    </view>
    <view class="q-surface landlord-card">
      <view class="landlord-header">
        <view class="landlord-avatar">{{ landlordContact.name?.slice(0, 1) || '管' }}</view>
        <view class="landlord-meta">
          <view class="landlord-title-row">
            <text class="landlord-name">{{ landlordContact.name || '栖居管家' }}</text>
            <text class="landlord-role-tag">专属责任人</text>
          </view>
          <text class="landlord-room-sub">{{ landlordContact.roomTitle || '栖居居所生活服务' }}</text>
        </view>
      </view>

      <view class="landlord-items">
        <!-- 微信号 -->
        <view class="landlord-item-row">
          <view class="item-badge-wrap">
            <text class="item-tag wechat-tag">微信</text>
            <text class="item-value selectable" :selectable="true">{{ landlordContact.wechat }}</text>
          </view>
          <button class="pill-btn wechat-pill" @tap="copyWechat">复制微信号</button>
        </view>

        <!-- 电话号码 -->
        <view class="landlord-item-row">
          <view class="item-badge-wrap">
            <text class="item-tag phone-tag">电话</text>
            <text class="item-value selectable" :selectable="true">{{ landlordContact.formattedPhone || landlordContact.phone }}</text>
          </view>
          <view class="phone-btn-group">
            <button class="pill-btn call-pill" @tap="callLandlord">拨打</button>
            <button class="pill-btn copy-pill" @tap="copyPhone">复制</button>
          </view>
        </view>
      </view>

      <view class="landlord-card-footer">
        <text class="landlord-hours-text">⏰ 服务时间：{{ landlordContact.serviceHours }}</text>
        <text class="landlord-tip-text">设施紧急故障请直接拨打电话，日常沟通欢迎添加微信留言。</text>
      </view>
    </view>

    <!-- 居住服务 -->
    <view class="q-section-heading"><text>居住服务</text></view>
    <view class="q-surface profile-menu">
      <view class="profile-menu-item" @tap="openBindModal">
        <QIcon name="home" :size="36" />
        <text>房源与邀请码绑定</text>
        <text class="profile-subtext">{{ currentRoomTitle ? '已关联房源' : '待绑定' }}</text>
        <text class="profile-arrow">›</text>
      </view>
      <view v-for="item in visibleMenu" :key="item.label" class="profile-menu-item" @tap="open(item.path)">
        <QIcon :name="item.icon" :size="36" />
        <text>{{ item.label }}</text>
        <text v-if="item.icon === 'bell' && unreadCount" class="profile-badge">
          {{ unreadCount > 99 ? '99+' : unreadCount }}
        </text>
        <text class="profile-arrow">›</text>
      </view>
    </view>

    <!-- 帮助与账户 -->
    <view class="q-section-heading"><text>帮助与账户</text></view>
    <view class="q-surface profile-menu">
      <view class="profile-menu-item" @tap="showContact">
        <QIcon name="user" :size="36" />
        <text>联系管理者</text>
        <text class="profile-arrow">›</text>
      </view>
      <view class="profile-menu-item" @tap="showAbout">
        <QIcon name="home" :size="36" />
        <text>关于栖居</text>
        <text class="profile-arrow">›</text>
      </view>
    </view>

    <button class="q-outline profile-logout" @tap="logout">退出登录</button>
    <text class="q-note">栖居 · 让每一件小事，都有清楚的回应</text>

    <!-- 输入邀请码弹窗 -->
    <view v-if="showBindDialog" class="modal-overlay" @tap.self="showBindDialog = false">
      <view class="modal-card q-surface">
        <view class="modal-header">
          <text class="modal-title">绑定房源邀请码</text>
          <text class="modal-close" @tap="showBindDialog = false">✕</text>
        </view>
        <text class="modal-subtitle">请输入管理员或房东向您发放的房源邀请码：</text>
        <input 
          class="modal-input" 
          v-model="inputInviteCode" 
          placeholder="例如：INVITE-172895..." 
          placeholder-class="placeholder" 
        />
        <view class="modal-actions">
          <button class="modal-btn-cancel" @tap="showBindDialog = false">取消</button>
          <button 
            class="modal-btn-confirm" 
            :loading="bindLoading" 
            :disabled="bindLoading" 
            @tap="submitBindInvite"
          >
            确认绑定
          </button>
        </view>
      </view>
    </view>

    <!-- 房东/管家联系卡片弹窗 -->
    <ContactCardModal
      :visible="showContactModal"
      :contact="landlordContact"
      @close="showContactModal = false"
    />
  </view>
</template>

<script>
import QIcon from '../../components/QIcon.vue'
import ContactCardModal from '../../components/ContactCardModal.vue'
import { getUserInfo, getUnreadCount, bindInviteCode } from '../../api/index.js'
import { logoutSession, openHome } from '../../utils/session.js'
import { getLandlordContact, copyToClipboard, makePhoneCall } from '../../utils/contact.js'

export default {
  components: { QIcon, ContactCardModal },
  data() {
    return {
      userInfo: {},
      rawUser: {},
      userEmail: '',
      unreadCount: 0,
      showBindDialog: false,
      inputInviteCode: '',
      bindLoading: false,
      showContactModal: false,
      error: '',
      landlordContact: getLandlordContact({}, []),
      capabilities: uni.getStorageSync('user_capabilities') || [],
      menu: [
        { label: '通知提醒', icon: 'bell', path: '/packageA/notifications/notifications' },
        { label: '我的合同', icon: 'contract', path: '/packageA/contract/contract', capability: 'tenant.contract.read' },
        { label: '账户余额', icon: 'wallet', path: '/packageA/account/account', capability: 'tenant.prepay.read' }
      ]
    }
  },
  computed: {
    visibleMenu() {
      if (!Array.isArray(this.capabilities)) {
        return this.menu.filter((item) => !item.capability)
      }
      return this.menu.filter(
        (item) => !item.capability || this.capabilities.includes(item.capability),
      )
    },
    maskedPhone() {
      const p = this.userInfo.phone || ''
      if (p.startsWith('pending-')) return ''
      return /^\d{11}$/.test(p) ? `${p.slice(0, 3)}****${p.slice(-4)}` : p
    },
    currentRoomTitle() {
      const contracts = this.userInfo.contracts || []
      const active = contracts[0]
      if (active && active.room) {
        const b = active.room.building?.name || ''
        const r = active.room.roomNumber || ''
        return `${b} ${r}室`.trim()
      }
      if (this.rawUser?.invitedBy) {
        return '已绑定邀请'
      }
      return ''
    }
  },
  onShow() {
    this.loadUserInfo()
  },
  methods: {
    async loadUserInfo() {
      if (!uni.getStorageSync('access_token')) {
        uni.reLaunch({ url: '/pages/login/login' })
        return
      }
      this.error = ''
      try {
        const user = await getUserInfo()
        uni.setStorageSync('user_role', user.role)
        if (user.role === 'CLEANER') {
          openHome(user.role)
          return
        }
        this.rawUser = user
        this.userEmail = user.email || ''
        this.userInfo = user.tenant || {}
        this.capabilities = user.capabilities || []
        uni.setStorageSync('user_capabilities', this.capabilities)
        this.landlordContact = getLandlordContact(user, this.userInfo.contracts || [])
        const res = await getUnreadCount()
        this.unreadCount = res.unreadCount || 0
      } catch (error) {
        console.error('个人信息加载失败', error)
        this.error = '居住信息暂时未能加载，请检查连接'
        this.capabilities = null
      }
    },
    open(path) {
      uni.navigateTo({ url: path })
    },
    openBindModal() {
      this.inputInviteCode = ''
      this.showBindDialog = true
    },
    async submitBindInvite() {
      const code = (this.inputInviteCode || '').trim()
      if (!code) {
        uni.showToast({ title: '请输入邀请码', icon: 'none' })
        return
      }

      this.bindLoading = true
      try {
        const res = await bindInviteCode({ inviteCode: code })
        uni.showToast({
          title: res.message || '绑定成功！',
          icon: 'success'
        })
        this.showBindDialog = false
        this.inputInviteCode = ''
        await this.loadUserInfo()
      } catch (err) {
        const msg = err.message || (err.data && err.data.message) || '邀请码无效或已过期'
        uni.showToast({ title: msg, icon: 'none' })
      } finally {
        this.bindLoading = false
      }
    },
    showContact() {
      this.showContactModal = true
    },
    copyWechat() {
      copyToClipboard(this.landlordContact.wechat, '微信号')
    },
    copyPhone() {
      copyToClipboard(this.landlordContact.phone, '电话号码')
    },
    callLandlord() {
      makePhoneCall(this.landlordContact.phone)
    },
    showAbout() {
      uni.showModal({
        title: '关于栖居',
        content: '栖居 · 租客生活服务\n账单、合同、报修与通知，妥善照顾居住中的每一件小事。',
        showCancel: false
      })
    },
    logout() {
      uni.showModal({
        title: '退出登录',
        content: '确认退出当前账户吗？',
        success: (res) => {
          if (res.confirm) {
            logoutSession()
            uni.reLaunch({ url: '/pages/login/login' })
          }
        }
      })
    }
  }
}
</script>

<style scoped>
.profile-card {
  display: flex;
  align-items: center;
  gap: 24rpx;
  margin-top: 38rpx;
}

.profile-avatar {
  height: 92rpx;
  width: 92rpx;
  background: #e8e5da;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 34rpx;
  color: #68715b;
  flex-shrink: 0;
}

.profile-card > view:nth-child(2) {
  flex: 1;
  min-width: 0;
}

.profile-name {
  font-size: 30rpx;
  font-weight: 550;
  display: block;
  overflow-wrap: anyhere;
}

.profile-phone {
  display: block;
  color: #a49f95;
  font-size: 22rpx;
  margin-top: 12rpx;
}

.invite-banner {
  margin-top: 24rpx;
  padding: 24rpx 28rpx;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20rpx;
  background: #fdfaf3;
  border: 1rpx solid #eedec9;
  border-radius: 20rpx;
}

.invite-banner-body {
  flex: 1;
}

.invite-banner-title {
  display: block;
  font-size: 26rpx;
  font-weight: bold;
  color: #8f603c;
  margin-bottom: 6rpx;
}

.invite-banner-desc {
  display: block;
  font-size: 21rpx;
  color: #8c857b;
  line-height: 1.4;
}

.invite-banner-btn {
  background: #8f603c;
  color: #ffffff;
  font-size: 24rpx;
  font-weight: 550;
  padding: 0 24rpx;
  height: 64rpx;
  line-height: 64rpx;
  border-radius: 12rpx;
  border: none;
  white-space: nowrap;
  flex-shrink: 0;
  margin: 0;
}

.invite-banner-btn::after {
  border: none;
}

.profile-menu {
  padding: 8rpx 32rpx;
}

.profile-menu-item {
  display: flex;
  align-items: center;
  gap: 22rpx;
  padding: 28rpx 0;
  border-bottom: 1rpx solid #e9e6de;
  font-size: 25rpx;
}

.profile-menu-item:last-child {
  border: 0;
}

.profile-subtext {
  margin-left: auto;
  color: #8c857b;
  font-size: 22rpx;
}

.profile-arrow {
  margin-left: 12rpx;
  color: #a49f95;
  font-size: 34rpx;
}

.profile-badge {
  background: #ad735a;
  color: white;
  font-size: 20rpx;
  padding: 3rpx 12rpx;
  border-radius: 10rpx;
}

.profile-logout {
  margin-top: 40rpx;
  color: #ad735a;
  border-color: #e2cfc2;
}

/* 弹窗样式 */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 999;
  padding: 30rpx;
}

.modal-card {
  width: 100%;
  max-width: 580rpx;
  background: #fffefa;
  border-radius: 28rpx;
  padding: 36rpx 32rpx;
  box-shadow: 0 10rpx 30rpx rgba(0, 0, 0, 0.15);
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20rpx;
}

.modal-title {
  font-size: 30rpx;
  font-weight: bold;
  color: #302f2a;
}

.modal-close {
  font-size: 32rpx;
  color: #999;
  padding: 0 10rpx;
  cursor: pointer;
}

.modal-subtitle {
  font-size: 24rpx;
  color: #817e76;
  margin-bottom: 24rpx;
  display: block;
  line-height: 1.5;
}

.modal-input {
  width: 100%;
  height: 84rpx;
  background: #f7f5f0;
  border: 1rpx solid #e5e0d8;
  border-radius: 12rpx;
  padding: 0 20rpx;
  font-size: 26rpx;
  color: #302f2a;
  box-sizing: border-box;
  margin-bottom: 32rpx;
}

.modal-actions {
  display: flex;
  gap: 16rpx;
}

.modal-btn-cancel {
  flex: 1;
  height: 76rpx;
  line-height: 76rpx;
  background: #f0ece3;
  color: #666;
  font-size: 26rpx;
  border-radius: 12rpx;
  border: none;
}

.modal-btn-cancel::after {
  border: none;
}

.modal-btn-confirm {
  flex: 1;
  height: 76rpx;
  line-height: 76rpx;
  background: #68715b;
  color: #ffffff;
  font-size: 26rpx;
  font-weight: 550;
  border-radius: 12rpx;
  border: none;
}

.modal-btn-confirm::after {
  border: none;
}

/* 专属管家与房东名片样式 */
.landlord-card {
  padding: 32rpx;
  margin-top: 12rpx;
  border-radius: 28rpx;
  background: #fffefa;
  border: 1rpx solid #eedec9;
}

.landlord-header {
  display: flex;
  align-items: center;
  gap: 22rpx;
  margin-bottom: 26rpx;
}

.landlord-avatar {
  width: 80rpx;
  height: 80rpx;
  border-radius: 50%;
  background: #515c43;
  color: #fffefa;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 32rpx;
  font-weight: 600;
  flex-shrink: 0;
}

.landlord-meta {
  flex: 1;
  min-width: 0;
}

.landlord-title-row {
  display: flex;
  align-items: center;
  gap: 12rpx;
}

.landlord-name {
  font-size: 30rpx;
  font-weight: 600;
  color: #302f2a;
}

.landlord-role-tag {
  font-size: 20rpx;
  color: #515c43;
  background: #ecf0e9;
  padding: 2rpx 12rpx;
  border-radius: 10rpx;
}

.landlord-room-sub {
  display: block;
  font-size: 22rpx;
  color: #8c857b;
  margin-top: 6rpx;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.landlord-items {
  display: flex;
  flex-direction: column;
  gap: 16rpx;
}

.landlord-item-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: #fbf9f4;
  border: 1rpx solid #ede8de;
  border-radius: 18rpx;
  padding: 18rpx 22rpx;
  gap: 12rpx;
}

.item-badge-wrap {
  display: flex;
  align-items: center;
  gap: 16rpx;
  flex: 1;
  min-width: 0;
}

.item-tag {
  font-size: 20rpx;
  padding: 4rpx 12rpx;
  border-radius: 10rpx;
  font-weight: 600;
  flex-shrink: 0;
}

.wechat-tag {
  background: #e8f5e9;
  color: #2e7d32;
}

.phone-tag {
  background: #eef2eb;
  color: #515c43;
}

.item-value {
  font-size: 26rpx;
  font-weight: 600;
  color: #302f2a;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pill-btn {
  font-size: 22rpx;
  font-weight: 550;
  height: 56rpx;
  line-height: 56rpx;
  padding: 0 20rpx;
  border-radius: 14rpx;
  border: none;
  margin: 0;
  flex-shrink: 0;
}

.pill-btn::after {
  border: none;
}

.wechat-pill {
  background: #2e7d32;
  color: #ffffff;
}

.phone-btn-group {
  display: flex;
  gap: 10rpx;
  flex-shrink: 0;
}

.call-pill {
  background: #515c43;
  color: #ffffff;
}

.copy-pill {
  background: #ece8df;
  color: #68715b;
}

.landlord-card-footer {
  margin-top: 22rpx;
  padding-top: 18rpx;
  border-top: 1rpx dashed #ede8de;
  display: flex;
  flex-direction: column;
  gap: 8rpx;
}

.landlord-hours-text {
  font-size: 21rpx;
  color: #8c857b;
}

.landlord-tip-text {
  font-size: 20rpx;
  color: #a49f95;
  line-height: 1.4;
}
</style>
