<template>
  <view class="page q-page page-safe-bottom">
    <text class="q-eyebrow">MY BALANCE / 预付账户</text><text class="q-title">收支清楚，生活从容。</text><text class="q-description">余额与每笔流水，随时可以核对。</text>
    <view v-if="blocked" class="q-surface q-empty"><text class="q-empty-title">功能已被暂停</text><text>此功能已被暂停，如有需要请联系管理处。</text></view>
    <view v-else-if="error" class="q-error" @tap="loadData">{{ error }} · 点此重试</view>
    <view v-if="noAccount && !blocked" class="q-surface q-empty"><text class="q-empty-title">尚未开通预付账户</text><text>请联系管理者开通账户；开通后可在这里核对余额与流水。</text></view>
    <view v-if="loading" class="q-skeleton" aria-label="正在加载账户"><view/><view/><view/></view>
    <view class="balance-card" v-if="loaded && !blocked">
      <view class="balance-header">
        <text class="title">账户余额</text>
      </view>
      <view class="balance-body">
        <text class="amount">¥{{ (balance / 100).toFixed(2) }}</text>
        <button class="btn-recharge" size="mini" @tap="recharge">充值</button>
      </view>
    </view>

    <view class="transaction-list" v-if="loaded && !blocked">
      <view class="list-header">
        <text class="title">账户流水</text>
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
import { ensureTenantSession, hasCapability } from '../../utils/session.js'
import { money } from '../../utils/format.js'

export default {
  data() {
    return {
      balance: 0,
      loaded: false,
      noAccount: false,
      loading: false,
      error: '',
      blocked: false,
      transactions: []
    }
  },
  onLoad() {
    this.loadData()
  },
  methods: {
    money,
    async loadData() {
      this.loading=true;this.error='';this.noAccount=false;
      try {
        if (!await ensureTenantSession()) return
        if (!hasCapability('tenant.prepay.read')) {
          this.blocked = true
          return
        }
        this.blocked = false
        const accountRes = await getMyAccount()
        this.balance = accountRes.balanceCache || 0

        const transactionsRes = await getRechargeRecords({ page: 1, limit: 50 })
        this.transactions = transactionsRes.data || []
        this.loaded=true
      } catch (error) {
        if (error?.message === 'CAPABILITY_DENIED' || error?.statusCode === 403) {
          this.blocked = true
          this.error = ''
        } else if (error.statusCode === 404) {
          this.noAccount = true
          this.loaded = false
        } else {
          this.error = '账户信息未能加载，请检查连接后重试'
        }
      } finally {
        this.loading=false
      }
    },
    recharge() {
      uni.showToast({
        title: '请联系管理者办理充值',
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
  background-color: #f5f2ec;
}

.balance-card {
  background: #68715b;
  margin: 0 0 28rpx;
  border-radius: 36rpx;
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
  background-color: #fffefa;
  margin: 0;
  border-radius: 36rpx;
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
  color: #68715b;
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
