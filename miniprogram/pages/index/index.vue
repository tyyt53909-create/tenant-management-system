<template>
  <view class="page page-with-tabbar">
    <!-- 顶部用户信息 - 栖居版橄榄绿渐变 -->
    <view class="header">
      <view class="user-info">
        <view class="avatar-wrapper">
          <image class="avatar" src="/static/avatar-default.png" mode="aspectFill"></image>
          <view class="avatar-ring"></view>
        </view>
        <view class="info">
          <text class="greeting">{{ getGreeting() }}</text>
          <text class="name">{{ userName || '租客' }}</text>
          <text class="room">{{ roomInfo || '暂无房间' }}</text>
        </view>
      </view>
      <view class="header-decoration"></view>
    </view>

    <!-- 快捷功能 - 浮动卡片效果 -->
    <view class="quick-menu-wrapper">
      <view class="quick-menu">
        <view 
          class="menu-item" 
          v-for="(item, index) in menuItems" 
          :key="index"
          :style="{ animationDelay: (index * 50) + 'ms' }"
          @tap="item.action"
          hover-class="menu-item-hover"
          hover-stay-time="100"
        >
          <view class="icon-wrapper">
            <image class="icon" :src="item.icon" mode="aspectFit"></image>
          </view>
          <text class="menu-text">{{ item.text }}</text>
        </view>
      </view>
    </view>

    <!-- 待办事项 - 优先级高的内容 -->
    <view class="card card-todo" v-if="hasTodos">
      <view class="card-header">
        <view class="header-left">
          <text class="title">待办事项</text>
          <view class="badge-count" v-if="totalTodos > 0">{{ totalTodos }}</view>
        </view>
        <text class="subtitle">需要您关注</text>
      </view>
      <view class="todo-list">
        <view 
          class="todo-item" 
          v-if="pendingBillsCount > 0"
          @tap="goToBills"
          hover-class="todo-item-hover"
        >
          <view class="todo-left">
            <view class="todo-icon-wrapper warning">
              <text class="todo-icon">💰</text>
            </view>
            <view class="todo-content">
              <text class="todo-text">{{ pendingBillsCount }} 笔账单待缴</text>
              <text class="todo-hint">点击查看详情</text>
            </view>
          </view>
          <view class="todo-arrow">
            <text class="arrow-icon">›</text>
          </view>
        </view>
        <view 
          class="todo-item" 
          v-if="pendingMaintenanceCount > 0"
          @tap="goToMaintenance"
          hover-class="todo-item-hover"
        >
          <view class="todo-left">
            <view class="todo-icon-wrapper info">
              <text class="todo-icon">🔧</text>
            </view>
            <view class="todo-content">
              <text class="todo-text">{{ pendingMaintenanceCount }} 个报修处理中</text>
              <text class="todo-hint">查看处理进度</text>
            </view>
          </view>
          <view class="todo-arrow">
            <text class="arrow-icon">›</text>
          </view>
        </view>
      </view>
    </view>

    <!-- 空状态 - 无待办时显示 -->
    <view class="card card-empty" v-else>
      <view class="empty-content">
        <text class="empty-icon">✨</text>
        <text class="empty-title">一切安好</text>
        <text class="empty-desc">暂时没有需要处理的事项</text>
      </view>
    </view>

    <!-- 最近账单 -->
    <view class="card card-bills">
      <view class="card-header">
        <view class="header-left">
          <text class="title">最近账单</text>
        </view>
        <text class="more" @tap="goToBills" hover-class="more-hover">
          查看全部 <text class="more-arrow">›</text>
        </text>
      </view>
      <view class="bill-list" v-if="recentBills.length > 0">
        <view 
          class="bill-item" 
          v-for="bill in recentBills" 
          :key="bill.id"
          hover-class="bill-item-hover"
          @tap="goToBills"
        >
          <view class="bill-left">
            <view class="bill-icon">
              <text>{{ getBillIcon(bill.billType) }}</text>
            </view>
            <view class="bill-info">
              <text class="bill-title">{{ getBillTypeText(bill.billType) }}</text>
              <text class="bill-period">{{ bill.period }}</text>
            </view>
          </view>
          <view class="bill-right">
            <text class="bill-amount">¥{{ formatAmount(bill.amount) }}</text>
            <view :class="['bill-status', getBillStatusClass(bill.status)]">
              {{ getBillStatusText(bill.status) }}
            </view>
          </view>
        </view>
      </view>
      <view class="empty-state" v-else>
        <text class="empty-icon">📋</text>
        <text class="empty-text">暂无账单记录</text>
      </view>
    </view>

    <!-- 底部间距 -->
    <view class="bottom-spacer"></view>
  </view>
