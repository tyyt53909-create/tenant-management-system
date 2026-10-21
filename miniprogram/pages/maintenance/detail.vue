<template>
  <view class="q-page page-safe-bottom"><text class="q-eyebrow">SERVICE STATUS / {{ isMaintenance ? '维修工单' : '报修进度' }}</text><text class="q-title">{{ isMaintenance ? '把问题处理好。' : '每一步，都看得见。' }}</text><text class="q-description">{{ isMaintenance ? '接单、处理、提交结果，进度与租客同步。' : '管理者处理进展，以最新工单状态为准。' }}</text>
    <view v-if="blocked" class="q-surface q-empty" style="margin-top: 24rpx;">
      <text class="q-empty-title">功能已被暂停</text>
      <text>报修记录查看已被暂停，如有需要请联系管理处。</text>
    </view>
    <view v-else-if="error" class="q-error" @tap="load">{{ error }} · 点此重试</view>
    <view v-if="record && !blocked" class="q-surface repair-banner"><QIcon name="repair" :size="48" /><view><text class="banner-title">{{ record.title }}</text><text class="banner-description">{{ record.description }}</text></view></view>
    <template v-if="record && !blocked"><view class="q-section-heading"><text>处理进度</text><text class="q-link" @tap="load">刷新状态</text></view><view class="q-surface flow-surface"><view v-if="record.status === 'CANCELLED'" class="q-empty">本次报修已取消</view><view v-else v-for="(step, index) in steps" :key="step.status" :class="['flow-step', { done: index < currentStep, current: index === currentStep, future: index > currentStep }]"><view class="flow-node"><text v-if="index < currentStep">✓</text></view><view><text class="flow-title">{{ step.title }}</text><text class="flow-description">{{ index <= currentStep ? step.description : '等待下一阶段' }}</text></view></view></view><view class="q-surface record-information"><view class="q-detail-row"><text>报修编号</text><text>{{ record.id }}</text></view><view class="q-detail-row"><text>提交时间</text><text>{{ record.createdAt?.replace('T', ' ').slice(0, 16) }}</text></view><view class="q-detail-row"><text>优先级</text><text>{{ priority }}</text></view><view v-if="isMaintenance && record.room" class="q-detail-row"><text>房间</text><text>{{ record.room.building?.name || '' }} · {{ record.room.roomNumber }}</text></view></view><text v-if="!isMaintenance && record.status === 'PENDING_CONFIRM'" class="q-note">维修已处理，请联系管理者确认实际结果。当前租客端不提供状态修改。</text></template>
    <view v-if="record?.resolution && !blocked" class="q-surface resolution-block"><text class="resolution-heading">处理说明</text><text class="resolution-copy">{{ record.resolution }}</text></view>
    <template v-if="record?.photos?.length && !blocked"><view class="q-section-heading"><text>报修照片</text><text class="q-link">点击查看大图</text></view><view class="repair-photos"><ProtectedPhoto v-for="photo in record.photos" :key="photo.id" :url="photo.fileUrl || photo.url" /></view></template>

    <view v-if="isMaintenance && record && !blocked" class="q-surface action-block">
      <template v-if="record.status === 'ASSIGNED'">
        <text class="action-heading">{{ record.assignedTo ? '这张工单已指派给你' : '这张工单在公共池中' }}</text>
        <text class="action-hint">接单后工单会进入「处理中」，其他维修人员将不再看到它。</text>
        <button class="q-primary action-button" :loading="claiming" :disabled="claiming" @tap="claim">接单并开始处理</button>
      </template>
      <template v-else-if="record.status === 'IN_PROGRESS'">
        <text class="action-heading">填写处理结果</text>
        <textarea v-model="resolution" class="action-textarea" maxlength="2000" placeholder="写下处理过程、更换的配件、需要租客注意的事项…" />
        <text class="action-count">{{ resolution.length }} / 2000</text>
        <button class="q-primary action-button" :loading="submitting" :disabled="submitting" @tap="submitComplete">{{ submitting ? '正在提交…' : '提交处理结果' }}</button>
        <text class="action-hint action-center">提交后进入「待确认」，租客确认后才算完成。</text>
      </template>
      <template v-else-if="record.status === 'PENDING_CONFIRM'">
        <text class="action-heading">已提交处理结果</text>
        <text class="action-hint">等待租客确认完成。若租客反馈问题仍在，工单会回到「处理中」。</text>
      </template>
      <template v-else-if="record.status === 'COMPLETED'">
        <text class="action-heading">工单已完成</text>
        <text class="action-hint">处理结果已确认，这笔工单已归档。</text>
      </template>
    </view>

    <view v-if="loading" class="q-empty">正在加载处理进度…</view><button class="q-outline return-button" @tap="back">{{ isMaintenance ? '返回维修工作台' : '返回我的报修' }}</button>
  </view>
