<template>
  <view class="q-page page-safe-bottom">
    <text class="q-eyebrow">BILL DETAILS / 费用明细</text>
    <text class="q-title">每一笔，清楚可见。</text>
    <text class="q-description">核对账单，生成单据发给房东即可快速识别核销。</text>

    <view v-if="blocked" class="q-surface q-empty" style="margin-top: 24rpx;">
      <text class="q-empty-title">功能已被暂停</text>
      <text>此功能已被暂停，如有需要请联系管理处。</text>
    </view>
    <view v-else-if="error" class="q-error" @tap="load">{{ error }} · 点此重试</view>

    <!-- 账单明细卡片 -->
    <view v-if="bill && !blocked" class="q-surface">
      <view class="bill-hero">
        <text class="bill-label">{{ bill.period }} · {{ typeLabel }}</text>
        <text class="q-money">¥ {{ ((bill.amount || 0) / 100).toFixed(2) }}</text>
        <text :class="['q-pill', { warn: bill.status !== 'PAID' }]">{{ statusLabel }}</text>
      </view>
      <view class="q-divider" />
      <view class="q-detail-row"><text>账单编号</text><text>{{ bill.billNumber }}</text></view>
      <view class="q-detail-row"><text>承租房源</text><text>{{ voucherData ? voucherData.fullRoomTitle : (bill.contract?.room?.roomNumber || '—') }}</text></view>
      <view class="q-detail-row"><text>承租租客</text><text>{{ voucherData ? voucherData.tenantName : '租客' }}</text></view>
      <view class="q-detail-row"><text>缴付日期</text><text>{{ bill.dueDate ? bill.dueDate.slice(0, 10) : '—' }}</text></view>
      <view class="q-detail-row"><text>已缴金额</text><text>¥ {{ ((bill.paidAmount || 0) / 100).toFixed(2) }}</text></view>
      <view class="q-detail-row"><text>待缴金额</text><text class="unpaid-highlight">¥ {{ voucherData ? voucherData.amountToPayYuan : '0.00' }}</text></view>
      <view class="q-detail-row"><text>金额大写</text><text class="chinese-uppercase">{{ voucherData ? voucherData.chineseUppercase : '零元整' }}</text></view>
    </view>

    <!-- 线下转账与缴费单据卡片 (核心功能) -->
    <view v-if="bill && !blocked" class="q-surface voucher-section">
      <view class="section-header">
        <text class="section-title">缴费单据与转账核销</text>
        <text class="section-subtitle">生成单据图片发给房东，房东在后台粘贴即可自动匹配入账</text>
      </view>

      <!-- 单据卡片视觉化预览 -->
      <view class="voucher-preview-box">
        <view class="voucher-preview-header">
          <text class="vp-tag">{{ bill.status === 'PAID' ? '已结清收据' : '待付款单据' }}</text>
          <text class="vp-no">#{{ bill.billNumber }}</text>
        </view>
        <view class="vp-amount-row">
          <text class="vp-symbol">¥</text>
          <text class="vp-number">{{ voucherData ? voucherData.amountToPayYuan : '0.00' }}</text>
          <text class="vp-unit">元</text>
        </view>
        <view class="vp-upper">{{ voucherData ? voucherData.chineseUppercase : '零元整' }}</view>

        <view class="vp-divider" />

        <view class="vp-contact-row" v-if="landlordContact.wechat">
          <text class="vp-label">收款微信：</text>
          <text class="vp-value vp-copyable" @tap="copyWechat">{{ landlordContact.wechat }} (点此复制)</text>
        </view>
        <view class="vp-contact-row" v-if="landlordContact.phone">
          <text class="vp-label">管家电话：</text>
          <text class="vp-value vp-phone" @tap="callLandlord">{{ landlordContact.formattedPhone || landlordContact.phone }} (拨打)</text>
        </view>
        <view class="vp-tip">⚡ 转账请备注：{{ voucherData ? voucherData.roomNumber : '' }} + {{ voucherData ? voucherData.tenantName : '' }}</view>
      </view>

      <!-- 操作按钮群 -->
      <view class="action-grid">
        <button class="q-btn-primary" :loading="generatingPoster" @tap="handleGeneratePoster">
          {{ generatingPoster ? '正在绘制单据图片…' : '📷 生成单据图片发给房东' }}
        </button>
        <view class="secondary-actions">
          <button class="q-btn-secondary" @tap="handleCopyText">
            📋 复制单据文本
          </button>
          <button class="q-btn-secondary" v-if="landlordContact.wechat" @tap="copyWechat">
            💬 复制房东微信
          </button>
        </view>
      </view>
    </view>

    <!-- 说明信息 -->
    <view v-if="bill && !blocked" class="q-surface payment-information">
      <text class="payment-heading">核销说明</text>
      <text class="q-description">转账后请将单据图片或文本发给房东微信。房东在管理后台粘贴后，系统将自动识别单据编号与金额完成核销，并生成正式电子收据。</text>
    </view>

    <!-- 单据图片生成与预览弹窗 (Modal) -->
    <view v-if="showPosterModal" class="poster-modal-mask" @tap="closePosterModal">
      <view class="poster-modal-card" @tap.stop>
        <view class="pm-header">
          <text class="pm-title">缴费单据图片已生成</text>
          <text class="pm-close" @tap="closePosterModal">×</text>
        </view>
        <scroll-view scroll-y class="pm-scroll">
          <image :src="posterFilePath" mode="widthFix" class="pm-image" show-menu-by-longpress />
        </scroll-view>
        <view class="pm-footer">
          <button class="q-btn-primary" @tap="handleSaveImage">💾 保存图片到手机相册</button>
          <text class="pm-hint">保存后微信发给房东即可；长按上方图片也可直接分享</text>
        </view>
      </view>
    </view>

    <!-- 离屏隐藏 Canvas（用于高分辨率渲染单据） -->
    <canvas
      canvas-id="voucherCanvas"
      id="voucherCanvas"
      class="hidden-canvas"
    />

    <view v-if="loading" class="q-empty">正在加载账单…</view>
    <button class="q-outline" @tap="back">返回我的账单</button>
  </view>
