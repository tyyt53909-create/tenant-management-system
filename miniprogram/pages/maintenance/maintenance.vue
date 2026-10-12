<template>
  <view class="page">
    <view class="tabs">
      <view 
        :class="['tab-item', currentTab === 'list' ? 'active' : '']" 
        @tap="switchTab('list')"
      >
        我的报修
      </view>
      <view 
        :class="['tab-item', currentTab === 'create' ? 'active' : '']" 
        @tap="switchTab('create')"
      >
        在线报修
      </view>
    </view>

    <!-- 报修列表 -->
    <scroll-view v-if="currentTab === 'list'" class="list-container" scroll-y>
      <view class="maintenance-item" v-for="item in maintenanceList" :key="item.id">
        <view class="item-header">
          <text class="title">{{ item.title }}</text>
          <text :class="['status', getStatusClass(item.status)]">
            {{ getStatusText(item.status) }}
          </text>
        </view>
        <view class="item-body">
          <view class="info-row">
            <text class="label">类别</text>
            <text class="value">{{ getCategoryText(item.category) }}</text>
          </view>
          <view class="info-row">
            <text class="label">优先级</text>
            <text class="value">{{ getPriorityText(item.priority) }}</text>
          </view>
          <view class="info-row">
            <text class="label">提交时间</text>
            <text class="value">{{ formatDate(item.createdAt) }}</text>
          </view>
          <view class="description">
            <text class="label">问题描述</text>
            <text class="value">{{ item.description }}</text>
          </view>
        </view>
      </view>
      <view class="empty" v-if="maintenanceList.length === 0">
        <text>暂无报修记录</text>
      </view>
    </scroll-view>

    <!-- 创建报修 -->
    <scroll-view v-if="currentTab === 'create'" class="form-container" scroll-y>
      <view class="form-section">
        <view class="form-item">
          <text class="label required">标题</text>
          <input 
            class="input" 
            v-model="form.title" 
            placeholder="请输入问题标题"
            maxlength="50"
          />
        </view>

        <view class="form-item">
          <text class="label required">类别</text>
          <picker 
            mode="selector" 
            :range="categoryOptions" 
            :range-key="'label'"
            @change="onCategoryChange"
          >
            <view class="picker">
              {{ form.categoryText || '请选择类别' }}
            </view>
          </picker>
        </view>

        <view class="form-item">
          <text class="label required">优先级</text>
          <picker 
            mode="selector" 
            :range="priorityOptions" 
            :range-key="'label'"
            @change="onPriorityChange"
          >
            <view class="picker">
              {{ form.priorityText || '请选择优先级' }}
            </view>
          </picker>
        </view>

        <view class="form-item">
          <text class="label required">问题描述</text>
          <textarea 
            class="textarea" 
            v-model="form.description" 
            placeholder="请详细描述问题，以便我们更好地为您服务"
            maxlength="500"
          />
        </view>

        <view class="form-item">
          <text class="label">上传图片</text>
          <view class="upload-area">
            <view class="upload-item" v-for="(img, index) in form.images" :key="index">
              <image class="upload-image" :src="img" mode="aspectFill"></image>
              <view class="delete-btn" @tap="deleteImage(index)">×</view>
            </view>
            <view class="upload-btn" v-if="form.images.length < 3" @tap="chooseImage">
              <text class="icon">+</text>
              <text class="text">上传图片</text>
            </view>
          </view>
          <text class="tip">最多上传3张图片</text>
        </view>

        <button class="btn-submit" @tap="submitMaintenance" :loading="submitting">
          提交报修
        </button>
      </view>
    </scroll-view>
  </view>
</template>

<script>
import { getMyMaintenance, createMaintenance } from '../../api/index.js'

