<template>
  <view class="page q-page page-safe-bottom">
    <text class="q-eyebrow">MY CONTRACT / 我的合同</text><text class="q-title">安心居住，有约在先。</text><text class="q-description">每一个关于居所的约定，都清楚留存。</text>
    <view v-if="blocked" class="q-surface q-empty" style="margin-top: 24rpx;">
      <text class="q-empty-title">功能已被暂停</text>
      <text>此功能已被暂停，如有需要请联系管理处。</text>
    </view>
    <view v-else-if="error" class="q-error" @tap="loadContract">{{ error }} · 点此重试</view>
    <view v-if="loading" class="q-skeleton" aria-label="正在加载合同"><view/><view/><view/></view>
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

        <view class="info-section">
          <text class="section-title">房东 / 管理方联系方式</text>
          <view class="info-item">
            <text class="label">联系人</text>
            <text class="value">{{ landlordContact.name }}</text>
          </view>
          <view class="info-item">
            <text class="label">微信号</text>
            <view class="contact-inline-action">
              <text class="value selectable" :selectable="true">{{ landlordContact.wechat }}</text>
              <button class="contract-pill-btn wechat-pill" @tap="copyWechat">复制微信</button>
            </view>
          </view>
          <view class="info-item">
            <text class="label">联系电话</text>
            <view class="contact-inline-action">
              <text class="value selectable" :selectable="true">{{ landlordContact.formattedPhone || landlordContact.phone }}</text>
              <button class="contract-pill-btn call-pill" @tap="callPhone">拨打</button>
              <button class="contract-pill-btn copy-pill" @tap="copyPhone">复制</button>
            </view>
          </view>
          <view class="info-item" v-if="landlordContact.serviceHours">
            <text class="label">服务时间</text>
            <text class="value">{{ landlordContact.serviceHours }}</text>
          </view>
        </view>
      </view>
    </view>

    <view v-if="contract" class="contract-images q-surface">
      <view class="q-section-heading"><text>合同扫描图片</text><text class="q-link" @tap="loadAttachments">刷新</text></view>
      <view v-if="attachmentsLoading" class="q-empty">正在加载合同图片…</view>
      <view v-else-if="attachmentsError" class="q-error" @tap="loadAttachments">{{ attachmentsError }} · 点此重试</view>
      <view v-else-if="attachments.length" class="contract-images-grid"><view v-for="(item,index) in attachments" :key="item.id"><ProtectedPhoto :url="item.downloadUrl" mode="aspectFit" /><text class="contract-page-label">第 {{ index+1 }} 页 · {{ item.fileName }}</text></view></view>
      <view v-else class="q-empty">管理者尚未上传合同扫描图片。</view>
      <text v-if="attachments.length" class="q-note">点击图片可放大查看。仅展示与你的合同关联的文件。</text>
    </view>

    <view class="empty" v-else-if="!loading && !error">
      <text>暂无合同信息</text>
    </view>
  </view>
</template>

<script>
import { getMyContracts } from '../../api/index.js'
import { ensureTenantSession, hasCapability } from '../../utils/session.js'
import { orDash, withUnit, money } from '../../utils/format.js'
import request from '../../utils/request.js'
import ProtectedPhoto from '../../components/ProtectedPhoto.vue'
import { getLandlordContact, copyToClipboard, makePhoneCall } from '../../utils/contact.js'

export default {
  components: { ProtectedPhoto },
  data() {
    return {
      contract: null, loading:false, error:'', blocked:false, attachments:[],attachmentsLoading:false,attachmentsError:'', attachmentsGeneration:0
    }
  },
  computed: {
    landlordContact() {
      return getLandlordContact({}, this.contract ? [this.contract] : [])
    }
  },
  onLoad() {
    this.loadContract()
  },
  onUnload() { this.attachmentsGeneration++ },
  methods: {
    orDash,
    withUnit,
    money,
    copyWechat() {
      copyToClipboard(this.landlordContact.wechat, '微信号')
    },
    copyPhone() {
      copyToClipboard(this.landlordContact.phone, '电话号码')
    },
    callPhone() {
      makePhoneCall(this.landlordContact.phone)
    },
    async loadContract() {
      this.loading=true;this.error='';this.contract=null;this.attachments=[];this.attachmentsError='';this.attachmentsGeneration++;
      try {
        if (!await ensureTenantSession()) return
        if (!hasCapability('tenant.contract.read')) {
          this.blocked = true
          return
        }
        this.blocked = false
        const res = await getMyContracts()
        // 获取最新的活跃合同
        if (res.data && res.data.length > 0) {
          this.contract = res.data.find(item => item.status === 'ACTIVE') || res.data[0]
          await this.loadAttachments()
        }
      } catch (err) {
        if (err?.message === 'CAPABILITY_DENIED' || err?.statusCode === 403) {
          this.blocked = true
          this.error = ''
        } else {
          this.error='合同未能加载，请检查连接后重试'
        }
      } finally {
        this.loading=false
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
    async loadAttachments(){
      if(!this.contract)return;
      const current=++this.attachmentsGeneration;const id=this.contract.id;
      this.attachmentsLoading=true;this.attachmentsError='';
      try{
        const items=await request.get(`/contracts/${encodeURIComponent(id)}/attachments`)
        if(!Array.isArray(items))throw new Error('附件响应格式不正确')
        if(current===this.attachmentsGeneration && this.contract?.id===id)this.attachments=items
      }catch{if(current===this.attachmentsGeneration)this.attachmentsError='合同图片未能加载'}
      finally{if(current===this.attachmentsGeneration)this.attachmentsLoading=false}
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
.contract-images{margin-top:28rpx}.contract-images .q-section-heading{margin:0 0 26rpx}.contract-images-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:22rpx}.contract-page-label{display:block;font-size:21rpx;color:#716b60;line-height:1.8;margin-top:12rpx;overflow-wrap:anywhere}.contract-images-grid :deep(.photo-frame){aspect-ratio:3/4}
.page {
  min-height: 100vh;
  background-color: #f5f2ec;
  padding: 36rpx;
}

.contract-card {
  background-color: #fffefa;
  border: 1rpx solid #e9e6de;
  border-radius: 36rpx;
  overflow: hidden;
}

.card-header {
  background: #ecf0e9;
  padding: 40rpx 30rpx;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.contract-number {
  font-size: 32rpx;
  font-weight: bold;
  color: #4e5845;
}

.contract-status {
  font-size: 24rpx;
  padding: 8rpx 20rpx;
  border-radius: 20rpx;
  background-color: #fffefa;
  color: #68715b;
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
  color: #68715b;
}

.empty {
  text-align: center;
  padding: 200rpx 0;
  color: #999;
  font-size: 26rpx;
}

.contact-inline-action {
  display: flex;
  align-items: center;
  gap: 12rpx;
}

.contract-pill-btn {
  font-size: 20rpx;
  font-weight: 550;
  height: 48rpx;
  line-height: 48rpx;
  padding: 0 16rpx;
  border-radius: 12rpx;
  border: none;
  margin: 0;
}

.contract-pill-btn::after {
  border: none;
}

.wechat-pill {
  background: #2e7d32;
  color: #ffffff;
}

.call-pill {
  background: #515c43;
  color: #ffffff;
}

.copy-pill {
  background: #ece8df;
  color: #68715b;
}
</style>