</template>

<script>
import { getBillDetail } from '../../api/index.js'
import { ensureTenantSession, hasCapability } from '../../utils/session.js'
import { getLandlordContact, copyToClipboard, makePhoneCall } from '../../utils/contact.js'
import {
  formatVoucherData,
  generateVoucherText,
  drawVoucherPoster,
  saveVoucherImage,
} from '../../utils/voucher.js'

export default {
  data() {
    return {
      id: '',
      bill: null,
      loading: false,
      error: '',
      blocked: false,
      generatingPoster: false,
      posterFilePath: '',
      showPosterModal: false,
    }
  },
  computed: {
    typeLabel() {
      return (
        { RENT: '房屋租金', UTILITY: '水电费用', DEPOSIT: '房屋押金', OTHER: '其他费用' }[
          this.bill?.billType
        ] || '账单'
      )
    },
    statusLabel() {
      return (
        {
          PENDING: '待缴费',
          PARTIAL: '部分缴纳',
          PAID: '已缴清',
          OVERDUE: '已逾期',
          CANCELLED: '已取消',
        }[this.bill?.status] || ''
      )
    },
    landlordContact() {
      if (!this.bill) return getLandlordContact()
      return getLandlordContact({}, [this.bill.contract])
    },
    voucherData() {
      if (!this.bill) return null
      return formatVoucherData(this.bill, this.landlordContact)
    },
  },
  onLoad(query) {
    this.id = query.id || ''
    this.load()
  },
  methods: {
    async load() {
      if (!this.id) {
        this.error = '缺少账单编号，请返回列表重新打开'
        return
      }
      this.loading = true
      this.error = ''
      try {
        if (!(await ensureTenantSession())) return
        if (!hasCapability('tenant.bill.read')) {
          this.blocked = true
          return
        }
        this.blocked = false
        this.bill = await getBillDetail(this.id)
      } catch (err) {
        if (err?.message === 'CAPABILITY_DENIED' || err?.statusCode === 403) {
          this.blocked = true
          this.error = ''
        } else {
          this.error = '账单详情未能加载'
        }
      } finally {
        this.loading = false
      }
    },
    async handleGeneratePoster() {
      if (!this.voucherData) return
      this.generatingPoster = true
      uni.showLoading({ title: '生成单据图片中…' })
      try {
        const filePath = await drawVoucherPoster('voucherCanvas', this.voucherData, this)
        this.posterFilePath = filePath
        this.showPosterModal = true
        // 自动尝试保存到相册
        saveVoucherImage(filePath).catch(() => {})
      } catch (err) {
        uni.showToast({ title: err?.message || '生成图片失败，请重试', icon: 'none' })
      } finally {
        this.generatingPoster = false
        uni.hideLoading()
      }
    },
    handleSaveImage() {
      if (!this.posterFilePath) return
      saveVoucherImage(this.posterFilePath)
    },
    handleCopyText() {
      if (!this.voucherData) return
      const text = generateVoucherText(this.voucherData)
      copyToClipboard(text, '单据摘要')
    },
    copyWechat() {
      if (!this.landlordContact?.wechat) return
      copyToClipboard(this.landlordContact.wechat, '房东微信号')
    },
    callLandlord() {
      if (!this.landlordContact?.phone) return
      makePhoneCall(this.landlordContact.phone)
    },
    closePosterModal() {
      this.showPosterModal = false
    },
    back() {
      uni.switchTab({ url: '/pages/bills/bills' })
    },
  },
}
</script>

