<template>
  <view class="q-page page-safe-bottom">
    <text class="q-eyebrow">BILL DETAILS / 费用明细</text>
    <text class="q-title">每一笔，清楚可见。</text>
    <text class="q-description">支持微信线上支付直缴；亦可生成转账单据发给管家自动核销。</text>

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

    <!-- 线上微信支付直缴卡片 (PAY-01 / LSE-05) -->
    <view v-if="bill && !blocked && isUnpaid" class="q-surface pay-online-section">
      <view class="section-header">
        <text class="section-title">⚡ 微信支付线上直缴</text>
        <text class="section-subtitle">支持微信零钱、信用卡与分付，实时到账自动开具防伪电子收据</text>
      </view>
      <button class="pay-btn-green" :loading="paying" @tap="handleWechatPay">
        {{ paying ? '正在拉起微信支付…' : `💳 微信支付直缴 ¥ ${voucherData ? voucherData.amountToPayYuan : '0.00'}` }}
      </button>
    </view>

    <!-- 官方电子收款收据卡片 (PAY-03 / LSE-05) -->
    <view v-if="bill && !blocked && hasPaid" class="q-surface receipt-section">
      <view class="section-header">
        <text class="section-title">📜 官方电子收款收据</text>
        <text class="section-subtitle">本账单已开具官方防伪收据凭证，支持在线验真与 PDF 下载保存</text>
      </view>
      <view class="receipt-actions-row">
        <button class="q-btn-primary" @tap="handleViewReceipt">
          📄 查看电子收据
        </button>
        <button class="q-btn-secondary" @tap="handleDownloadPdf">
          📥 下载 PDF 凭单
        </button>
      </view>
    </view>

    <!-- 线下转账与缴费单据卡片 (备选功能) -->
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

    <!-- 电子收据详情弹窗 (Modal) -->
    <view v-if="showReceiptModal" class="poster-modal-mask" @tap="closeReceiptModal">
      <view class="receipt-modal-card" @tap.stop>
        <view class="pm-header">
          <text class="pm-title">栖居房屋租赁 · 电子收款收据</text>
          <text class="pm-close" @tap="closeReceiptModal">×</text>
        </view>
        <scroll-view scroll-y class="receipt-scroll" v-if="receiptData">
          <view class="receipt-badge-row">
            <text class="receipt-official-seal">栖居官方凭证</text>
            <text class="receipt-verify-code">防伪校验码: {{ receiptData.verifyCode }}</text>
          </view>
          <view class="receipt-content-box">
            <view class="q-detail-row"><text>收据编号</text><text class="mono-text">{{ receiptData.receiptNumber }}</text></view>
            <view class="q-detail-row"><text>关联账单</text><text class="mono-text">{{ receiptData.billNumber }}</text></view>
            <view class="q-detail-row"><text>承租租客</text><text>{{ receiptData.tenantName }}</text></view>
            <view class="q-detail-row"><text>承租房源</text><text>{{ receiptData.buildingName }} {{ receiptData.roomNumber }}</text></view>
            <view class="q-detail-row"><text>缴款时间</text><text>{{ receiptData.paidAt ? receiptData.paidAt.slice(0, 19).replace('T', ' ') : '—' }}</text></view>
            <view class="q-detail-row"><text>金额合计</text><text class="receipt-money">¥ {{ receiptData.totalAmountYuan }}</text></view>
            <view class="q-detail-row"><text>大写金额</text><text class="chinese-uppercase">{{ receiptData.amountInChinese }}</text></view>
          </view>
          <view v-if="receiptData.payments && receiptData.payments.length" class="receipt-payments-block">
            <text class="receipt-sub-title">入账支付流水</text>
            <view v-for="p in receiptData.payments" :key="p.id" class="receipt-payment-item">
              <view class="rp-left">
                <text class="rp-method">{{ p.paymentMethodLabel || p.paymentMethod }}</text>
                <text class="rp-time">{{ p.paidAt ? p.paidAt.slice(0, 16).replace('T', ' ') : '' }}</text>
              </view>
              <view class="rp-right">
                <text class="rp-amount">¥ {{ p.amountYuan }}</text>
                <text v-if="p.status === 'VOIDED'" class="q-pill danger">已作废</text>
              </view>
            </view>
          </view>
        </scroll-view>
        <view class="pm-footer">
          <button class="q-btn-primary" @tap="handleDownloadPdf">📥 下载并保存收据 PDF</button>
        </view>
      </view>
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
import {
  getBillDetail,
  payBillWithWechatJsapi,
  queryWechatPaymentStatus,
  getBillReceipt,
  downloadBillReceiptPdf,
} from '../../api/index.js'
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
      paying: false,
      showReceiptModal: false,
      receiptData: null,
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
    isUnpaid() {
      if (!this.bill) return false
      const unpaid = Math.max(0, (this.bill.amount || 0) - (this.bill.paidAmount || 0))
      return unpaid > 0 && this.bill.status !== 'PAID' && this.bill.status !== 'CANCELLED'
    },
    hasPaid() {
      return (this.bill?.paidAmount || 0) > 0 || this.bill?.status === 'PAID'
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
        if (err?.code === 'CAPABILITY_DENIED' || err?.message === 'CAPABILITY_DENIED' || err?.statusCode === 403) {
          this.blocked = true
          this.error = ''
        } else {
          this.error = '账单详情未能加载'
        }
      } finally {
        this.loading = false
      }
    },
    async handleWechatPay() {
      if (this.paying || !this.bill) return
      const unpaid = Math.max(0, (this.bill.amount || 0) - (this.bill.paidAmount || 0))
      if (unpaid <= 0) {
        uni.showToast({ title: '账单已结清，无需重复支付', icon: 'none' })
        return
      }
      this.paying = true
      uni.showLoading({ title: '准备支付…' })
      try {
        const payParams = await payBillWithWechatJsapi(this.bill.id, { amount: unpaid })
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
            await queryWechatPaymentStatus(this.bill.id, { outTradeNo: payParams.outTradeNo })
          } catch (e) {
            // webhook 兜底
          }
          uni.hideLoading()
        }
        uni.showToast({ title: '支付完成！', icon: 'success' })
        await this.load()
      } catch (err) {
        uni.hideLoading()
        const msg = err?.message || '发起支付失败'
        uni.showToast({ title: msg, icon: 'none' })
      } finally {
        this.paying = false
      }
    },
    async handleViewReceipt() {
      if (!this.bill) return
      uni.showLoading({ title: '加载收据…' })
      try {
        this.receiptData = await getBillReceipt(this.bill.id)
        this.showReceiptModal = true
      } catch (err) {
        uni.showToast({ title: err?.message || '无法获取收据明细', icon: 'none' })
      } finally {
        uni.hideLoading()
      }
    },
    closeReceiptModal() {
      this.showReceiptModal = false
    },
    async handleDownloadPdf() {
      if (!this.bill) return
      uni.showLoading({ title: '正在导出 PDF…' })
      try {
        await downloadBillReceiptPdf(this.bill.id)
        uni.showToast({ title: '已打开电子收据', icon: 'success' })
      } catch (err) {
        uni.showToast({ title: err?.message || '下载收据失败', icon: 'none' })
      } finally {
        uni.hideLoading()
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
      } catch (err) {
        uni.showToast({ title: '单据生成失败，请重试', icon: 'none' })
      } finally {
        this.generatingPoster = false
        uni.hideLoading()
      }
    },
    handleCopyText() {
      if (!this.voucherData) return
      const text = generateVoucherText(this.voucherData)
      copyToClipboard(text, '单据文本已复制，可粘贴发给房东')
    },
    copyWechat() {
      if (this.landlordContact.wechat) {
        copyToClipboard(this.landlordContact.wechat, '房东微信已复制')
      }
    },
    callLandlord() {
      if (this.landlordContact.phone) {
        makePhoneCall(this.landlordContact.phone)
      }
    },
    closePosterModal() {
      this.showPosterModal = false
    },
    async handleSaveImage() {
      if (!this.posterFilePath) return
      await saveVoucherImage(this.posterFilePath)
    },
    back() {
      uni.navigateBack()
    },
  },
}
</script>