</template>

<script>
import { getUserInfo, getMyBills, getMyMaintenance } from '../../api/index.js'
import { openHome } from '../../utils/session.js'

export default {
  data() {
    return {
      userName: '',
      roomInfo: '',
      pendingBillsCount: 0,
      pendingMaintenanceCount: 0,
      recentBills: [],
      menuItems: [
        { 
          icon: '/static/contract.png', 
          text: '我的合同', 
          action: () => this.goToContract() 
        },
        { 
          icon: '/static/bill.png', 
          text: '账单缴费', 
          action: () => this.goToBills() 
        },
        { 
          icon: '/static/repair.png', 
          text: '在线报修', 
          action: () => this.goToMaintenance() 
        },
        { 
          icon: '/static/wallet.png', 
          text: '账户余额', 
          action: () => this.goToAccount() 
        }
      ]
    }
  },
  computed: {
    hasTodos() {
      return this.pendingBillsCount > 0 || this.pendingMaintenanceCount > 0
    },
    totalTodos() {
      return this.pendingBillsCount + this.pendingMaintenanceCount
    }
  },
  onShow() {
    this.loadData()
  },
  methods: {
    async loadData() {
      try {
        const userInfo = await getUserInfo()
        uni.setStorageSync('user_role', userInfo.role)
        if (userInfo.role === 'CLEANER') {
          openHome(userInfo.role)
          return
        }
        this.userName = userInfo.tenant?.name || '租客'
        this.roomInfo = userInfo.tenant?.currentContract?.room?.roomNumber 
          ? `${userInfo.tenant.currentContract.building?.name || ''} ${userInfo.tenant.currentContract.room.roomNumber}室`
          : '暂无房间'
        
        const billsRes = await getMyBills({ page: 1, limit: 5 })
        this.recentBills = billsRes.data || []
        this.pendingBillsCount = billsRes.data?.filter(b => b.status === 'PENDING').length || 0
        
        const maintenanceRes = await getMyMaintenance({ page: 1, limit: 10 })
        this.pendingMaintenanceCount = maintenanceRes.data?.filter(
          m => m.status !== 'COMPLETED' && m.status !== 'CANCELLED'
        ).length || 0
      } catch (error) {
        console.error('加载数据失败:', error)
      }
    },
    getGreeting() {
      const hour = new Date().getHours()
      if (hour < 6) return '夜深了'
      if (hour < 9) return '早上好'
      if (hour < 12) return '上午好'
      if (hour < 14) return '中午好'
      if (hour < 18) return '下午好'
      if (hour < 22) return '晚上好'
      return '夜深了'
    },
    getBillIcon(type) {
      const icons = {
        'RENT': '🏠',
        'UTILITY': '⚡',
        'DEPOSIT': '💎'
      }
      return icons[type] || '📄'
    },
    getBillTypeText(type) {
      const map = {
        'RENT': '房屋租金',
        'UTILITY': '水电费',
        'DEPOSIT': '押金'
      }
      return map[type] || '其他'
    },
    formatAmount(amount) {
      return (amount / 100).toFixed(2)
    },
    getBillStatusText(status) {
      const map = {
        PENDING: '待支付',
        PARTIAL: '部分支付',
        PAID: '已支付',
        OVERDUE: '已逾期',
        CANCELLED: '已取消'
      }
      return map[status] || status
    },
    getBillStatusClass(status) {
      const map = {
        PENDING: 'status-warning',
        PAID: 'status-success',
        OVERDUE: 'status-danger',
        PARTIAL: 'status-info'
      }
      return map[status] || ''
    },
    goToContract() {
      uni.navigateTo({ url: '/pages/contract/contract' })
    },
    goToBills() {
      uni.switchTab({ url: '/pages/bills/bills' })
    },
    goToMaintenance() {
      uni.switchTab({ url: '/pages/maintenance/maintenance' })
    },
    goToAccount() {
      uni.navigateTo({ url: '/pages/account/account' })
    }
  }
}
</script>

