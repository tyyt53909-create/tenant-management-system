<template>
  <view class="q-page page-with-tabbar maintenance-page">
    <template v-if="currentTab === 'list'">
      <text class="q-eyebrow">MAINTENANCE / 我的报修</text><text class="q-title">让问题得到回应。</text><text class="q-description">从提交问题，到处理结束，每一步都看得见。</text>
      <button v-if="canCreateMaintenance" class="q-primary" @tap="startCreate"><text>＋</text>发起新报修</button>
      <view v-if="readBlocked" class="q-surface q-empty" style="margin-top: 24rpx;">
        <text class="q-empty-title">功能已被暂停</text>
        <text>报修记录查看已被暂停，如有需要请联系管理处。</text>
      </view>
      <template v-else>
        <view class="q-section-heading"><text>报修记录</text><text class="q-link" @tap="loadMaintenanceList">刷新</text></view>
        <view v-if="error" class="q-error" @tap="loadMaintenanceList">{{ error }} · 点此重试</view>
        <view v-for="item in maintenanceList" :key="item.id" class="q-surface repair-card" @tap="openDetail(item.id)"><view class="repair-icon"><QIcon name="repair" :size="46" /></view><view class="repair-copy"><view class="repair-card-header"><text>{{ item.title }}</text><text :class="['q-pill', { warn: ['SUBMITTED','PENDING_CONFIRM'].includes(item.status), quiet: ['CANCELLED','COMPLETED'].includes(item.status) }]">{{ getStatusText(item.status) }}</text></view><text class="repair-description">{{ item.description }}</text><text class="repair-date">{{ getCategoryText(item.category) }} · {{ formatDate(item.createdAt) }}</text></view><text class="repair-arrow">›</text></view>
        <view v-if="!maintenanceList.length && !error" class="q-surface q-empty"><text class="q-empty-title">{{ loading ? '正在加载记录…' : '目前没有报修记录' }}</text><text v-if="!loading">遇到居住问题，随时在这里告诉我们。</text></view>
      </template>
    </template>
    <template v-else-if="currentTab === 'create'">
      <view v-if="!canCreateMaintenance" class="q-surface q-empty" style="margin-top: 36rpx;">
        <text class="q-empty-title">功能已被暂停</text>
        <text>报修提交功能已被暂停，如有需要请联系管理处。</text>
        <button class="q-outline" style="margin-top: 24rpx;" @tap="switchTab('list')">返回报修记录</button>
      </view>
      <template v-else>
        <view class="repair-top"><text class="q-link" @tap="step === 2 ? step = 1 : switchTab('list')">‹ {{ step === 2 ? '更改类型' : '返回记录' }}</text><text>新建报修</text><text>0{{ step }} / 02</text></view>
        <view class="progress-mini"><view class="on" /><view :class="{ on: step === 2 }" /><view /></view>
        <template v-if="step === 1"><text class="q-title">哪里需要帮忙？</text><text class="q-description">选择一个最接近的类别，方便管理者快速安排处理。</text><view class="category-grid"><view v-for="category in categoryOptions" :key="category.value" :class="['category-card', { selected: form.category === category.value }]" @tap="chooseCategory(category)"><QIcon :name="category.icon" :size="44" /><text>{{ category.label }}</text><text class="category-hint">{{ category.hint }}</text></view></view><view class="q-surface privacy-note">填写的问题仅供相关管理人员处理，不会公开展示。</view><button class="q-primary next-button" @tap="nextStep">下一步 · 填写信息 ›</button></template>
        <template v-else><text class="q-title">把问题告诉我们。</text><text class="q-description">{{ form.categoryText }} · 描述越清楚，越方便安排处理。</text><text class="form-label">问题标题 <text class="required">*</text></text><input class="q-input" v-model="form.title" maxlength="50" placeholder="例如：厨房水槽下方漏水" /><text class="form-label">紧急程度</text><view class="priority-row"><view v-for="priority in priorityOptions" :key="priority.value" :class="['priority-choice', { active: form.priority === priority.value }]" @tap="choosePriority(priority)"><text>{{ priority.label }}</text><text>{{ priority.hint }}</text></view></view><text class="form-label">问题描述 <text class="required">*</text></text><textarea class="q-textarea" v-model="form.description" maxlength="500" placeholder="问题在哪里？什么时候开始？对生活有哪些影响？" /><text class="input-count">{{ form.description.length }} / 500</text><text class="form-label">上传照片 <text class="optional">（可选，最多 9 张）</text></text><view class="photos"><view class="photo" v-for="(image, index) in form.images" :key="image"><image :src="image" mode="aspectFill" /><view class="remove-photo" @tap="deleteImage(index)">×</view></view><view v-if="form.images.length < 9" class="add-photo" @tap="chooseImage"><text>＋</text><text>添加照片</text></view></view><text class="photo-note">提交时会上传照片，请勿包含证件或无关个人信息。</text><button class="q-primary submit-button" :loading="submitting" :disabled="submitting" @tap="submitMaintenance">{{ submitting ? '正在提交…' : '提交报修' }}</button></template>
      </template>
    </template>
    <template v-else><view class="success-mark"><QIcon name="check" :size="70" /></view><text class="q-title success-title">报修提交成功</text><text class="q-description success-description">你的问题我们已经收到。<br />接下来，可以在这里查看每一步处理进度。</text><view class="q-surface"><view class="q-detail-row"><text>报修编号</text><text>{{ submitted?.id || '—' }}</text></view><view class="q-detail-row"><text>当前状态</text><text>已提交</text></view></view><button class="q-primary submit-button" @tap="submitted?.id ? openDetail(submitted.id) : switchTab('list')">查看处理进度 ›</button><button class="q-outline return-button" @tap="switchTab('list')">返回报修记录</button></template>
  </view>
