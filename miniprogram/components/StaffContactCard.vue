<template>
  <view v-if="contact" class="q-surface contact-card">
    <view class="contact-head">
      <view>
        <text class="contact-eyebrow">需要协助？</text>
        <text class="contact-title">{{ contact.name }} · {{ contact.buildingName || '管理处' }}</text>
      </view>
      <text v-if="contact.phone" class="contact-call" @tap="call">拨打电话</text>
    </view>
    <view v-if="contact.phone" class="contact-row">
      <text>{{ contact.phone }}</text>
      <text class="contact-action" @tap="copy(contact.phone, '电话')">复制</text>
    </view>
    <view v-if="contact.wechat" class="contact-row">
      <text>微信 {{ contact.wechat }}</text>
      <text class="contact-action" @tap="copy(contact.wechat, '微信号')">复制</text>
    </view>
    <text v-if="contact.notice" class="contact-note">{{ contact.notice }}</text>
  </view>
</template>

<script>
import { getStaffContact } from '../api/index.js'
import { copyToClipboard } from '../utils/contact.js'

export default {
  data() {
    return { contact: null }
  },
  mounted() {
    this.load()
  },
  methods: {
    async load() {
      try {
        this.contact = await getStaffContact()
      } catch {
        // 联系方式加载失败不阻塞主流程
        this.contact = null
      }
    },
    call() {
      if (!this.contact?.phone) return
      uni.makePhoneCall({ phoneNumber: this.contact.phone })
    },
    copy(value, label) {
      copyToClipboard(value, label)
    },
  },
}
</script>

<style scoped>
.contact-card { margin-top: 30rpx; padding: 28rpx 30rpx; }
.contact-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 20rpx; }
.contact-eyebrow { display: block; font-size: 19rpx; color: #8e8a80; }
.contact-title { display: block; margin-top: 8rpx; font-size: 26rpx; font-weight: 550; }
.contact-call { flex-shrink: 0; padding: 10rpx 18rpx; border-radius: 14rpx; background: #ecf0e9; color: #4e5845; font-size: 21rpx; }
.contact-row { display: flex; align-items: center; justify-content: space-between; gap: 16rpx; margin-top: 18rpx; font-size: 22rpx; color: #716b60; }
.contact-action { padding: 6rpx 14rpx; border-radius: 10rpx; background: #f0ece3; color: #68715b; font-size: 19rpx; }
.contact-note { display: block; margin-top: 18rpx; padding-top: 18rpx; border-top: 1rpx solid #ece8df; font-size: 20rpx; line-height: 1.7; color: #8e8a80; }
</style>