<style scoped>
.page-safe-bottom {
  padding-bottom: 80rpx;
}
.bill-hero {
  text-align: center;
  padding: 16rpx 0 24rpx;
}
.bill-label {
  font-size: 26rpx;
  color: #7d776d;
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

/* 微信支付直缴 */
.pay-online-section {
  margin-top: 24rpx;
  background: #f4fbf5;
  border: 1rpx solid #d2edd6;
}
.pay-btn-green {
  background: #07c160;
  color: #ffffff;
  font-size: 30rpx;
  font-weight: 600;
  border-radius: 14rpx;
  padding: 22rpx 0;
  line-height: 1;
  box-shadow: 0 4rpx 12rpx rgba(7, 193, 96, 0.2);
}

/* 官方电子收据卡片 */
.receipt-section {
  margin-top: 24rpx;
  background: #fbf9f5;
  border: 1rpx solid #e8e2d5;
}
.receipt-actions-row {
  display: flex;
  gap: 16rpx;
}
.receipt-actions-row .q-btn-primary,
.receipt-actions-row .q-btn-secondary {
  flex: 1;
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

/* 弹窗通用 */
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
.poster-modal-card,
.receipt-modal-card {
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
  padding: 24rpx 32rpx;
  border-top: 1rpx solid #f0ece3;
  display: flex;
  flex-direction: column;
  gap: 12rpx;
}
.pm-hint {
  font-size: 21rpx;
  color: #8c867c;
  text-align: center;
}

/* 电子收据弹窗特殊样式 */
.receipt-scroll {
  padding: 24rpx 32rpx;
  max-height: 60vh;
  box-sizing: border-box;
}
.receipt-badge-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20rpx;
}
.receipt-official-seal {
  background: #b24128;
  color: #fff;
  font-size: 20rpx;
  padding: 4rpx 12rpx;
  border-radius: 6rpx;
  font-weight: 600;
}
.receipt-verify-code {
  font-size: 20rpx;
  color: #7d766b;
  font-family: monospace;
}
.receipt-content-box {
  background: #fbf9f5;
  padding: 16rpx 20rpx;
  border-radius: 12rpx;
  margin-bottom: 20rpx;
}
.receipt-money {
  font-size: 30rpx;
  font-weight: 700;
  color: #272421;
}
.mono-text {
  font-family: monospace;
}
.receipt-sub-title {
  display: block;
  font-size: 24rpx;
  font-weight: 600;
  color: #3b3630;
  margin-bottom: 12rpx;
}
.receipt-payment-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12rpx 0;
  border-bottom: 1rpx solid #f1ece4;
}
.rp-left {
  display: flex;
  flex-direction: column;
}
.rp-method {
  font-size: 24rpx;
  color: #272421;
}
.rp-time {
  font-size: 20rpx;
  color: #8a8377;
}
.rp-right {
  display: flex;
  align-items: center;
  gap: 8rpx;
}
.rp-amount {
  font-size: 24rpx;
  font-weight: 600;
  color: #272421;
}
</style>
