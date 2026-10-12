<template>
  <view class="page">
    <!-- 顶部用户信息 -->
    <view class="header">
      <view class="user-info">
        <image class="avatar" src="/static/avatar-default.png" mode="aspectFill"></image>
        <view class="info">
          <text class="name">{{ userName || '租客' }}</text>
          <text class="room">{{ roomInfo || '暂无房间' }}</text>
        </view>
      </view>
    </view>

    <!-- 快捷功能 -->
    <view class="quick-menu">
      <view class="menu-item" @tap="goToContract">
        <image class="icon" src="/static/contract.png" mode="aspectFit"></image>
        <text>我的合同</text>
      </view>
      <view class="menu-item" @tap="goToBills">
        <image class="icon" src="/static/bill.png" mode="aspectFit"></image>
        <text>账单缴费</text>
      </view>
      <view class="menu-item" @tap="goToMaintenance">
        <image class="icon" src="/static/repair.png" mode="aspectFit"></image>
        <text>在线报修</text>
      </view>
      <view class="menu-item" @tap="goToAccount">
        <image class="icon" src="/static/wallet.png" mode="aspectFit"></image>
        <text>账户余额</text>
      </view>
    </view>

    <!-- 待办事项 -->
    <view class="card">
      <view class="card-header">
        <text class="title">待办事项</text>
      </view>
      <view class="todo-list">
        <view class="todo-item" v-if="pendingBillsCount > 0">
          <view class="todo-left">
            <text class="todo-icon">💰</text>
            <text class="todo-text">{{ pendingBillsCount }} 笔账单待缴</text>
          </view>
          <text class="todo-action" @tap="goToBills">去处理</text>
        </view>
        <view class="todo-item" v-if="pendingMaintenanceCount > 0">
          <view class="todo-left">
            <text class="todo-icon">🔧</text>
            <text class="todo-text">{{ pendingMaintenanceCount }} 个报修处理中</text>
          </view>
          <text class="todo-action" @tap="goToMaintenance">查看</text>
        </view>
        <view class="empty" v-if="pendingBillsCount === 0 && pendingMaintenanceCount === 0">
          <text>暂无待办事项</text>
        </view>
      </view>
    </view>

    <!-- 最近账单 -->
    <view class="card">
      <view class="card-header">
        <text class="title">最近账单</text>
        <text class="more" @tap="goToBills">查看全部</text>
      </view>
      <view class="bill-list">
        <view class="bill-item" v-for="bill in recentBills" :key="bill.id">
          <view class="bill-info">
            <text class="bill-title">{{ bill.billType === 'RENT' ? '租金' : bill.billType === 'UTILITY' ? '水电费' : '其他' }}</text>
            <text class="bill-period">{{ bill.period }}</text>
          </view>
          <view class="bill-right">
            <text class="bill-amount">¥{{ (bill.amount / 100).toFixed(2) }}</text>
            <text :class="['bill-status', getBillStatusClass(bill.status)]">
              {{ getBillStatusText(bill.status) }}
            </text>
          </view>
        </view>
        <view class="empty" v-if="recentBills.length === 0">
          <text>暂无账单记录</text>
        </view>
      </view>
    </view>
  </view>
</template>

<script>
import { getUserInfo, getMyBills, getMyMaintenance } from '../../api/index.js'

export default {
  data() {
    return {
      userName: '',
      roomInfo: '',
      pendingBillsCount: 0,
      pendingMaintenanceCount: 0,
      recentBills: []
    }
  },
  onLoad() {
    this.loadData()
  },
  onShow() {
    // 每次显示页面时刷新数据
    this.loadData()
  },
  methods: {
    async loadData() {
      try {
        // 获取用户信息
        const userInfo = await getUserInfo()
        this.userName = userInfo.tenant?.name || '租客'
        
        // 获取账单
        const billsRes = await getMyBills({ page: 1, limit: 5 })
        this.recentBills = billsRes.data || []
        this.pendingBillsCount = billsRes.data?.filter(b => b.status === 'PENDING').length || 0
        
        // 获取报修
        const maintenanceRes = await getMyMaintenance({ page: 1, limit: 10 })
        this.pendingMaintenanceCount = maintenanceRes.data?.filter(
          m => m.status !== 'COMPLETED' && m.status !== 'CANCELLED'
        ).length || 0
      } catch (error) {
        console.error('加载数据失败:', error)
      }
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
        OVERDUE: 'status-danger'
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
.header {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  padding: 40rpx 30rpx 60rpx;
  color: #fff;
}

.user-info {
  display: flex;
  align-items: center;
}

.avatar {
  width: 100rpx;
  height: 100rpx;
  border-radius: 50%;
  margin-right: 20rpx;
  background-color: #fff;
}

.info {
  display: flex;
  flex-direction: column;
}

.name {
  font-size: 36rpx;
  font-weight: bold;
  margin-bottom: 10rpx;
}

.room {
  font-size: 26rpx;
  opacity: 0.9;
}

.quick-menu {
  display: flex;
  background-color: #fff;
  margin: -40rpx 20rpx 20rpx;
  border-radius: 16rpx;
  padding: 40rpx 20rpx;
  box-shadow: 0 4rpx 20rpx rgba(0, 0, 0, 0.08);
}

.menu-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.menu-item .icon {
  width: 80rpx;
  height: 80rpx;
  margin-bottom: 16rpx;
}

.menu-item text {
  font-size: 26rpx;
  color: #333;
}

.card {
  background-color: #fff;
  margin: 0 20rpx 20rpx;
  border-radius: 16rpx;
  padding: 30rpx;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20rpx;
}

.title {
  font-size: 32rpx;
  font-weight: bold;
  color: #333;
}

.more {
  font-size: 26rpx;
  color: #888;
}

.todo-list, .bill-list {
  display: flex;
  flex-direction: column;
}

.todo-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 24rpx 0;
  border-bottom: 1rpx solid #f0f0f0;
}

.todo-item:last-child {
  border-bottom: none;
}

.todo-left {
  display: flex;
  align-items: center;
}

.todo-icon {
  font-size: 40rpx;
  margin-right: 20rpx;
}

.todo-text {
  font-size: 28rpx;
  color: #333;
}

.todo-action {
  font-size: 26rpx;
  color: #07c160;
}

.bill-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 24rpx 0;
  border-bottom: 1rpx solid #f0f0f0;
}

.bill-item:last-child {
  border-bottom: none;
}

.bill-info {
  display: flex;
  flex-direction: column;
}

.bill-title {
  font-size: 28rpx;
  color: #333;
  margin-bottom: 8rpx;
}

.bill-period {
  font-size: 24rpx;
  color: #888;
}

.bill-right {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
}

.bill-amount {
  font-size: 32rpx;
  font-weight: bold;
  color: #333;
  margin-bottom: 8rpx;
}

.bill-status {
  font-size: 24rpx;
  padding: 4rpx 12rpx;
  border-radius: 4rpx;
}

.status-warning {
  background-color: #fff3e0;
  color: #ff9800;
}

.status-success {
  background-color: #e8f5e9;
  color: #4caf50;
}

.status-danger {
  background-color: #ffebee;
  color: #f44336;
}

.empty {
  text-align: center;
  padding: 60rpx 0;
  color: #999;
  font-size: 26rpx;
}
</style>
