<template>
  <view class="page page-safe-bottom">
    <view class="balance-card">
      <view class="balance-header">
        <text class="title">账户余额</text>
      </view>
      <view class="balance-body">
        <text class="amount">¥{{ (balance / 100).toFixed(2) }}</text>
        <button class="btn-recharge" size="mini" @tap="recharge">充值</button>
      </view>
    </view>

    <view class="transaction-list">
      <view class="list-header">
        <text class="title">充值记录</text>
      </view>
      <view class="transaction-item" v-for="item in transactions" :key="item.id">
        <view class="item-left">
          <text class="type">{{ getTransactionTypeText(item.type) }}</text>
          <text class="time">{{ formatDate(item.createdAt) }}</text>
        </view>
        <view class="item-right">
          <text :class="['amount', item.amount >= 0 ? 'income' : 'expense']">
            <!-- amount 本身带符号（扣费为负），正数补 + 号即可，
                 不能再拼 '-'，否则负数会渲染成 -¥150.00 -->
            {{ item.amount >= 0 ? '+' : '' }}{{ money(item.amount) }}
          </text>
        </view>
      </view>
      <view class="empty" v-if="transactions.length === 0">
        <text class="empty-title">暂无交易记录</text>
        <text class="empty-hint">充值或水电扣费后，这里会显示每笔明细</text>
      </view>
    </view>
  </view>
</template>

<script>
import { getMyAccount, getRechargeRecords } from '../../api/index.js'
import { ensureTenantSession } from '../../utils/session.js'
import { money } from '../../utils/format.js'

export default {
  data() {
    return {
      balance: 0,
      transactions: []
    }
  },
  onLoad() {
    this.loadData()
  },
  methods: {
    money,
    async loadData() {
      try {
        if (!await ensureTenantSession()) return
        const accountRes = await getMyAccount()
        this.balance = accountRes.balanceCache || 0

        const transactionsRes = await getRechargeRecords({ page: 1, limit: 50 })
        this.transactions = transactionsRes.data || []
      } catch (error) {
        console.error('加载数据失败:', error)
      }
    },
    recharge() {
      uni.showToast({
        title: '充值功能开发中',
        icon: 'none'
      })
    },
    getTransactionTypeText(type) {
      const map = {
        RECHARGE: '充值',
        DEDUCTION: '扣费',
        REFUND: '退款',
        ADJUSTMENT: '调整'
      }
      return map[type] || type
    },
    formatDate(dateStr) {
      if (!dateStr) return ''
      return dateStr.replace('T', ' ').substring(0, 16)
    }
  }
}
</script>

<style scoped>
.page {
  min-height: 100vh;
  background-color: #f5f5f5;
}

.balance-card {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  margin: 20rpx;
  border-radius: 16rpx;
  padding: 40rpx 30rpx;
  color: #fff;
}

.balance-header .title {
  font-size: 26rpx;
  opacity: 0.9;
}

.balance-body {
  margin-top: 30rpx;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.amount {
  font-size: 56rpx;
  font-weight: bold;
}

.btn-recharge {
  background-color: rgba(255, 255, 255, 0.3);
  color: #fff;
  border: none;
}

.transaction-list {
  background-color: #fff;
  margin: 20rpx;
  border-radius: 16rpx;
  padding: 30rpx;
}

.list-header {
  margin-bottom: 20rpx;
}

.list-header .title {
  font-size: 28rpx;
  font-weight: bold;
  color: #333;
}

.transaction-item {
  display: flex;
  justify-content: space-between;
  padding: 24rpx 0;
  border-bottom: 1rpx solid #f0f0f0;
}

.transaction-item:last-child {
  border-bottom: none;
}

.item-left {
  display: flex;
  flex-direction: column;
}

.type {
  font-size: 28rpx;
  color: #333;
  margin-bottom: 8rpx;
}

.time {
  font-size: 24rpx;
  color: #888;
}

.item-right .amount {
  font-size: 32rpx;
  font-weight: bold;
}

.amount.income {
  color: #4caf50;
}

.amount.expense {
  color: #f44336;
}

.empty {
  text-align: center;
  padding: 80rpx 24rpx;
  color: #999;
  font-size: 26rpx;
}

.empty-title {
  display: block;
  margin-bottom: 12rpx;
}

.empty-hint {
  display: block;
  font-size: 24rpx;
  color: #bbb;
  line-height: 1.6;
}
</style>
