<template>
  <view class="q-page page-with-tabbar">
    <text class="q-eyebrow">MY SPACE / 我的生活</text><text class="q-title">居住的小事，都在这里。</text>
    <view class="profile-card q-surface"><view class="profile-avatar">{{ userInfo.name?.slice(0, 1) || '栖' }}</view><view><text class="profile-name">{{ userInfo.name || '租客' }}</text><text class="profile-phone">{{ maskedPhone || '欢迎来到栖居' }}</text></view><text class="q-pill">租客</text></view>
    <view class="q-section-heading"><text>居住服务</text></view>
    <view class="q-surface profile-menu"><view v-for="item in menu" :key="item.label" class="profile-menu-item" @tap="open(item.path)"><QIcon :name="item.icon" :size="36" /><text>{{ item.label }}</text><text v-if="item.icon === 'bell' && unreadCount" class="profile-badge">{{ unreadCount > 99 ? '99+' : unreadCount }}</text><text class="profile-arrow">›</text></view></view>
    <view class="q-section-heading"><text>帮助与账户</text></view>
    <view class="q-surface profile-menu"><view class="profile-menu-item" @tap="showContact"><QIcon name="user" :size="36" /><text>联系管理者</text><text class="profile-arrow">›</text></view><view class="profile-menu-item" @tap="showAbout"><QIcon name="home" :size="36" /><text>关于栖居</text><text class="profile-arrow">›</text></view></view>
    <button class="q-outline profile-logout" @tap="logout">退出登录</button><text class="q-note">栖居 · 让每一件小事，都有清楚的回应</text>
  </view>
</template>
<script>
import QIcon from '../../components/QIcon.vue'
import { getUserInfo, getUnreadCount } from '../../api/index.js'
import { clearSession, openHome } from '../../utils/session.js'
export default {
  components: { QIcon }, data() { return { userInfo: {}, unreadCount: 0, menu: [{ label: '通知提醒', icon: 'bell', path: '/pages/notifications/notifications' }, { label: '我的合同', icon: 'contract', path: '/pages/contract/contract' }, { label: '账户余额', icon: 'wallet', path: '/pages/account/account' }] } },
  computed: { maskedPhone() { const p = this.userInfo.phone || ''; return /^\d{11}$/.test(p) ? `${p.slice(0, 3)}****${p.slice(-4)}` : p } },
  onShow() { this.loadUserInfo() },
  methods: {
    async loadUserInfo() { if (!uni.getStorageSync('access_token')) { uni.reLaunch({ url: '/pages/login/login' }); return }; try { const user = await getUserInfo(); uni.setStorageSync('user_role', user.role); if (user.role === 'CLEANER') { openHome(user.role); return }; this.userInfo = user.tenant || {}; const res = await getUnreadCount(); this.unreadCount = res.unreadCount || 0 } catch (error) { console.error('个人信息加载失败', error) } },
    open(path) { uni.navigateTo({ url: path }) },
    showContact() { uni.showModal({ title: '联系管理者', content: '请通过签约时约定的联系方式联系管理者。居住设施问题也可以通过报修页面提交。', showCancel: false }) },
    showAbout() { uni.showModal({ title: '关于栖居', content: '栖居 · 租客生活服务\n账单、合同、报修与通知，妥善照顾居住中的每一件小事。', showCancel: false }) },
    logout() { uni.showModal({ title: '退出登录', content: '确认退出当前账户吗？', success: res => { if (res.confirm) { clearSession(); uni.reLaunch({ url: '/pages/login/login' }) } } }) },
  }
}
</script>
<style scoped>.profile-card{display:flex;align-items:center;gap:24rpx;margin-top:38rpx}.profile-avatar{height:92rpx;width:92rpx;background:#e8e5da;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:34rpx;color:#68715b;flex-shrink:0}.profile-card>view:nth-child(2){flex:1;min-width:0}.profile-name{font-size:30rpx;font-weight:550;display:block;overflow-wrap:anywhere}.profile-phone{display:block;color:#a49f95;font-size:22rpx;margin-top:12rpx}.profile-menu{padding:8rpx 32rpx}.profile-menu-item{display:flex;align-items:center;gap:22rpx;padding:28rpx 0;border-bottom:1rpx solid #e9e6de;font-size:25rpx}.profile-menu-item:last-child{border:0}.profile-arrow{margin-left:auto;color:#a49f95;font-size:34rpx}.profile-badge{background:#ad735a;color:white;font-size:20rpx;padding:3rpx 12rpx;border-radius:10rpx}.profile-logout{margin-top:40rpx;color:#ad735a;border-color:#e2cfc2}</style>
