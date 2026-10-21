<template>
  <view class="q-page report-page">
    <text class="q-eyebrow">REPORT / 上报问题</text>
    <text class="q-title">把现场问题留下来。</text>
    <text class="q-description">拍照、描述、提交，管理处会安排处理。</text>

    <view v-if="error" class="q-error">{{ error }}</view>

    <view class="q-surface room-card">
      <view class="room-number">{{ roomName || '未选择房间' }}</view>
      <view class="room-copy">
        <text class="room-building">{{ buildingName || '栖居' }}</text>
        <text class="room-hint">上报后会进入管理处工单列表</text>
      </view>
    </view>

    <view class="q-section-heading"><text>问题类别</text></view>
    <view class="category-grid">
      <view
        v-for="category in categoryOptions"
        :key="category.value"
        :class="['category-card', { selected: form.category === category.value }]"
        @tap="form.category = category.value"
      >
        <QIcon :name="category.icon" :size="40" />
        <text>{{ category.label }}</text>
      </view>
    </view>

    <text class="form-label">紧急程度</text>
    <view class="priority-row">
      <view
        v-for="priority in priorityOptions"
        :key="priority.value"
        :class="['priority-choice', { active: form.priority === priority.value }]"
        @tap="form.priority = priority.value"
      >
        <text>{{ priority.label }}</text>
        <text>{{ priority.hint }}</text>
      </view>
    </view>

    <text class="form-label">问题标题 <text class="required">*</text></text>
    <input v-model="form.title" class="q-input" maxlength="50" placeholder="例如：走廊灯不亮" />

    <text class="form-label">问题描述 <text class="required">*</text></text>
    <textarea v-model="form.description" class="q-textarea" maxlength="500" placeholder="问题在哪里？什么时候发现？对现场有什么影响？" />
    <text class="input-count">{{ form.description.length }} / 500</text>

    <text class="form-label">现场照片 <text class="optional">（可选，最多 9 张）</text></text>
    <view class="photos">
      <view v-for="(image, index) in form.images" :key="image" class="photo">
        <image :src="image" mode="aspectFill" />
        <view class="remove-photo" @tap="deleteImage(index)">×</view>
      </view>
      <view v-if="form.images.length < 9" class="add-photo" @tap="chooseImage">
        <text>＋</text>
        <text>添加照片</text>
      </view>
    </view>
    <text class="photo-note">提交时会上传照片，请勿包含证件或无关个人信息。</text>

    <button class="q-primary submit-button" :loading="submitting" :disabled="submitting || !roomId" @tap="submit">
      {{ submitting ? '正在提交…' : '提交上报' }}
    </button>
  </view>
</template>

<script>
import QIcon from '../../components/QIcon.vue'
import { createMaintenance, uploadMaintenancePhoto } from '../../api/index.js'
import { ensureSession, openHome } from '../../utils/session.js'

const emptyForm = () => ({
  title: '', description: '', category: 'PLUMBING', priority: 'NORMAL', images: [],
})

export default {
  components: { QIcon },
  data() {
    return {
      roomId: '', roomName: '', buildingName: '',
      form: emptyForm(), submitting: false, error: '',
      categoryOptions: [
        { value: 'PLUMBING', label: '水管', icon: 'droplet' },
        { value: 'ELECTRICAL', label: '电路', icon: 'lightning' },
        { value: 'APPLIANCE', label: '家电', icon: 'repair' },
        { value: 'FURNITURE', label: '家具', icon: 'chair' },
        { value: 'DOOR_WINDOW', label: '门窗', icon: 'door' },
        { value: 'OTHER', label: '其他', icon: 'grid' },
      ],
      priorityOptions: [
        { value: 'LOW', label: '不急', hint: '方便时处理' },
        { value: 'NORMAL', label: '普通', hint: '正常安排' },
        { value: 'URGENT', label: '紧急', hint: '影响使用' },
      ],
    }
  },
  onLoad(query) {
    this.roomId = query?.roomId ? decodeURIComponent(query.roomId) : ''
    this.roomName = query?.roomName ? decodeURIComponent(query.roomName) : ''
    this.buildingName = query?.buildingName ? decodeURIComponent(query.buildingName) : ''
    if (!this.roomId) this.error = '缺少房间信息，请从任务卡片进入上报'
  },
  methods: {
    chooseImage() {
      const remaining = 9 - this.form.images.length
      if (remaining <= 0) return
      uni.chooseImage({
        count: remaining,
        sizeType: ['compressed'],
        sourceType: ['album', 'camera'],
        success: res => {
          this.form.images = [...this.form.images, ...res.tempFilePaths].slice(0, 9)
        },
      })
    },
    deleteImage(index) {
      this.form.images.splice(index, 1)
    },
    async submit() {
      if (this.submitting || !this.roomId) return
      const title = this.form.title.trim()
      const description = this.form.description.trim()
      if (!title || !description) {
        uni.showToast({ title: '请填写标题和问题描述', icon: 'none' })
        return
      }
      this.submitting = true
      this.error = ''
      try {
        const user = await ensureSession()
        if (!user) return
        if (!['CLEANER', 'MAINTENANCE'].includes(user.role)) {
          openHome(user.role)
          return
        }
        const photos = []
        for (let index = 0; index < this.form.images.length; index++) {
          uni.showLoading({ title: `上传照片 ${index + 1}/${this.form.images.length}` })
          const uploaded = await uploadMaintenancePhoto(this.form.images[index])
          photos.push(uploaded.url)
        }
        const data = {
          roomId: this.roomId,
          title,
          description,
          category: this.form.category,
          priority: this.form.priority,
        }
        if (photos.length) data.photos = photos
        await createMaintenance(data)
        uni.hideLoading()
        uni.showToast({ title: '已提交，等待管理处处理', icon: 'success' })
        setTimeout(() => this.back(), 600)
      } catch (error) {
        uni.hideLoading()
        this.error = error.message || '提交失败，请稍后重试'
      } finally {
        this.submitting = false
      }
    },
    back() {
      const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : []
      if (pages.length > 1) uni.navigateBack()
      else uni.reLaunch({ url: '/pages/cleaning/cleaning' })
    },
  },
}
</script>

