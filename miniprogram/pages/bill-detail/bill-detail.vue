<template>
  <view class="q-page page-safe-bottom">
    <text class="q-eyebrow">BILL DETAILS / 费用明细</text><text class="q-title">每一笔，清楚可见。</text><text class="q-description">核对账单，再安心安排缴付。</text>
    <view v-if="error" class="q-error" @tap="load">{{ error }} · 点此重试</view>
    <view v-if="bill" class="q-surface"><view class="bill-hero"><text class="bill-label">{{ bill.period }} · {{ typeLabel }}</text><text class="q-money">¥ {{ ((bill.amount || 0) / 100).toFixed(2) }}</text><text :class="['q-pill', { warn: bill.status !== 'PAID' }]">{{ statusLabel }}</text></view><view class="q-divider" /><view class="q-detail-row"><text>账单编号</text><text>{{ bill.billNumber }}</text></view><view class="q-detail-row"><text>房源</text><text>{{ bill.contract?.room?.roomNumber || '—' }}</text></view><view class="q-detail-row"><text>缴付日期</text><text>{{ bill.dueDate?.slice(0, 10) || '—' }}</text></view><view class="q-detail-row"><text>已缴金额</text><text>¥ {{ ((bill.paidAmount || 0) / 100).toFixed(2) }}</text></view><view class="q-detail-row"><text>账单未缴金额</text><text>¥ {{ (Math.max(0, (bill.amount || 0) - (bill.paidAmount || 0)) / 100).toFixed(2) }}</text></view></view>
    <view v-if="bill" class="q-surface payment-information"><text class="payment-heading">缴付说明</text><text class="q-description">线上支付暂未开通，请联系管理者完成缴付。实际收款状态由管理者登记，以最新账单记录为准；如有滞纳金，请向管理者核对结算金额。</text></view>
    <view v-if="loading" class="q-empty">正在加载账单…</view><button class="q-outline" @tap="back">返回我的账单</button>
  </view>
</template>
<script>
import { getBillDetail } from '../../api/index.js'
import { ensureTenantSession } from '../../utils/session.js'
export default {
  data() { return { id: '', bill: null, loading: false, error: '' } },
  computed: { typeLabel() { return { RENT: '房屋租金', UTILITY: '水电费用', OTHER: '其他费用' }[this.bill?.billType] || '账单' }, statusLabel() { return { PENDING: '待缴费', PARTIAL: '部分缴纳', PAID: '已缴清', OVERDUE: '已逾期', CANCELLED: '已取消' }[this.bill?.status] || '' } },
  onLoad(query) { this.id = query.id || ''; this.load() },
  methods: { async load() { if (!this.id) { this.error = '缺少账单编号，请返回列表重新打开'; return }; this.loading = true; this.error = ''; try { if (!await ensureTenantSession()) return; this.bill = await getBillDetail(this.id) } catch { this.error = '账单详情未能加载' } finally { this.loading = false } }, back() { uni.switchTab({ url: '/pages/bills/bills' }) } }
}
</script>
<style scoped>.bill-hero{text-align:center;padding:14rpx 0 24rpx}.bill-label{display:block;font-size:24rpx;color:#817e76}.bill-hero .q-money{display:block;font-size:56rpx;margin:28rpx 0}.payment-information{margin:28rpx 0}.payment-heading{font-size:25rpx;font-weight:550}.payment-information .q-description{font-size:23rpx;margin-bottom:0}.q-outline{margin-top:28rpx}</style>
