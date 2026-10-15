<template>
  <view class="q-page bill-page">
    <text class="q-eyebrow">BILLS / 我的账单</text><text class="q-title">收支有数，生活有序。</text><text class="q-description">每一笔费用，都有清楚的记录。</text>
    <view v-if="blocked" class="q-surface q-empty" style="margin-top: 36rpx;">
      <text class="q-empty-title">功能已被暂停</text>
      <text>此功能已被暂停，如有需要请联系管理处。</text>
    </view>
    <template v-else>
      <view class="q-tabs"><view v-for="tab in tabs" :key="tab.key" :class="['q-tab', { active: currentTab === tab.key }]" @tap="switchTab(tab.key)">{{ tab.label }}</view></view>
      <scroll-view class="bill-scroll" scroll-y @scrolltolower="loadMore" :lower-threshold="50">
        <view v-for="bill in bills" :key="bill.id" class="bill-card q-surface" @tap="viewDetail(bill)"><view class="bill-header"><text>{{ bill.period }} · {{ getBillTypeText(bill.billType) }}</text><text :class="['q-pill', { warn: ['PENDING', 'PARTIAL'].includes(bill.status), danger: bill.status === 'OVERDUE', quiet: bill.status === 'CANCELLED' }]">{{ getBillStatusText(bill.status) }}</text></view><view class="bill-amount"><text class="currency">¥ </text><text>{{ (bill.amount / 100).toFixed(2) }}</text></view><view class="bill-meta"><text>缴付日 {{ formatDate(bill.dueDate) }}</text><text>查看详情 ›</text></view></view>
        <view v-if="error" class="q-error" @tap="loadBills(true)">{{ error }} · 点此重试</view><view v-if="!bills.length && !loading && !error" class="q-surface q-empty"><text class="q-empty-title">目前没有这类账单</text><text>账单生成后，你可以在这里查看明细。</text></view><text class="q-note">{{ loading ? '正在加载账单…' : hasMore ? '上滑查看更多' : bills.length ? '已显示全部账单' : '' }}</text>
        <text class="q-note payment-note">线上支付暂未开通，请联系管理者缴付。</text>
      </scroll-view>
    </template>
  </view>
</template>
<script>
import { getMyBills } from '../../api/index.js'
import { ensureTenantSession, hasCapability } from '../../utils/session.js'
export default {
  data() { return { currentTab: 'all', tabs: [{ key: 'all', label: '全部' }, { key: 'pending', label: '待缴费' }, { key: 'paid', label: '已缴清' }], bills: [], page: 1, hasMore: true, loading: false, error: '', blocked: false } },
  onShow() { this.loadBills() },
  methods: {
    async loadBills(refresh = true) {
      if (this.loading) return
      if (refresh) { this.page = 1; this.bills = []; this.hasMore = true }
      this.loading = true; this.error = ''
      try {
        if (!await ensureTenantSession()) return
        if (!hasCapability('tenant.bill.read')) {
          this.blocked = true
          return
        }
        this.blocked = false
        const params = { page: this.page, limit: 20 }
        if (this.currentTab === 'paid') params.status = 'PAID'
        const results = this.currentTab === 'pending'
          ? await Promise.all(['PENDING','PARTIAL','OVERDUE'].map(status => getMyBills({ ...params, status })))
          : [await getMyBills(params)]
        const records = results.flatMap(res => res.data || []).sort((a,b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
        this.bills = refresh ? records : [...this.bills, ...records.filter(item => !this.bills.some(old => old.id === item.id))]
        this.hasMore = results.some(res => res.meta.page < res.meta.totalPages)
      } catch (err) {
        if (err?.message === 'CAPABILITY_DENIED' || err?.statusCode === 403) {
          this.blocked = true
          this.error = ''
        } else {
          this.error = '账单未能加载，请稍后重试'
          if (!refresh) this.page--
        }
      } finally { this.loading = false }
    },
    switchTab(tab) { if (this.loading || this.currentTab === tab) return; this.currentTab = tab; this.loadBills(true) },
    loadMore() { if (this.hasMore && !this.loading) { this.page++; this.loadBills(false) } },
    getBillTypeText(type) { return { RENT: '租金', UTILITY: '水电费', OTHER: '其他费用' }[type] || type },
    getBillStatusText(status) { return { PENDING: '待缴费', PARTIAL: '部分缴纳', PAID: '已缴清', OVERDUE: '已逾期', CANCELLED: '已取消' }[status] || status },
    formatDate(date) { return date?.slice(0, 10) || '—' },
    viewDetail(bill) { uni.navigateTo({ url: `/pages/bill-detail/bill-detail?id=${encodeURIComponent(bill.id)}` }) },
  }
}
</script>
<style scoped>
.bill-page{display:flex;flex-direction:column;height:calc(100vh - var(--window-top, 0px));min-height:0;padding-bottom:0}.q-description{margin-bottom:0}.q-tabs{flex-shrink:0}.bill-scroll{flex:1;min-height:0;height:0;padding-bottom:var(--tabbar-space)}.bill-card{margin-bottom:24rpx}.bill-header{display:flex;align-items:center;justify-content:space-between;gap:16rpx;font-size:24rpx;font-weight:550}.bill-amount{margin:28rpx 0;font-size:48rpx;letter-spacing:-1rpx;font-weight:550;font-variant-numeric:tabular-nums}.currency{font-size:26rpx;letter-spacing:0;color:#817e76}.bill-meta{display:flex;justify-content:space-between;gap:12rpx;color:#a49f95;font-size:21rpx;padding-top:20rpx;border-top:1rpx solid #e9e6de}.payment-note{margin-bottom:30rpx}
</style>
