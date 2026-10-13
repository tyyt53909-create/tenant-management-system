<template>
  <view class="page page-with-tabbar">
    <!-- 标签切换 -->
    <view class="tabs">
      <view 
        v-for="tab in tabList"
        :key="tab.key"
        :class="['tab-item', currentTab === tab.key ? 'active' : '']" 
        @tap="switchTab(tab.key)"
        hover-class="tab-hover"
      >
        <text class="tab-text">{{ tab.label }}</text>
        <view v-if="tab.count > 0" class="tab-badge">{{ tab.count }}</view>
      </view>
    </view>

    <!-- 账单列表 -->
    <scroll-view 
      class="bill-list" 
      scroll-y 
      @scrolltolower="loadMore"
      :lower-threshold="50"
    >
      <view 
        class="bill-item" 
        v-for="(bill, index) in bills" 
        :key="bill.id"
        :style="{ animationDelay: (index * 50) + 'ms' }"
        @tap="viewDetail(bill)"
        hover-class="bill-item-hover"
      >
        <!-- 账单头部 -->
        <view class="bill-header">
          <view class="bill-title-wrapper">
            <view class="bill-icon">{{ getBillIcon(bill.billType) }}</view>
            <view class="bill-title-content">
              <text class="bill-type">{{ getBillTypeText(bill.billType) }}</text>
              <text class="bill-number">{{ bill.billNumber }}</text>
            </view>
          </view>
          <view :class="['bill-status', getBillStatusClass(bill.status)]">
            {{ getBillStatusText(bill.status) }}
          </view>
        </view>

        <!-- 账单信息 -->
        <view class="bill-body">
          <view class="bill-info-row">
            <text class="label">账期</text>
            <text class="value">{{ bill.period }}</text>
          </view>
          <view class="bill-info-row">
            <text class="label">到期日期</text>
            <text class="value">{{ formatDate(bill.dueDate) }}</text>
          </view>
          <view class="bill-info-row" v-if="bill.status === 'OVERDUE'">
            <text class="label">逾期天数</text>
            <text class="value danger">{{ getOverdueDays(bill.dueDate) }} 天</text>
          </view>
        </view>

        <!-- 金额显示 -->
        <view class="bill-footer">
          <view class="amount-wrapper">
            <text class="amount-label">应付金额</text>
            <view class="amount-display">
              <text class="currency">¥</text>
              <text class="amount">{{ formatAmount(bill.amount) }}</text>
            </view>
          </view>
          
          <!-- 操作按钮 -->
          <button 
            v-if="bill.status === 'PENDING' || bill.status === 'OVERDUE'" 
            class="btn-pay" 
            size="mini" 
            @tap.stop="payBill(bill)"
            hover-class="btn-pay-hover"
          >
            立即支付
          </button>
        </view>
      </view>

      <!-- 空状态 -->
      <view class="empty-state" v-if="bills.length === 0 && !loading">
        <text class="empty-icon">📋</text>
        <text class="empty-title">暂无账单</text>
        <text class="empty-desc">{{ getEmptyDesc() }}</text>
      </view>

      <!-- 加载更多 -->
      <view class="loading-more" v-if="loading">
        <view class="loading-spinner"></view>
        <text>加载中...</text>
      </view>

      <!-- 没有更多 -->
      <view class="no-more" v-if="!hasMore && bills.length > 0">
        <text>没有更多了</text>
      </view>

      <!-- 底部间距 -->
      <view class="bottom-spacer"></view>
    </scroll-view>
  </view>
</template>

<script>
import { getMyBills } from '../../api/index.js'
import { ensureTenantSession } from '../../utils/session.js'