<style scoped>
.report-page { padding-bottom: 80rpx; }
.room-card { display: flex; align-items: center; gap: 24rpx; margin-bottom: 8rpx; }
.room-number { width: 112rpx; height: 112rpx; border-radius: 26rpx; background: #f0ece3; display: flex; align-items: center; justify-content: center; font-size: 35rpx; font-weight: 600; color: #4e5845; flex-shrink: 0; text-align: center; overflow-wrap: anywhere; }
.room-copy { flex: 1; min-width: 0; }
.room-building { display: block; font-size: 26rpx; font-weight: 550; }
.room-hint { display: block; margin-top: 10rpx; font-size: 20rpx; color: #8e8a80; line-height: 1.6; }
.category-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14rpx; }
.category-card { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12rpx; min-height: 128rpx; padding: 18rpx 8rpx; border: 2rpx solid #e9e6de; border-radius: 22rpx; background: #fffefa; font-size: 22rpx; }
.category-card.selected { border-color: #899079; background: #ecf0e9; }
.form-label { display: block; font-size: 25rpx; font-weight: 550; margin: 32rpx 0 18rpx; }
.required { color: #ad735a; }
.optional { font-size: 21rpx; color: #8e8a80; font-weight: 400; }
.q-input, .q-textarea { box-sizing: border-box; width: 100%; background: #fffefa; border: 1rpx solid #e9e6de; border-radius: 20rpx; padding: 24rpx; font-size: 24rpx; color: #302f2a; }
.q-input { height: 88rpx; }
.q-textarea { height: 240rpx; line-height: 1.8; }
.priority-row { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12rpx; }
.priority-choice { border: 1rpx solid #e0dcd2; background: #fffefa; border-radius: 20rpx; padding: 20rpx 10rpx; text-align: center; }
.priority-choice.active { border-color: #899079; background: #ecf0e9; }
.priority-choice > text { display: block; font-size: 23rpx; }
.priority-choice > text:last-child { font-size: 18rpx; color: #8e8a80; margin-top: 8rpx; }
.input-count { display: block; text-align: right; font-size: 19rpx; color: #8e8a80; margin-top: 10rpx; }
.photos { display: flex; flex-wrap: wrap; gap: 16rpx; }
.photo, .add-photo { width: 150rpx; height: 150rpx; border-radius: 20rpx; position: relative; }
.photo image { width: 100%; height: 100%; border-radius: 20rpx; }
.remove-photo { position: absolute; right: 4rpx; top: 4rpx; background: #302f2a; color: #fffefa; border-radius: 50%; width: 34rpx; height: 34rpx; line-height: 30rpx; text-align: center; font-size: 30rpx; }
.add-photo { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12rpx; background: #fffefa; border: 1rpx dashed #c9c5b8; color: #8e8a80; font-size: 21rpx; }
.add-photo > text:first-child { font-size: 36rpx; }
.photo-note { display: block; color: #8e8a80; font-size: 19rpx; line-height: 1.8; margin-top: 18rpx; }
.submit-button { margin-top: 36rpx; }
button[disabled] { opacity: .55; }
</style>