export default {
  data() {
    return {
      currentTab: 'list',
      maintenanceList: [],
      form: {
        title: '',
        category: '',
        categoryText: '',
        priority: '',
        priorityText: '',
        description: '',
        images: []
      },
      categoryOptions: [
        { label: '水管问题', value: 'PLUMBING' },
        { label: '电路问题', value: 'ELECTRICAL' },
        { label: '家电维修', value: 'APPLIANCE' },
        { label: '家具维修', value: 'FURNITURE' },
        { label: '门窗维修', value: 'DOOR_WINDOW' },
        { label: '其他', value: 'OTHER' }
      ],
      priorityOptions: [
        { label: '低', value: 'LOW' },
        { label: '普通', value: 'NORMAL' },
        { label: '紧急', value: 'URGENT' }
      ],
      submitting: false
    }
  },
  onLoad() {
    this.loadMaintenanceList()
  },
  methods: {
    async loadMaintenanceList() {
      try {
        const res = await getMyMaintenance({ page: 1, limit: 50 })
        this.maintenanceList = res.data || []
      } catch (error) {
        console.error('加载报修记录失败:', error)
      }
    },
    switchTab(tab) {
      this.currentTab = tab
      if (tab === 'list') {
        this.loadMaintenanceList()
      }
    },
    onCategoryChange(e) {
      const index = e.detail.value
      this.form.category = this.categoryOptions[index].value
      this.form.categoryText = this.categoryOptions[index].label
    },
    onPriorityChange(e) {
      const index = e.detail.value
      this.form.priority = this.priorityOptions[index].value
      this.form.priorityText = this.priorityOptions[index].label
    },
    chooseImage() {
      uni.chooseImage({
        count: 3 - this.form.images.length,
        sizeType: ['compressed'],
        sourceType: ['album', 'camera'],
        success: (res) => {
          this.form.images = [...this.form.images, ...res.tempFilePaths]
        }
      })
    },
    deleteImage(index) {
      this.form.images.splice(index, 1)
    },
    async submitMaintenance() {
      // 验证表单
      if (!this.form.title) {
        uni.showToast({ title: '请输入标题', icon: 'none' })
        return
      }
      if (!this.form.category) {
        uni.showToast({ title: '请选择类别', icon: 'none' })
        return
      }
      if (!this.form.priority) {
        uni.showToast({ title: '请选择优先级', icon: 'none' })
        return
      }
      if (!this.form.description) {
        uni.showToast({ title: '请输入问题描述', icon: 'none' })
        return
      }

      this.submitting = true
      try {
        // TODO: 如果有图片，需要先上传图片
        // 租客身份与房间由服务端根据登录身份和生效合同自动关联（T138）
        const data = {
          title: this.form.title,
          category: this.form.category,
          priority: this.form.priority,
          description: this.form.description
        }

        await createMaintenance(data)
        
        uni.showToast({
          title: '提交成功',
          icon: 'success'
        })
        
        // 重置表单
        this.form = {
          title: '',
          category: '',
          categoryText: '',
          priority: '',
          priorityText: '',
          description: '',
          images: []
        }
        
        // 切换到列表
        this.switchTab('list')
      } catch (error) {
        console.error('提交报修失败:', error)
      } finally {
        this.submitting = false
      }
    },
    getCategoryText(category) {
      const item = this.categoryOptions.find(o => o.value === category)
      return item ? item.label : category
    },
    getPriorityText(priority) {
      const item = this.priorityOptions.find(o => o.value === priority)
      return item ? item.label : priority
    },
    getStatusText(status) {
      const map = {
        SUBMITTED: '已提交',
        ACKNOWLEDGED: '已受理',
        ASSIGNED: '已派单',
        IN_PROGRESS: '维修中',
        PENDING_CONFIRM: '待确认',
        COMPLETED: '已完成',
        CANCELLED: '已取消'
      }
      return map[status] || status
    },
    getStatusClass(status) {
      const map = {
        SUBMITTED: 'status-warning',
        ACKNOWLEDGED: 'status-info',
        ASSIGNED: 'status-info',
        IN_PROGRESS: 'status-primary',
        PENDING_CONFIRM: 'status-warning',
        COMPLETED: 'status-success',
        CANCELLED: 'status-default'
      }
      return map[status] || ''
    },
    formatDate(dateStr) {
      if (!dateStr) return ''
      return dateStr.replace('T', ' ').substring(0, 16)
    }
  }
}
</script>