export default {
  data() {
    return {
      currentTab: 'all',
      bills: [],
      page: 1,
      hasMore: true,
      loading: false,
      pendingCount: 0,
      paidCount: 0
    }
  },
  computed: {
    tabList() {
      return [
        { key: 'all', label: '全部', count: 0 },
        { key: 'pending', label: '待支付', count: this.pendingCount },
        { key: 'paid', label: '已支付', count: 0 }
      ]
    }
  },
  onShow() {
    this.loadBills()
    this.loadCounts()
  },
  methods: {
    async loadBills(refresh = true) {
      if (this.loading) return
      
      if (refresh) {
        this.page = 1
        this.bills = []
        this.hasMore = true
      }

      this.loading = true
      try {
        if (!await ensureTenantSession()) return
        const params = {
          page: this.page,
          limit: 20
        }
        
        if (this.currentTab === 'pending') {
          params.status = 'PENDING'
        } else if (this.currentTab === 'paid') {
          params.status = 'PAID'
        }

        const res = await getMyBills(params)
        
        if (refresh) {
          this.bills = res.data || []
        } else {
          this.bills = [...this.bills, ...(res.data || [])]
        }
        
        this.hasMore = res.meta.page < res.meta.totalPages
      } catch (error) {
        console.error('加载账单失败:', error)
      } finally {
        this.loading = false
      }
    },
    async loadCounts() {
      try {
        const res = await getMyBills({ page: 1, limit: 1, status: 'PENDING' })
        this.pendingCount = res.meta.total || 0
      } catch (error) {
        console.error('加载待支付数量失败:', error)
      }
    },
    switchTab(tab) {
      if (this.currentTab === tab) return
      this.currentTab = tab
      this.loadBills(true)
    },
    loadMore() {
      if (!this.hasMore || this.loading) return
      this.page++
      this.loadBills(false)
    },
    getBillIcon(type) {
      const icons = {
        'RENT': '🏠',
        'UTILITY': '⚡',
        'DEPOSIT': '💎',
        'OTHER': '📄'
      }
      return icons[type] || '📄'
    },
    getBillTypeText(type) {
      const map = {
        RENT: '房屋租金',
        UTILITY: '水电费',
        DEPOSIT: '押金',
        OTHER: '其他费用'
      }
      return map[type] || type
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
    formatDate(dateStr) {
      if (!dateStr) return ''
      return dateStr.split('T')[0]
    },
    formatAmount(amount) {
      return (amount / 100).toFixed(2)
    },
    getOverdueDays(dueDate) {
      const due = new Date(dueDate)
      const now = new Date()
      const diff = Math.floor((now - due) / (1000 * 60 * 60 * 24))
      return diff > 0 ? diff : 0
    },
    getEmptyDesc() {
      const map = {
        'all': '还没有任何账单记录',
        'pending': '没有待支付的账单',
        'paid': '还没有支付过账单'
      }
      return map[this.currentTab] || ''
    },
    viewDetail(bill) {
      uni.showToast({
        title: '账单详情功能开发中',
        icon: 'none'
      })
    },
    payBill(bill) {
      uni.showModal({
        title: '确认支付',
        content: `确认支付 ¥${this.formatAmount(bill.amount)} 吗？`,
        confirmText: '确认',
        cancelText: '取消',
        success: (res) => {
          if (res.confirm) {
            uni.showToast({
              title: '支付功能开发中',
              icon: 'none'
            })
          }
        }
      })
    }
  }
}
</script>

<style scoped>
/* ==================== 页面基础 ==================== */
.page {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--color-bg-secondary);
}

/* ==================== 标签栏 ==================== */
.tabs {
  display: flex;
  background: var(--color-bg-primary);
  padding: 12rpx 20rpx;
  box-shadow: var(--shadow-sm);
  position: relative;
  z-index: 2;
}

.tab-item {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8rpx;
  padding: 20rpx 0;
  position: relative;
  transition: all var(--duration-normal);
}

.tab-hover {
  opacity: 0.7;
}

.tab-text {
  font-size: 28rpx;
  color: var(--color-text-secondary);
  font-weight: 500;
  transition: all var(--duration-normal);
}

.tab-item.active .tab-text {
  color: var(--color-primary);
  font-weight: 650;
}

.tab-badge {
  min-width: 32rpx;
  height: 32rpx;
  line-height: 32rpx;
  padding: 0 8rpx;
  background: var(--color-error);
  color: #fff;
  border-radius: 16rpx;
  font-size: 20rpx;
  font-weight: 650;
  text-align: center;
}

.tab-item.active::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 50%;
  transform: translateX(-50%);
  width: 48rpx;
  height: 6rpx;
  background: var(--color-primary);
  border-radius: 3rpx;
  transition: all var(--duration-normal);
}

/* ==================== 账单列表 ==================== */
.bill-list {
  flex: 1;
  padding: 20rpx;
}

.bill-item {
  background: var(--color-bg-primary);
  border-radius: var(--radius-lg);
  padding: 30rpx;
  margin-bottom: 20rpx;
  box-shadow: var(--shadow-sm);
  opacity: 0;
  animation: slideInUp var(--duration-normal) ease-out forwards;
  transition: all var(--duration-fast);
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

.bill-item-hover {
  transform: scale(0.98);
  box-shadow: var(--shadow-md);
}

/* 账单头部 */
.bill-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 24rpx;
}

.bill-title-wrapper {
  display: flex;
  align-items: center;
  gap: 20rpx;
  flex: 1;
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
  flex-shrink: 0;
}

.bill-title-content {
  display: flex;
  flex-direction: column;
  gap: 6rpx;
  flex: 1;
  min-width: 0;
}

.bill-type {
  font-size: 30rpx;
  font-weight: 650;
  color: var(--color-text-primary);
}