</template>
<script>
import QIcon from '../../components/QIcon.vue'
import ProtectedPhoto from '../../components/ProtectedPhoto.vue'
import {
  getMaintenanceDetail,
  getWorkbenchOrder,
  claimMaintenance,
  completeMaintenance,
  getUserInfo,
} from '../../api/index.js'
import { openHome, hasCapability } from '../../utils/session.js'
export default {
  components: { QIcon, ProtectedPhoto },
  data() { return { id: '', record: null, role: '', loading: false, error: '', blocked: false, claiming: false, submitting: false, resolution: '', steps: [{ status: 'SUBMITTED', title: '已提交', description: '已收到你的报修申请' }, { status: 'ACKNOWLEDGED', title: '已受理', description: '管理者已受理，准备安排维修' }, { status: 'ASSIGNED', title: '已派单', description: '维修人员已安排' }, { status: 'IN_PROGRESS', title: '处理中', description: '工作人员正在跟进维修' }, { status: 'PENDING_CONFIRM', title: '待确认', description: '维修已处理，等待结果确认' }, { status: 'COMPLETED', title: '已完成', description: '本次报修服务已完成' }] } },
  computed: {
    isMaintenance() { return this.role === 'MAINTENANCE' },
    currentStep() { return this.steps.findIndex(s => s.status === this.record?.status) },
    priority() { return { LOW: '低', NORMAL: '普通', URGENT: '紧急' }[this.record?.priority] || '—' },
  },
  onLoad(query) { this.id = query.id || ''; this.load() },
  methods: {
    async load() {
      if (!this.id) { this.error = '缺少报修编号，请从列表重新打开'; return }
      this.loading = true; this.error = ''
      try {
        if (!uni.getStorageSync('access_token')) {
          uni.reLaunch({ url: '/pages/login/login' })
          return
        }
        const user = await getUserInfo()
        this.role = user.role
        uni.setStorageSync('user_role', user.role)
        if (Array.isArray(user.capabilities)) uni.setStorageSync('user_capabilities', user.capabilities)

        if (user.role === 'CLEANER') {
          openHome(user.role)
          return
        }
        if (user.role === 'MAINTENANCE') {
          this.blocked = false
          uni.setNavigationBarTitle({ title: '处理工单' })
          this.record = await getWorkbenchOrder(this.id)
          return
        }
        uni.setNavigationBarTitle({ title: '报修进度' })
        if (!hasCapability('tenant.maintenance.read')) {
          this.blocked = true
          return
        }
        this.blocked = false
        this.record = await getMaintenanceDetail(this.id)
      } catch (err) {
        if (err?.code === 'CAPABILITY_DENIED' || err?.message === 'CAPABILITY_DENIED' || err?.statusCode === 403) {
          this.blocked = true
          this.error = ''
        } else if (this.isMaintenance && err?.statusCode === 404) {
          this.error = '工单不存在，或已被其他维修人员接单'
        } else {
          this.error = '报修详情未能加载'
        }
      } finally { this.loading = false }
    },
    async claim() {
      if (this.claiming) return
      const confirmed = await new Promise(resolve => uni.showModal({
        title: '接单',
        content: `确认承接「${this.record.title}」并开始处理？`,
        success: result => resolve(result.confirm),
        fail: () => resolve(false),
      }))
      if (!confirmed) return
      this.claiming = true; this.error = ''
      try {
        await claimMaintenance(this.id)
        uni.showToast({ title: '已接单', icon: 'success' })
        await this.load()
      } catch (err) {
        this.error = err.statusCode === 409 ? '工单已被其他维修人员接单' : (err.message || '接单失败，请重试')
        if ([404, 409].includes(err.statusCode)) await this.load()
      } finally { this.claiming = false }
    },
    async submitComplete() {
      if (this.submitting) return
      const resolution = this.resolution.trim()
      if (!resolution) { uni.showToast({ title: '请填写处理结果', icon: 'none' }); return }
      this.submitting = true; this.error = ''
      try {
        await completeMaintenance(this.id, { resolution })
        uni.showToast({ title: '已提交，等待确认', icon: 'success' })
        await this.load()
      } catch (err) {
        this.error = err.statusCode === 409 ? '工单状态已变化，请刷新后重试' : (err.message || '提交失败，请重试')
        if ([404, 409].includes(err.statusCode)) await this.load()
      } finally { this.submitting = false }
    },
    back() {
      if (this.isMaintenance) uni.reLaunch({ url: '/pages/maintenance/workbench' })
      else uni.switchTab({ url: '/pages/maintenance/maintenance' })
    },
  }
}
</script>
<style scoped>.repair-photos{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14rpx}.resolution-block{margin-top:26rpx}.resolution-heading{display:block;font-weight:550;font-size:25rpx}.resolution-copy{display:block;font-size:23rpx;line-height:1.9;color:#716b60;margin-top:18rpx;white-space:pre-wrap;overflow-wrap:anywhere}</style>
<style scoped>.repair-banner{display:flex;gap:24rpx;align-items:flex-start}.repair-banner>view{flex:1;min-width:0}.banner-title{display:block;font-size:26rpx;font-weight:550}.banner-description{display:block;font-size:23rpx;color:#817e76;line-height:1.8;margin-top:14rpx;overflow-wrap:anywhere}.flow-surface{padding:42rpx 38rpx 18rpx}.flow-step{display:flex;gap:26rpx;position:relative;min-height:126rpx}.flow-step:before{content:'';position:absolute;left:19rpx;top:40rpx;bottom:0;width:2rpx;background:#e3dfd5}.flow-step:last-child:before{display:none}.flow-node{width:40rpx;height:40rpx;border-radius:50%;border:2rpx solid #d7d6ca;display:flex;align-items:center;justify-content:center;color:#fffefa;font-size:23rpx;flex-shrink:0}.done .flow-node,.current .flow-node{background:#68715b;border-color:#68715b}.current .flow-node{box-shadow:0 0 0 7rpx #ecf0e9}.flow-title{display:block;font-size:26rpx;margin-top:1rpx;font-weight:550}.flow-description{display:block;font-size:22rpx;color:#817e76;margin-top:14rpx;line-height:1.6}.future .flow-title,.future .flow-description{color:#a49f95}.record-information{margin-top:26rpx}.return-button{margin-top:32rpx}.action-block{margin-top:32rpx;padding:32rpx}.action-heading{display:block;font-size:28rpx;font-weight:550}.action-hint{display:block;margin-top:14rpx;font-size:22rpx;color:#817e76;line-height:1.8}.action-center{text-align:center}.action-button{margin-top:26rpx}.action-textarea{box-sizing:border-box;width:100%;min-height:240rpx;margin-top:20rpx;padding:24rpx;border:1rpx solid #e3dfd5;border-radius:20rpx;background:#fbf9f4;font-size:24rpx;line-height:1.8;color:#302f2a}.action-count{display:block;margin-top:10rpx;text-align:right;font-size:19rpx;color:#a49f95}</style>
