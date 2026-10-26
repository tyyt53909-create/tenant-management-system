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
        <view class="estimate-badge" v-if="estimatedDaysRemaining !== null && estimatedDaysRemaining !== undefined">
          <text>预计可用 {{ estimatedDaysRemaining }} 天</text>
        </view>
      </view>
      <view class="balance-body">
        <text class="amount">¥{{ (balance / 100).toFixed(2) }}</text>
        <button class="btn-recharge" size="mini" @tap="openRechargeModal">充值</button>
      </view>
      <view class="balance-footer" v-if="dailyAverageUsage">
        <text class="daily-hint">近 30 天日均消耗约 {{ money(dailyAverageUsage) }}</text>
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

    <!-- 充值抽屉 / 弹窗 (PAY-04 / T296) -->
    <view class="recharge-modal-mask" v-if="showRechargeModal" @tap="closeRechargeModal">
      <view class="recharge-modal-content" @tap.stop>
        <view class="modal-header">
          <text class="modal-title">预付金充值</text>
          <text class="modal-close" @tap="closeRechargeModal">✕</text>
        </view>
        <view class="tier-grid">
          <view
            v-for="tier in rechargeTiers"
            :key="tier.amount"
            :class="['tier-item', selectedTier === tier.amount ? 'tier-selected' : '']"
            @tap="selectTier(tier.amount)"
          >
            <text class="tier-amount">¥{{ tier.label }}</text>
          </view>
        </view>
        <view class="custom-amount-row">
          <text class="custom-label">其他金额(元)</text>
          <input
            class="custom-input"
            type="digit"
            placeholder="最低 1 元"
            v-model="customAmountYuan"
            @input="onCustomAmountInput"
          />
        </view>
        <button
          class="btn-submit-recharge"
          :loading="submittingRecharge"
          :disabled="submittingRecharge || payAmountFen <= 0"
          @tap="submitRecharge"
        >
          立即支付 ¥{{ (payAmountFen / 100).toFixed(2) }}
        </button>
      </view>
    </view>
  </view>
</template>

<script>
import { getMyAccount, getRechargeRecords, createPrepayJsapiPay, queryPrepayPay } from '../../api/index.js'
import { ensureTenantSession, hasCapability } from '../../utils/session.js'
import { money } from '../../utils/format.js'

