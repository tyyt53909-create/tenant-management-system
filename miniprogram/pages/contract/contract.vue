<template>
  <view class="page page-safe-bottom">
    <view class="contract-card" v-if="contract">
      <view class="card-header">
        <text class="contract-number">{{ contract.contractNumber }}</text>
        <text :class="['contract-status', getStatusClass(contract.status)]">
          {{ getStatusText(contract.status) }}
        </text>
      </view>

      <view class="card-body">
        <view class="info-section">
          <text class="section-title">房间信息</text>
          <view class="info-item">
            <text class="label">房间号</text>
            <text class="value">{{ orDash(contract.room?.roomNumber) }}</text>
          </view>
          <view class="info-item">
            <text class="label">楼层</text>
            <text class="value">{{ withUnit(contract.room?.floor, '楼') }}</text>
          </view>
          <view class="info-item">
            <text class="label">面积</text>
            <text class="value">{{ withUnit(contract.room?.area, '㎡') }}</text>
          </view>
        </view>

        <view class="info-section">
          <text class="section-title">合同信息</text>
          <view class="info-item">
            <text class="label">开始日期</text>
            <text class="value">{{ formatDate(contract.startDate) }}</text>
          </view>
          <view class="info-item">
            <text class="label">结束日期</text>
            <text class="value">{{ formatDate(contract.endDate) }}</text>
          </view>
          <view class="info-item">
            <text class="label">租金</text>
            <text class="value price">{{ money(contract.rentAmount) }}/月</text>
          </view>
          <view class="info-item">
            <text class="label">押金</text>
            <text class="value">{{ money(contract.depositAmount) }}</text>
          </view>
          <view class="info-item">
            <text class="label">付款周期</text>
            <text class="value">{{ getPaymentCycleText(contract.paymentCycle) }}</text>
          </view>
          <view class="info-item">
            <text class="label">付款日</text>
            <text class="value">每月{{ contract.paymentDay }}号</text>
          </view>
        </view>
      </view>
    </view>

    <view class="empty" v-else>
      <text>暂无合同信息</text>
    </view>
  </view>
</template>

<script>
import { getMyContracts } from '../../api/index.js'
import { ensureTenantSession } from '../../utils/session.js'
import { orDash, withUnit, money } from '../../utils/format.js'

export default {
  data() {
    return {
      contract: null
    }
  },
  onLoad() {
    this.loadContract()
  },
  methods: {
    orDash,
    withUnit,
    money,
    async loadContract() {
      try {
        if (!await ensureTenantSession()) return
        const res = await getMyContracts()
        // 获取最新的活跃合同
        if (res.data && res.data.length > 0) {
          this.contract = res.data[0]
        }
      } catch (error) {
        console.error('加载合同失败:', error)
      }
    },
    getStatusText(status) {
      const map = {
        DRAFT: '草稿',
        ACTIVE: '生效中',
        EXPIRED: '已过期',
        TERMINATED: '已终止'
      }
      return map[status] || status
    },
    getStatusClass(status) {
      const map = {
        DRAFT: 'status-info',
        ACTIVE: 'status-success',
        EXPIRED: 'status-warning',
        TERMINATED: 'status-danger'
      }
      return map[status] || ''
    },
    getPaymentCycleText(cycle) {
      const map = {
        MONTHLY: '月付',
        QUARTERLY: '季付',
        SEMI_ANNUAL: '半年付',
        ANNUAL: '年付'
      }
      return map[cycle] || cycle
    },
    formatDate(dateStr) {
      if (!dateStr) return ''
      return dateStr.split('T')[0]
    }
  }
}
</script>

<style scoped>
.page {
  min-height: 100vh;
  background-color: #f5f5f5;
  padding: 20rpx;
}

.contract-card {
  background-color: #fff;
  border-radius: 16rpx;
  overflow: hidden;
}

.card-header {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  padding: 40rpx 30rpx;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.contract-number {
  font-size: 32rpx;
  font-weight: bold;
  color: #fff;
}

.contract-status {
  font-size: 24rpx;
  padding: 8rpx 20rpx;
  border-radius: 20rpx;
  background-color: rgba(255, 255, 255, 0.3);
  color: #fff;
}

.card-body {
  padding: 30rpx;
}

.info-section {
  margin-bottom: 40rpx;
}

.info-section:last-child {
  margin-bottom: 0;
}

.section-title {
  font-size: 28rpx;
  font-weight: bold;
  color: #333;
  margin-bottom: 24rpx;
  display: block;
}

.info-item {
  display: flex;
  justify-content: space-between;
  padding: 20rpx 0;
  border-bottom: 1rpx solid #f0f0f0;
}

.info-item:last-child {
  border-bottom: none;
}

.label {
  font-size: 28rpx;
  color: #888;
}

.value {
  font-size: 28rpx;
  color: #333;
}

.value.price {
  font-weight: bold;
  color: #f44336;
}

.empty {
  text-align: center;
  padding: 200rpx 0;
  color: #999;
  font-size: 26rpx;
}
</style>
