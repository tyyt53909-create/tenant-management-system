<template>
  <view class="page">
    <view class="tabs">
      <view 
        :class="['tab-item', currentTab === 'all' ? 'active' : '']" 
        @tap="switchTab('all')"
      >
        全部
      </view>
      <view 
        :class="['tab-item', currentTab === 'pending' ? 'active' : '']" 
        @tap="switchTab('pending')"
      >
        待支付
      </view>
      <view 
        :class="['tab-item', currentTab === 'paid' ? 'active' : '']" 
        @tap="switchTab('paid')"
      >
        已支付
      </view>
    </view>

    <scroll-view 
      class="bill-list" 
      scroll-y 
      @scrolltolower="loadMore"
      :lower-threshold="50"
    >
      <view class="bill-item" v-for="bill in bills" :key="bill.id" @tap="viewDetail(bill)">
        <view class="bill-header">
          <text class="bill-type">{{ getBillTypeText(bill.billType) }}</text>
          <text :class="['bill-status', getBillStatusClass(bill.status)]">
            {{ getBillStatusText(bill.status) }}
          </text>
        </view>
        <view class="bill-body">
          <view class="bill-info">
            <text class="label">账单编号</text>
            <text class="value">{{ bill.billNumber }}</text>
          </view>
          <view class="bill-info">
            <text class="label">账期</text>
            <text class="value">{{ bill.period }}</text>
          </view>
          <view class="bill-info">
            <text class="label">到期日期</text>
            <text class="value">{{ formatDate(bill.dueDate) }}</text>
          </view>
        </view>
        <view class="bill-footer">
          <text class="amount-label">应付金额</text>
          <text class="amount">¥{{ (bill.amount / 100).toFixed(2) }}</text>
        </view>
        <view class="bill-actions" v-if="bill.status === 'PENDING'">
          <button class="btn-pay" size="mini" @tap.stop="payBill(bill)">立即支付</button>
        </view>
      </view>

      <view class="empty" v-if="bills.length === 0 && !loading">
        <text>暂无账单记录</text>
      </view>

      <view class="loading-more" v-if="loading">
        <text>加载中...</text>
      </view>
    </scroll-view>
  </view>
</template>

<script>
import { getMyBills } from '../../api/index.js'

export default {
  data() {
    return {
      currentTab: 'all',
      bills: [],
      page: 1,
      hasMore: true,
      loading: false
    }
  },
  onLoad() {
    this.loadBills()
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
    getBillTypeText(type) {
      const map = {
        RENT: '租金',
        UTILITY: '水电费',
        OTHER: '其他'
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
    viewDetail(bill) {
      // TODO: 跳转到账单详情页
      uni.showToast({
        title: '账单详情功能开发中',
        icon: 'none'
      })
    },
    payBill(bill) {
      uni.showModal({
        title: '确认支付',
        content: `确认支付 ¥${(bill.amount / 100).toFixed(2)} 吗？`,
        success: (res) => {
          if (res.confirm) {
            // TODO: 调用支付接口
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
.page {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background-color: #f5f5f5;
}

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
}

.bill-info .value {
  font-size: 26rpx;
  color: #333;
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