export default {
  data() {
    return {
      balance: 0,
      dailyAverageUsage: null,
      estimatedDaysRemaining: null,
      loaded: false,
      noAccount: false,
      loading: false,
      error: '',
      blocked: false,
      transactions: [],
      showRechargeModal: false,
      rechargeTiers: [
        { label: '50', amount: 5000 },
        { label: '100', amount: 10000 },
        { label: '200', amount: 20000 },
        { label: '500', amount: 50000 },
      ],
      selectedTier: 10000,
      customAmountYuan: '',
      submittingRecharge: false,
    }
  },
  computed: {
    payAmountFen() {
      if (this.customAmountYuan && !isNaN(Number(this.customAmountYuan))) {
        return Math.round(Number(this.customAmountYuan) * 100)
      }
      return this.selectedTier || 0
    },
  },
  onLoad() {
    this.loadData()
  },
  methods: {
    money,
    async loadData() {
      this.loading = true
      this.error = ''
      this.noAccount = false
      try {
        if (!await ensureTenantSession()) return
        if (!hasCapability('tenant.prepay.read')) {
          this.blocked = true
          return
        }
        this.blocked = false
        const accountRes = await getMyAccount()
        this.balance = accountRes.balanceCache || 0
        this.dailyAverageUsage = accountRes.dailyAverageUsage || null
        this.estimatedDaysRemaining = accountRes.estimatedDaysRemaining !== undefined ? accountRes.estimatedDaysRemaining : null

        const transactionsRes = await getRechargeRecords({ page: 1, limit: 50 })
        this.transactions = transactionsRes.data || []
        this.loaded = true
      } catch (error) {
        if (error?.code === 'CAPABILITY_DENIED' || error?.message === 'CAPABILITY_DENIED' || error?.statusCode === 403) {
          this.blocked = true
          this.error = ''
        } else if (error.statusCode === 404) {
          this.noAccount = true
          this.loaded = false
        } else {
          this.error = '账户信息未能加载，请检查连接后重试'
        }
      } finally {
        this.loading = false
      }
    },
    openRechargeModal() {
      this.selectedTier = 10000
      this.customAmountYuan = ''
      this.showRechargeModal = true
    },
    closeRechargeModal() {
      this.showRechargeModal = false
    },
    selectTier(amount) {
      this.selectedTier = amount
      this.customAmountYuan = ''
    },
    onCustomAmountInput() {
      this.selectedTier = null
    },
    async submitRecharge() {
      const amount = this.payAmountFen
      if (amount < 100) {
        uni.showToast({ title: '充值金额最低为 1 元', icon: 'none' })
        return
      }

      this.submittingRecharge = true
      uni.showLoading({ title: '准备支付…' })
      try {
        const payParams = await createPrepayJsapiPay(amount)
        uni.hideLoading()

        await new Promise((resolve, reject) => {
          if (typeof uni === 'undefined' || !uni.requestPayment) {
            resolve({ mock: true })
            return
          }
          uni.requestPayment({
            provider: 'wxpay',
            timeStamp: String(payParams.timeStamp),
            nonceStr: payParams.nonceStr,
            package: payParams.package,
            signType: payParams.signType || 'RSA',
            paySign: payParams.paySign,
            success: resolve,
            fail: (err) => {
              if (err && (err.errMsg?.includes('cancel') || err.message?.includes('cancel'))) {
                reject(new Error('用户已取消支付'))
              } else {
                reject(err)
              }
            },
          })
        })

        if (payParams.outTradeNo) {
          uni.showLoading({ title: '确认入账…' })
          try {
            await queryPrepayPay(payParams.outTradeNo)
          } catch {
            // webhook 兜底
          }
          uni.hideLoading()
        }

        uni.showToast({ title: '充值完成！', icon: 'success' })
        this.closeRechargeModal()
        await this.loadData()
      } catch (err) {
        uni.hideLoading()
        uni.showToast({ title: err?.message || '充值未完成', icon: 'none' })
      } finally {
        this.submittingRecharge = false
      }
    },
    getTransactionTypeText(type) {
      const map = {
        RECHARGE: '充值',
        DEDUCTION: '扣费',
        REFUND: '退款',
        ADJUSTMENT: '调整',
      }
      return map[type] || type
    },
    formatDate(dateStr) {
      if (!dateStr) return ''
      return dateStr.replace('T', ' ').substring(0, 16)
    },
  },
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

.balance-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.balance-header .title {
  font-size: 26rpx;
  opacity: 0.9;
}

.estimate-badge {
  background: rgba(255, 255, 255, 0.2);
  padding: 6rpx 18rpx;
  border-radius: 20rpx;
  font-size: 22rpx;
  color: #f7f9f4;
}

.balance-body {
  margin-top: 24rpx;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.amount {
  font-size: 56rpx;
  font-weight: bold;
}

.balance-footer {
  margin-top: 18rpx;
  padding-top: 16rpx;
  border-top: 1rpx solid rgba(255, 255, 255, 0.15);
}

.daily-hint {
  font-size: 22rpx;
  color: rgba(255, 255, 255, 0.8);
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

/* 充值弹窗样式 (PAY-04 / T296) */
.recharge-modal-mask {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: flex-end;
  z-index: 999;
}

.recharge-modal-content {
  width: 100%;
  background-color: #fff;
  border-top-left-radius: 36rpx;
  border-top-right-radius: 36rpx;
  padding: 40rpx 32rpx calc(40rpx + env(safe-area-inset-bottom));
  box-sizing: border-box;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 32rpx;
}

.modal-title {
  font-size: 32rpx;
  font-weight: bold;
  color: #2c3327;
}

.modal-close {
  font-size: 32rpx;
  color: #999;
  padding: 8rpx 16rpx;
}

.tier-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16rpx;
  margin-bottom: 24rpx;
}

.tier-item {
  border: 2rpx solid #e2ddd3;
  border-radius: 20rpx;
  padding: 24rpx 0;
  text-align: center;
  background-color: #fbf9f5;
}

.tier-selected {
  border-color: #68715b;
  background-color: #f2f5ee;
}

.tier-amount {
  font-size: 28rpx;
  font-weight: bold;
  color: #2c3327;
}

.custom-amount-row {
  display: flex;
  align-items: center;
  background-color: #fbf9f5;
  border: 2rpx solid #e2ddd3;
  border-radius: 20rpx;
  padding: 16rpx 24rpx;
  margin-bottom: 32rpx;
}

.custom-label {
  font-size: 26rpx;
  color: #777;
  margin-right: 20rpx;
}

.custom-input {
  flex: 1;
  font-size: 30rpx;
  color: #2c3327;
}

.btn-submit-recharge {
  background-color: #68715b;
  color: #fff;
  border-radius: 28rpx;
  font-size: 30rpx;
  font-weight: bold;
  height: 88rpx;
  line-height: 88rpx;
}

.btn-submit-recharge[disabled] {
  opacity: 0.5;
}
</style>