</template>
<script>
import QIcon from '../../components/QIcon.vue'
import { getMyMaintenance, createMaintenance, uploadMaintenancePhoto } from '../../api/index.js'
import { ensureTenantSession, hasCapability } from '../../utils/session.js'
const emptyForm = () => ({ title: '', category: '', categoryText: '', priority: 'NORMAL', priorityText: '普通', description: '', images: [] })
export default {
  components: { QIcon },
  data() { return { currentTab: 'list', step: 1, maintenanceList: [], form: emptyForm(), submitted: null, loading: false, error: '', submitting: false, readBlocked: false,
    categoryOptions: [{ label: '水管问题', value: 'PLUMBING', icon: 'droplet', hint: '漏水、水管、排水' }, { label: '电路问题', value: 'ELECTRICAL', icon: 'lightning', hint: '跳闸、插座、照明' }, { label: '家电维修', value: 'APPLIANCE', icon: 'repair', hint: '空调、热水器、电器' }, { label: '家具维修', value: 'FURNITURE', icon: 'chair', hint: '桌椅、柜体、家具' }, { label: '门窗维修', value: 'DOOR_WINDOW', icon: 'door', hint: '门锁、窗户、把手' }, { label: '其他问题', value: 'OTHER', icon: 'grid', hint: '墙面、地板、其他' }],
    priorityOptions: [{ label: '不紧急', value: 'LOW', hint: '方便时安排' }, { label: '普通', value: 'NORMAL', hint: '正常安排' }, { label: '紧急', value: 'URGENT', hint: '影响正常生活' }] } },
  computed: {
    canCreateMaintenance() {
      return hasCapability('tenant.maintenance.create')
    },
    canReadMaintenance() {
      return hasCapability('tenant.maintenance.read')
    }
  },
  onShow() { if (this.currentTab === 'list') this.loadMaintenanceList() },
  methods: {
    async loadMaintenanceList() {
      this.loading = true; this.error = ''
      try {
        if (!await ensureTenantSession()) return
        if (!hasCapability('tenant.maintenance.read')) {
          this.readBlocked = true
          return
        }
        this.readBlocked = false
        const res = await getMyMaintenance({ page: 1, limit: 50 })
        this.maintenanceList = res.data || []
      } catch (err) {
        if (err?.message === 'CAPABILITY_DENIED' || err?.statusCode === 403) {
          this.readBlocked = true
          this.error = ''
        } else {
          this.error = '报修记录未能加载'
        }
      } finally { this.loading = false }
    },
    switchTab(tab) { this.currentTab = tab; if (tab === 'list') this.loadMaintenanceList(); uni.pageScrollTo({ scrollTop: 0, duration: 0 }) },
    startCreate() {
      if (!this.canCreateMaintenance) {
        uni.showToast({ title: '报修提交已被暂停，请联系管理处', icon: 'none' })
        return
      }
      this.step = 1; this.switchTab('create')
    },
    chooseCategory(category) { this.form.category = category.value; this.form.categoryText = category.label },
    choosePriority(priority) { this.form.priority = priority.value; this.form.priorityText = priority.label },
    nextStep() { if (!this.form.category) { uni.showToast({ title: '请选择问题类型', icon: 'none' }); return }; this.step = 2; uni.pageScrollTo({ scrollTop: 0, duration: 0 }) },
    openDetail(id) { uni.navigateTo({ url: `/pages/maintenance/detail?id=${encodeURIComponent(id)}` }) },
    chooseImage() { const remaining = 9 - this.form.images.length; if (remaining <= 0) return; uni.chooseImage({ count: remaining, sizeType: ['compressed'], sourceType: ['album', 'camera'], success: res => { this.form.images = [...this.form.images, ...res.tempFilePaths].slice(0, 9) } }) },
    deleteImage(index) { this.form.images.splice(index, 1) },
    async submitMaintenance() {
      if (this.submitting) return
      if (!this.canCreateMaintenance) {
        uni.showToast({ title: '报修提交功能已被暂停，请联系管理处', icon: 'none' })
        return
      }
      if (!this.form.title.trim() || !this.form.description.trim() || !this.form.category || !this.form.priority) { uni.showToast({ title: '请填写标题、类别和问题描述', icon: 'none' }); return }
      this.submitting = true
      try {
        if (!await ensureTenantSession()) return
        const photos = []
        if (this.form.images.length) { try { for (let i = 0; i < this.form.images.length; i++) { uni.showLoading({ title: `上传照片 ${i + 1}/${this.form.images.length}` }); const res = await uploadMaintenancePhoto(this.form.images[i]); photos.push(res.url) } } finally { uni.hideLoading() } }
        const data = { title: this.form.title.trim(), category: this.form.category, priority: this.form.priority, description: this.form.description.trim() }
        if (photos.length) data.photos = photos
        this.submitted = await createMaintenance(data); this.form = emptyForm(); this.currentTab = 'success'; uni.pageScrollTo({ scrollTop: 0, duration: 0 })
      } catch (error) { uni.showToast({ title: error.message || '提交失败，请稍后重试', icon: 'none' }) } finally { this.submitting = false }
    },
    getCategoryText(value) { return this.categoryOptions.find(o => o.value === value)?.label || value },
    getStatusText(status) { return { SUBMITTED: '已提交', ACKNOWLEDGED: '已受理', ASSIGNED: '已派单', IN_PROGRESS: '处理中', PENDING_CONFIRM: '待确认', COMPLETED: '已完成', CANCELLED: '已取消' }[status] || status },
    formatDate(date) { return date?.replace('T', ' ').slice(0, 16) || '—' },
  }
}
</script>
<style scoped>
.repair-card{display:flex;align-items:center;gap:18rpx;padding:28rpx 24rpx;margin-bottom:22rpx}.repair-icon{width:70rpx;height:76rpx;background:#ecf0e9;display:flex;align-items:center;justify-content:center;border-radius:22rpx;flex-shrink:0}.repair-copy{flex:1;min-width:0}.repair-card-header{display:flex;align-items:center;justify-content:space-between;gap:10rpx}.repair-card-header>text:first-child{font-size:24rpx;font-weight:550;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.repair-description{display:block;font-size:22rpx;color:#817e76;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:12rpx}.repair-date{display:block;font-size:19rpx;color:#a49f95;margin-top:12rpx}.repair-arrow{font-size:32rpx;color:#a49f95}.repair-top{display:flex;justify-content:space-between;align-items:center;font-size:24rpx;margin-bottom:28rpx}.repair-top>text:last-child{font-size:20rpx;color:#a49f95}.progress-mini{display:flex;gap:10rpx;margin:20rpx 0 36rpx}.progress-mini>view{height:5rpx;width:56rpx;border-radius:10rpx;background:#e3dfd5}.progress-mini>.on{background:#899079}.category-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18rpx}.category-card{padding:30rpx 26rpx;background:#fffefa;border:2rpx solid #e9e6de;border-radius:28rpx;display:flex;flex-direction:column;gap:20rpx}.category-card.selected{border-color:#899079;background:#ecf0e9}.category-card>text{font-size:26rpx;font-weight:550}.category-card>.category-hint{font-size:19rpx;color:#817e76;font-weight:400;margin-top:-8rpx}.privacy-note{font-size:23rpx;line-height:1.9;color:#817e76;margin-top:32rpx}.next-button,.submit-button{margin-top:36rpx}.form-label{display:block;font-size:25rpx;font-weight:550;margin:32rpx 0 18rpx}.required{color:#ad735a}.optional{font-size:22rpx;color:#a49f95;font-weight:400}.q-input,.q-textarea{box-sizing:border-box;width:100%;background:#fffefa;border:1rpx solid #e9e6de;border-radius:20rpx;padding:24rpx;font-size:24rpx;color:#302f2a}.q-input{height:88rpx}.q-textarea{height:240rpx;line-height:1.8}.priority-row{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12rpx}.priority-choice{border:1rpx solid #e0dcd2;background:#fffefa;border-radius:20rpx;padding:22rpx 10rpx;text-align:center}.priority-choice.active{border-color:#899079;background:#ecf0e9}.priority-choice>text{display:block;font-size:24rpx}.priority-choice>text:last-child{font-size:19rpx;color:#817e76;margin-top:10rpx}.input-count{display:block;text-align:right;font-size:20rpx;color:#a49f95;margin-top:10rpx}.photos{display:flex;flex-wrap:wrap;gap:18rpx}.photo,.add-photo{width:150rpx;height:150rpx;border-radius:20rpx;position:relative}.photo image{width:100%;height:100%;border-radius:20rpx}.remove-photo{position:absolute;right:4rpx;top:4rpx;background:#302f2a;color:#fffefa;border-radius:50%;width:34rpx;height:34rpx;line-height:30rpx;text-align:center;font-size:30rpx}.add-photo{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12rpx;background:#fffefa;border:1rpx dashed #c9c5b8;color:#a49f95;font-size:22rpx}.add-photo>text:first-child{font-size:38rpx}.photo-note{display:block;color:#a49f95;font-size:20rpx;line-height:1.8;margin-top:20rpx}.success-mark{display:flex;align-items:center;justify-content:center;margin:70rpx auto 36rpx;width:120rpx;height:120rpx;background:#ecf0e9;border-radius:50%}.success-title,.success-description{text-align:center}.return-button{margin-top:24rpx}
</style>