<style scoped>
/* ==================== 页面基础 ==================== */
.page {
  min-height: 100vh;
  background: var(--color-bg-secondary);
}

/* ==================== 顶部用户信息 ==================== */
.header {
  position: relative;
  background: linear-gradient(135deg, #7a8469 0%, #68715b 100%);
  padding: 50rpx 30rpx 80rpx;
  color: #fff;
  overflow: hidden;
}

.header-decoration {
  position: absolute;
  right: -50rpx;
  top: -50rpx;
  width: 200rpx;
  height: 200rpx;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 50%;
}

.user-info {
  display: flex;
  align-items: center;
  position: relative;
  z-index: 1;
}

.avatar-wrapper {
  position: relative;
  margin-right: 24rpx;
}

.avatar {
  width: 108rpx;
  height: 108rpx;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.2);
  border: 3rpx solid rgba(255, 255, 255, 0.3);
}

.avatar-ring {
  position: absolute;
  top: -6rpx;
  left: -6rpx;
  right: -6rpx;
  bottom: -6rpx;
  border: 2rpx solid rgba(255, 255, 255, 0.2);
  border-radius: 50%;
  animation: pulse 3s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.5;
    transform: scale(1.05);
  }
}

.info {
  display: flex;
  flex-direction: column;
  gap: 6rpx;
}

.greeting {
  font-size: 22rpx;
  opacity: 0.85;
  font-weight: 400;
}

.name {
  font-size: 38rpx;
  font-weight: 650;
  letter-spacing: -0.5rpx;
}

.room {
  font-size: 24rpx;
  opacity: 0.8;
  margin-top: 2rpx;
}

/* ==================== 快捷功能 ==================== */
.quick-menu-wrapper {
  padding: 0 20rpx;
  margin-top: -50rpx;
  position: relative;
  z-index: 2;
}

.quick-menu {
  background: var(--color-bg-primary);
  border-radius: var(--radius-lg);
  padding: 36rpx 20rpx 32rpx;
  box-shadow: var(--shadow-md);
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 20rpx;
}

.menu-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14rpx;
  opacity: 0;
  animation: slideInUp var(--duration-normal) ease-out forwards;
}