.bill-number {
  font-size: 22rpx;
  color: var(--color-text-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bill-status {
  font-size: 22rpx;
  padding: 8rpx 16rpx;
  border-radius: var(--radius-sm);
  font-weight: 550;
  flex-shrink: 0;
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

/* 账单信息 */
.bill-body {
  display: flex;
  flex-direction: column;
  gap: 16rpx;
  margin-bottom: 24rpx;
  padding: 20rpx;
  background: var(--color-bg-tertiary);
  border-radius: var(--radius-md);
}

.bill-info-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.bill-info-row .label {
  font-size: 24rpx;
  color: var(--color-text-secondary);
}

.bill-info-row .value {
  font-size: 24rpx;
  color: var(--color-text-primary);
  font-weight: 550;
  text-align: right;
}

.bill-info-row .value.danger {
  color: var(--color-error);
  font-weight: 650;
}

/* 账单底部 */
.bill-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-top: 24rpx;
  border-top: 1rpx solid var(--color-border-light);
}

.amount-wrapper {
  display: flex;
  flex-direction: column;
  gap: 8rpx;
}

.amount-label {
  font-size: 22rpx;
  color: var(--color-text-tertiary);
}

.amount-display {
  display: flex;
  align-items: baseline;
  gap: 4rpx;
}

.currency {
  font-size: 24rpx;
  color: var(--color-text-primary);
  font-weight: 550;
}

.amount {
  font-size: 40rpx;
  font-weight: 720;
  color: var(--color-text-primary);
  letter-spacing: -0.5rpx;
}

.btn-pay {
  background: var(--color-primary);
  color: #fff;
  border: none;
  border-radius: var(--radius-md);
  padding: 16rpx 32rpx;
  font-size: 26rpx;
  font-weight: 550;
  transition: all var(--duration-fast);
}

.btn-pay-hover {
  opacity: 0.85;
  transform: scale(0.95);
}

/* ==================== 空状态 ==================== */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 120rpx 40rpx;
  gap: 16rpx;
}

.empty-icon {
  font-size: 96rpx;
  opacity: 0.5;
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

/* ==================== 加载状态 ==================== */
.loading-more {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16rpx;
  padding: 40rpx 0;
  color: var(--color-text-tertiary);
  font-size: 24rpx;
}

.loading-spinner {
  width: 32rpx;
  height: 32rpx;
  border: 4rpx solid var(--color-border);
  border-top-color: var(--color-primary);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.no-more {
  text-align: center;
  padding: 40rpx 0;
  color: var(--color-text-tertiary);
  font-size: 24rpx;
}

/* ==================== 底部间距 ==================== */
.bottom-spacer {
  height: var(--tabbar-space);
}
</style>

.tabs {
  display: flex;
  background-color: #fff;
  padding: 20rpx 0;
}

.tab-item {
  flex: 1;
  text-align: center;
  font-size: 28rpx;
  color: #666;
  padding: 20rpx 0;
  position: relative;
}

.tab-item.active {
  color: #07c160;
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
  background-color: #07c160;
  border-radius: 2rpx;
}

.bill-list {
  flex: 1;
  padding: 20rpx;
}

.bill-item {
  background-color: #fff;
  border-radius: 16rpx;
  padding: 30rpx;
  margin-bottom: 20rpx;
}

.bill-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20rpx;
}

.bill-type {
  font-size: 32rpx;
  font-weight: bold;
  color: #333;
}

.bill-status {
  font-size: 24rpx;
  padding: 6rpx 16rpx;
  border-radius: 8rpx;
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

.status-info {
  background-color: #e3f2fd;
  color: #2196f3;
}

.bill-body {
  margin-bottom: 20rpx;
}

.bill-info {
  display: flex;
  justify-content: space-between;
  margin-bottom: 16rpx;
}

.bill-info .label {
  font-size: 26rpx;
  color: #888;
  flex-shrink: 0;
}

.bill-info .value {
  font-size: 26rpx;
  color: #333;
  /* 长编号需要能收缩+断行，否则撑破卡片（T162） */
  min-width: 0;
  overflow-wrap: anywhere;
  word-break: break-all;
  text-align: right;
}

.bill-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-top: 20rpx;
  border-top: 1rpx solid #f0f0f0;
}

.amount-label {
  font-size: 26rpx;
  color: #888;
}

.amount {
  font-size: 36rpx;
  font-weight: bold;
  color: #f44336;
}

.bill-actions {
  margin-top: 20rpx;
  display: flex;
  justify-content: flex-end;
}

.btn-pay {
  background-color: #07c160;
  color: #fff;
  border: none;
}

.empty, .loading-more {
  text-align: center;
  padding: 80rpx 0;
  color: #999;
  font-size: 26rpx;
}
</style>