<style scoped>
.bill-hero {
  text-align: center;
  padding: 14rpx 0 24rpx;
}
.bill-label {
  display: block;
  font-size: 24rpx;
  color: #817e76;
}
.bill-hero .q-money {
  display: block;
  font-size: 56rpx;
  margin: 28rpx 0;
}
.unpaid-highlight {
  color: #c04928;
  font-weight: 600;
}
.chinese-uppercase {
  color: #6a6459;
  font-size: 24rpx;
}
.payment-information {
  margin: 28rpx 0;
}
.payment-heading {
  font-size: 25rpx;
  font-weight: 550;
}
.payment-information .q-description {
  font-size: 23rpx;
  margin-bottom: 0;
  line-height: 1.6;
}
.q-outline {
  margin-top: 28rpx;
}

/* 凭单卡片区 */
.voucher-section {
  margin-top: 24rpx;
}
.section-header {
  margin-bottom: 20rpx;
}
.section-title {
  display: block;
  font-size: 28rpx;
  font-weight: 600;
  color: #272320;
}
.section-subtitle {
  display: block;
  font-size: 22rpx;
  color: #878177;
  margin-top: 6rpx;
}
.voucher-preview-box {
  background: #fbf9f5;
  border: 2rpx dashed #dcd5c9;
  border-radius: 16rpx;
  padding: 24rpx;
  margin-bottom: 24rpx;
}
.voucher-preview-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.vp-tag {
  background: #2b2723;
  color: #f7f4ed;
  font-size: 20rpx;
  padding: 4rpx 14rpx;
  border-radius: 6rpx;
  letter-spacing: 1rpx;
}
.vp-no {
  font-size: 22rpx;
  color: #8a8377;
  font-family: monospace;
}
.vp-amount-row {
  display: flex;
  align-items: baseline;
  justify-content: center;
  margin: 20rpx 0 6rpx;
  color: #1f1c19;
}
.vp-symbol {
  font-size: 32rpx;
  font-weight: 600;
  margin-right: 8rpx;
}
.vp-number {
  font-size: 58rpx;
  font-weight: 700;
  letter-spacing: -1rpx;
}
.vp-unit {
  font-size: 24rpx;
  color: #7d766b;
  margin-left: 8rpx;
}
.vp-upper {
  text-align: center;
  font-size: 22rpx;
  color: #797165;
  margin-bottom: 16rpx;
}
.vp-divider {
  height: 1rpx;
  background: #eae4d8;
  margin: 16rpx 0;
}
.vp-contact-row {
  display: flex;
  align-items: center;
  font-size: 23rpx;
  margin-bottom: 10rpx;
}
.vp-label {
  color: #80786d;
}
.vp-value {
  color: #2c2824;
  font-weight: 550;
}
.vp-copyable {
  color: #9f7528;
  text-decoration: underline;
}
.vp-phone {
  color: #2b6cb0;
}
.vp-tip {
  font-size: 21rpx;
  color: #b78622;
  margin-top: 14rpx;
  background: #f8f3e5;
  padding: 8rpx 14rpx;
  border-radius: 8rpx;
}

/* 操作按钮 */
.action-grid {
  display: flex;
  flex-direction: column;
  gap: 16rpx;
}
.q-btn-primary {
  background: #2b2723;
  color: #f7f4ee;
  font-size: 28rpx;
  font-weight: 550;
  border-radius: 14rpx;
  padding: 22rpx 0;
  line-height: 1;
}
.secondary-actions {
  display: flex;
  gap: 16rpx;
}
.q-btn-secondary {
  flex: 1;
  background: #f1ede4;
  color: #3b3630;
  font-size: 24rpx;
  font-weight: 500;
  border-radius: 12rpx;
  padding: 18rpx 0;
  line-height: 1;
}

/* 离屏隐藏 Canvas */
.hidden-canvas {
  position: fixed;
  left: -9999px;
  top: -9999px;
  width: 640px;
  height: 980px;
  opacity: 0;
  pointer-events: none;
}

/* 海报弹窗 */
.poster-modal-mask {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.65);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 999;
  padding: 40rpx;
}
.poster-modal-card {
  width: 100%;
  max-width: 620rpx;
  background: #ffffff;
  border-radius: 24rpx;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  max-height: 85vh;
}
.pm-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 24rpx 32rpx;
  border-bottom: 1rpx solid #f0ece3;
}
.pm-title {
  font-size: 28rpx;
  font-weight: 600;
  color: #272421;
}
.pm-close {
  font-size: 40rpx;
  color: #8c867c;
  line-height: 1;
  padding: 4rpx 10rpx;
}
.pm-scroll {
  padding: 24rpx 32rpx;
  max-height: 58vh;
  box-sizing: border-box;
}
.pm-image {
  width: 100%;
  border-radius: 16rpx;
  box-shadow: 0 4rpx 20rpx rgba(0, 0, 0, 0.08);
}
.pm-footer {
  padding: 24rpx 32rpx 32rpx;
  background: #faf8f5;
  border-top: 1rpx solid #f0ece3;
}
.pm-hint {
  display: block;
  text-align: center;
  font-size: 21rpx;
  color: #8c867c;
  margin-top: 14rpx;
}
</style>