@keyframes slideInUp {
  from {
    opacity: 0;
    transform: translateY(20rpx);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.menu-item-hover {
  transform: scale(0.95);
  transition: transform var(--duration-fast);
}

.icon-wrapper {
  width: 88rpx;
  height: 88rpx;
  background: var(--color-bg-tertiary);
  border-radius: var(--radius-md);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all var(--duration-normal);
}

.menu-item:active .icon-wrapper {
  background: var(--color-primary);
  transform: scale(0.9);
}

.menu-item .icon {
  width: 48rpx;
  height: 48rpx;
}

.menu-text {
  font-size: 24rpx;
  color: var(--color-text-primary);
  font-weight: 500;
}

/* ==================== 卡片通用样式 ==================== */
.card {
  background: var(--color-bg-primary);
  margin: 20rpx;
  border-radius: var(--radius-lg);
  padding: 30rpx;
  box-shadow: var(--shadow-sm);
  animation: fadeInScale var(--duration-slow) ease-out;
}

@keyframes fadeInScale {
  from {
    opacity: 0;
    transform: scale(0.95);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24rpx;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 12rpx;
}

.title {
  font-size: 32rpx;
  font-weight: 650;
  color: var(--color-text-primary);
  letter-spacing: -0.3rpx;
}

.subtitle {
  font-size: 22rpx;
  color: var(--color-text-tertiary);
}

.badge-count {
  min-width: 36rpx;
  height: 36rpx;
  line-height: 36rpx;
  padding: 0 10rpx;
  background: var(--color-warning);
  color: #fff;
  border-radius: 18rpx;
  font-size: 20rpx;
  font-weight: 650;
  text-align: center;
}

.more {
  font-size: 24rpx;
  color: var(--color-text-tertiary);
  display: flex;
  align-items: center;
  gap: 4rpx;
}

.more-hover {
  color: var(--color-primary);
}

.more-arrow {
  font-size: 28rpx;
  transition: transform var(--duration-fast);
}

.more:active .more-arrow {
  transform: translateX(4rpx);
}

/* ==================== 待办事项 ==================== */
.card-todo {
  border-left: 6rpx solid var(--color-warning);
}

.todo-list {
  display: flex;
  flex-direction: column;
  gap: 4rpx;
}

.todo-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20rpx 16rpx;
  border-radius: var(--radius-md);
  transition: all var(--duration-fast);
}

.todo-item-hover {
  background: var(--color-bg-tertiary);
  transform: translateX(4rpx);
}

.todo-left {
  display: flex;
  align-items: center;
  gap: 20rpx;
  flex: 1;
}

.todo-icon-wrapper {
  width: 72rpx;
  height: 72rpx;
  border-radius: var(--radius-md);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 36rpx;
}

.todo-icon-wrapper.warning {
  background: var(--color-warning-bg);
}

.todo-icon-wrapper.info {
  background: var(--color-info-bg);
}

.todo-content {
  display: flex;
  flex-direction: column;
  gap: 6rpx;
}

.todo-text {
  font-size: 28rpx;
  color: var(--color-text-primary);
  font-weight: 550;
}

.todo-hint {
  font-size: 22rpx;
  color: var(--color-text-tertiary);
}

.todo-arrow {
  width: 40rpx;
  height: 40rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

.arrow-icon {
  font-size: 36rpx;
  color: var(--color-text-tertiary);
  transition: transform var(--duration-fast);
}

.todo-item:active .arrow-icon {
  transform: translateX(4rpx);
}

/* ==================== 空状态 ==================== */
.card-empty {
  border: 2rpx dashed var(--color-border);
  background: var(--color-bg-tertiary);
}

.empty-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 40rpx 20rpx;
  gap: 12rpx;
}

.empty-icon {
  font-size: 72rpx;
  opacity: 0.8;
}

.empty-title {
  font-size: 28rpx;
  color: var(--color-text-primary);
  font-weight: 550;
}

.empty-desc {
  font-size: 24rpx;
  color: var(--color-text-tertiary);
}

/* ==================== 账单列表 ==================== */
.bill-list {
  display: flex;
  flex-direction: column;
}

.bill-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 24rpx 0;
  border-bottom: 1rpx solid var(--color-border-light);
  transition: all var(--duration-fast);
}

.bill-item:last-child {
  border-bottom: none;
}

.bill-item-hover {
  background: var(--color-bg-tertiary);
  padding-left: 16rpx;
  padding-right: 16rpx;
  margin: 0 -16rpx;
  border-radius: var(--radius-sm);
}

.bill-left {
  display: flex;
  align-items: center;
  gap: 20rpx;
}

.bill-icon {
  width: 72rpx;
  height: 72rpx;
  background: var(--color-bg-tertiary);
  border-radius: var(--radius-md);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 36rpx;
}

.bill-info {
  display: flex;
  flex-direction: column;
  gap: 8rpx;
}

.bill-title {
  font-size: 28rpx;
  color: var(--color-text-primary);
  font-weight: 550;
}

.bill-period {
  font-size: 22rpx;
  color: var(--color-text-tertiary);
}

.bill-right {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 10rpx;
}

.bill-amount {
  font-size: 32rpx;
  font-weight: 720;
  color: var(--color-text-primary);
  letter-spacing: -0.5rpx;
}

.bill-status {
  font-size: 22rpx;
  padding: 6rpx 14rpx;
  border-radius: var(--radius-sm);
  font-weight: 550;
}

.status-warning {
  background: var(--color-warning-bg);
  color: var(--color-warning);
}

.status-success {
  background: var(--color-success-bg);
  color: var(--color-success);
}

.status-danger {
  background: var(--color-error-bg);
  color: var(--color-error);
}

.status-info {
  background: var(--color-info-bg);
  color: var(--color-info);
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 60rpx 20rpx;
  gap: 16rpx;
}

.empty-state .empty-icon {
  font-size: 80rpx;
  opacity: 0.5;
}

.empty-state .empty-text {
  font-size: 26rpx;
  color: var(--color-text-tertiary);
}

/* ==================== 底部间距 ==================== */
.bottom-spacer {
  height: var(--tabbar-space);
}
</style>
