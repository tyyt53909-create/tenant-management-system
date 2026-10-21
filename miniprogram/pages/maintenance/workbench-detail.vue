<template>
  <view class="q-page wb-detail-page">
    <view v-if="loading && !order" class="q-skeleton"><view /><view /><view /></view>

    <view v-else-if="error && !order" class="q-surface q-empty wb-error">
      <text class="q-empty-title">{{ error }}</text>
      <button class="q-outline wb-retry" @tap="load">重新加载</button>
    </view>

    <template v-else-if="order">
      <view class="wb-detail-head">
        <view class="wb-detail-heading">
          <text class="q-eyebrow">{{ order.buildingName }} · {{ order.roomNumber }}</text>
          <text class="q-title wb-detail-title">{{ order.title }}</text>
        </view>
        <text :class="['q-pill', order.status === 'PENDING_CONFIRM' ? 'warn' : order.status === 'COMPLETED' ? 'quiet' : '']">{{ statusLabel }}</text>
      </view>

      <view class="q-surface wb-summary">
        <view class="q-detail-row"><text>问题类别</text><text>{{ categoryLabel }}</text></view>
        <view class="q-detail-row"><text>紧急程度</text><text :class="{ 'wb-urgent': order.priority === 'URGENT' }">{{ priorityLabel }}</text></view>
        <view class="q-detail-row"><text>提交时间</text><text>{{ formatDate(order.createdAt) }}</text></view>
        <view class="q-detail-row"><text>工单状态</text><text>{{ statusLabel }}</text></view>
        <view v-if="order.assignedAt" class="q-detail-row"><text>接单时间</text><text>{{ formatDate(order.assignedAt) }}</text></view>
      </view>

      <view class="q-section-heading"><text>问题描述</text></view>
      <view class="q-surface"><text class="wb-description">{{ order.description }}</text></view>

      <view v-if="order.photos.length" class="q-section-heading"><text>现场照片</text><text class="q-link">{{ order.photos.length }} 张</text></view>
      <view v-if="order.photos.length" class="wb-photos">
        <image
          v-for="(photo, index) in order.photos"
          :key="photo.id"
          class="wb-photo"
          :src="photo.fileUrl"
          mode="aspectFill"
          @tap="previewPhoto(index)"
        />
      </view>

      <template v-if="order.resolution">
        <view class="q-section-heading"><text>处理结果</text></view>
        <view class="q-surface"><text class="wb-description">{{ order.resolution }}</text></view>
      </template>

      <view v-if="error" class="q-error wb-inline-error" @tap="load">{{ error }} · 点此重试</view>

      <template v-if="order.status === 'ASSIGNED'">
        <view class="q-surface wb-action-card">
          <text class="wb-action-title">{{ order.assignedTo ? '这是一张指派给你的工单' : '这张工单在公共池中' }}</text>
          <text class="wb-action-hint">接单后工单会进入「进行中」，其他维修人员将不再看到它。</text>
          <button class="q-primary" :loading="claiming" :disabled="claiming" @tap="confirmClaim">接单并开始处理</button>
        </view>
      </template>

      <template v-else-if="order.status === 'IN_PROGRESS'">
        <view class="q-section-heading"><text>填写处理结果</text></view>
        <view class="q-surface wb-form">
          <textarea
            v-model="resolution"
            class="wb-textarea"
            maxlength="2000"
            placeholder="写下处理过程、更换的配件、需要租客注意的事项…"
          />
          <text class="wb-count">{{ resolution.length }} / 2000</text>
          <button class="q-primary" :loading="submitting" :disabled="submitting" @tap="submitComplete">
            {{ submitting ? '正在提交…' : '提交处理结果' }}
          </button>
          <text class="wb-form-note">提交后工单进入「待确认」，租客确认后才算完成。</text>
        </view>
      </template>

      <view v-else-if="order.status === 'PENDING_CONFIRM'" class="q-surface wb-action-card wb-waiting">
        <text class="wb-action-title">已提交处理结果</text>
        <text class="wb-action-hint">等待租客确认完成。若租客反馈问题仍在，工单会回到「进行中」。</text>
      </view>

      <view v-else-if="order.status === 'COMPLETED'" class="q-surface wb-action-card wb-waiting">
        <text class="wb-action-title">工单已完成</text>
        <text class="wb-action-hint">处理结果已确认，这笔工单已归档。</text>
      </view>

      <text class="q-note">栖居 · 每一次上门，都有清楚的记录</text>
    </template>
  </view>
</template>

<script>
import { getUserInfo, getWorkbenchOrder, claimMaintenance, completeMaintenance } from '../../api/index.js'
import { openHome } from '../../utils/session.js'