<style scoped>
.page {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background-color: #f5f5f5;
}

.tabs {
  display: flex;
  background-color: #fff;
  padding: 20rpx 0;
}

.tab-item {
  flex: 1;
  text-align: center;
  font-size: 28rpx;
  color: #666;
  padding: 20rpx 0;
  position: relative;
}

.tab-item.active {
  color: #07c160;
  font-weight: bold;
}

.tab-item.active::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 50%;
  transform: translateX(-50%);
  width: 60rpx;
  height: 4rpx;
  background-color: #07c160;
  border-radius: 2rpx;
}

.list-container, .form-container {
  flex: 1;
  padding: 20rpx;
}

.maintenance-item {
  background-color: #fff;
  border-radius: 16rpx;
  padding: 30rpx;
  margin-bottom: 20rpx;
}

.item-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20rpx;
}

.title {
  font-size: 30rpx;
  font-weight: bold;
  color: #333;
  flex: 1;
}

.status {
  font-size: 24rpx;
  padding: 6rpx 16rpx;
  border-radius: 8rpx;
  margin-left: 20rpx;
}

.status-warning { background-color: #fff3e0; color: #ff9800; }
.status-info { background-color: #e3f2fd; color: #2196f3; }
.status-primary { background-color: #e8eaf6; color: #3f51b5; }
.status-success { background-color: #e8f5e9; color: #4caf50; }
.status-default { background-color: #f5f5f5; color: #888; }

.item-body {
  font-size: 26rpx;
}

.info-row {
  display: flex;
  justify-content: space-between;
  margin-bottom: 16rpx;
}

.description {
  margin-top: 20rpx;
  padding-top: 20rpx;
  border-top: 1rpx solid #f0f0f0;
}

.description .label {
  display: block;
  margin-bottom: 12rpx;
}

.description .value {
  line-height: 1.6;
}

.info-row .label, .description .label {
  color: #888;
}

.info-row .value, .description .value {
  color: #333;
}

.form-section {
  background-color: #fff;
  border-radius: 16rpx;
  padding: 30rpx;
}

.form-item {
  margin-bottom: 40rpx;
}

.label {
  display: block;
  font-size: 28rpx;
  color: #333;
  margin-bottom: 16rpx;
}

.required::before {
  content: '*';
  color: #f44336;
  margin-right: 4rpx;
}

.input, .picker {
  width: 100%;
  height: 80rpx;
  background-color: #f5f5f5;
  border-radius: 12rpx;
  padding: 0 24rpx;
  font-size: 28rpx;
  line-height: 80rpx;
}

.textarea {
  width: 100%;
  min-height: 200rpx;
  background-color: #f5f5f5;
  border-radius: 12rpx;
  padding: 24rpx;
  font-size: 28rpx;
}

.upload-area {
  display: flex;
  flex-wrap: wrap;
  gap: 20rpx;
}

.upload-item {
  position: relative;
  width: 200rpx;
  height: 200rpx;
}

.upload-image {
  width: 100%;
  height: 100%;
  border-radius: 12rpx;
}

.delete-btn {
  position: absolute;
  top: -10rpx;
  right: -10rpx;
  width: 40rpx;
  height: 40rpx;
  background-color: #f44336;
  color: #fff;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 32rpx;
  line-height: 1;
}

.upload-btn {
  width: 200rpx;
  height: 200rpx;
  background-color: #f5f5f5;
  border-radius: 12rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: #888;
}

.upload-btn .icon {
  font-size: 64rpx;
  margin-bottom: 10rpx;
}

.upload-btn .text {
  font-size: 24rpx;
}

.tip {
  display: block;
  font-size: 24rpx;
  color: #888;
  margin-top: 16rpx;
}

.btn-submit {
  width: 100%;
  height: 88rpx;
  background-color: #07c160;
  color: #fff;
  border-radius: 12rpx;
  font-size: 32rpx;
  border: none;
  margin-top: 40rpx;
}

.empty {
  text-align: center;
  padding: 120rpx 0;
  color: #999;
  font-size: 26rpx;
}
</style>