export default {
  data() {
    return {
      id: '', order: null, loading: false, claiming: false, submitting: false,
      resolution: '', error: '',
    }
  },
  computed: {
    statusLabel() {
      return {
        ASSIGNED: this.order?.assignedTo ? '指派给我' : '公共池',
        IN_PROGRESS: '维修中', PENDING_CONFIRM: '待确认',
        COMPLETED: '已完成', CANCELLED: '已取消',
      }[this.order?.status] || this.order?.status || ''
    },
    categoryLabel() {
      return {
        PLUMBING: '水管', ELECTRICAL: '电路', APPLIANCE: '家电',
        FURNITURE: '家具', DOOR_WINDOW: '门窗', OTHER: '其他',
      }[this.order?.category] || this.order?.category || '—'
    },
    priorityLabel() {
      return { LOW: '低', NORMAL: '普通', URGENT: '紧急' }[this.order?.priority] || this.order?.priority || '—'
    },
  },
  onLoad(options) {
    this.id = options?.id ? decodeURIComponent(options.id) : ''
    this.load()
  },
  async onPullDownRefresh() {
    try { await this.load() } finally { uni.stopPullDownRefresh() }
  },
  methods: {
    async load() {
      if (this.loading) return
      if (!this.id) {
        this.error = '缺少工单编号'
        return
      }
      if (!uni.getStorageSync('access_token')) {
        uni.reLaunch({ url: '/pages/login/login' })
        return
      }
      this.loading = true
      this.error = ''
      try {
        const user = await getUserInfo()
        uni.setStorageSync('user_role', user.role)
        if (user.role !== 'MAINTENANCE') {
          openHome(user.role)
          return
        }
        const result = await getWorkbenchOrder(this.id)
        this.order = {
          id: result.id,
          title: result.title,
          description: result.description,
          category: result.category,
          priority: result.priority,
          status: result.status,
          assignedTo: result.assignedTo,
          assignedAt: result.assignedAt,
          resolution: result.resolution,
          createdAt: result.createdAt,
          roomNumber: result.room?.roomNumber || '未关联房源',
          buildingName: result.room?.building?.name || '未命名楼栋',
          photos: Array.isArray(result.photos) ? result.photos : [],
        }
        if (result.resolution && !this.resolution) this.resolution = result.resolution
      } catch (error) {
        this.error = error.statusCode === 404
          ? '工单不存在，或已被其他维修人员接单'
          : error.message || '工单详情未能加载'
      } finally {
        this.loading = false
      }
    },
    previewPhoto(index) {
      uni.previewImage({
        urls: this.order.photos.map(photo => photo.fileUrl),
        current: this.order.photos[index]?.fileUrl,
      })
    },
    async confirmClaim() {
      if (this.claiming) return
      const confirmed = await new Promise(resolve => uni.showModal({
        title: '接单',
        content: `确认承接「${this.order.title}」并开始处理？`,
        success: result => resolve(result.confirm),
        fail: () => resolve(false),
      }))
      if (!confirmed) return
      this.claiming = true
      this.error = ''
      try {
        await claimMaintenance(this.id)
        uni.showToast({ title: '已接单', icon: 'success' })
        await this.load()
      } catch (error) {
        if ([404, 409].includes(error.statusCode)) {
          this.error = '工单已被其他维修人员接单'
          await this.load()
        } else {
          this.error = error.message || '接单失败，请重试'
        }
      } finally {
        this.claiming = false
      }
    },
    async submitComplete() {
      if (this.submitting) return
      const resolution = this.resolution.trim()
      if (!resolution) {
        uni.showToast({ title: '请填写处理结果', icon: 'none' })
        return
      }
      this.submitting = true
      this.error = ''
      try {
        await completeMaintenance(this.id, { resolution })
        uni.showToast({ title: '已提交，等待确认', icon: 'success' })
        await this.load()
      } catch (error) {
        if ([404, 409].includes(error.statusCode)) {
          this.error = '工单状态已变化，请刷新后重试'
          await this.load()
        } else {
          this.error = error.message || '提交失败，请重试'
        }
      } finally {
        this.submitting = false
      }
    },
    formatDate(date) {
      return date?.replace('T', ' ').slice(0, 16) || '—'
    },
  },
}
</script>

<style scoped>
.wb-detail-page { padding-bottom: 80rpx; }
.wb-error { margin-top: 40rpx; }
.wb-retry { margin-top: 24rpx; }
.wb-detail-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 20rpx; margin-bottom: 30rpx; }
.wb-detail-heading { flex: 1; min-width: 0; }
.wb-detail-title { font-size: 42rpx; line-height: 1.4; }
.wb-summary { padding-top: 16rpx; padding-bottom: 16rpx; }
.wb-urgent { color: #c16f62; }
.wb-description { display: block; font-size: 25rpx; line-height: 1.9; color: #4f4b43; white-space: pre-wrap; overflow-wrap: anywhere; }
.wb-photos { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14rpx; }
.wb-photo { width: 100%; height: 210rpx; border-radius: 20rpx; background: #e9e5dc; }
.wb-action-card { margin-top: 36rpx; padding: 32rpx; }
.wb-action-title { display: block; font-size: 28rpx; font-weight: 550; }
.wb-action-hint { display: block; margin: 14rpx 0 26rpx; font-size: 23rpx; color: #817e76; line-height: 1.8; }
.wb-waiting .wb-action-hint { margin-bottom: 0; }
.wb-form { padding: 28rpx; }
.wb-textarea { box-sizing: border-box; width: 100%; min-height: 260rpx; padding: 24rpx; border: 1rpx solid #e3dfd5; border-radius: 20rpx; background: #fbf9f4; font-size: 24rpx; line-height: 1.8; color: #302f2a; }
.wb-count { display: block; margin-top: 10rpx; text-align: right; font-size: 19rpx; color: #a49f95; }
.wb-form .q-primary { margin-top: 26rpx; }
.wb-form-note { display: block; margin-top: 18rpx; font-size: 20rpx; color: #a49f95; line-height: 1.8; text-align: center; }
.wb-inline-error { margin-top: 28rpx; }
</style>
