<template>
  <view class="q-page page-with-tabbar home-page">
    <view class="home-greeting"><view><text class="q-eyebrow">{{ today }}</text><text class="q-title">{{ greeting }}，欢迎回家</text></view><view class="home-bell" @tap="goToNotifications"><QIcon name="bell" :size="40" /><view v-if="unreadCount" class="unread-dot" /></view></view>
    <view v-if="canViewContract" class="home-room" @tap="goToContract"><QIcon name="home" :size="28" /><text>{{ roomInfo || '我的居所 · 暂无生效合同' }}</text><text>›</text></view>
    <view v-if="error" class="q-error" @tap="loadData">{{ error }} · 点此重试</view>
    <QCalendar :events="calendarEvents" @open="openEvent" />
    <view class="q-section-heading"><text>待处理事项</text><text class="q-link" @tap="goToMaintenance">查看全部 ›</text></view>
    <view class="q-surface todo-surface">
      <view v-if="activeRepair" class="home-todo" @tap="openRepair(activeRepair.id)"><view class="round-icon clay"><QIcon name="repair" :size="36" /></view><view class="todo-copy"><text>{{ activeRepair.title }}</text><text class="todo-description">{{ repairStatus(activeRepair.status) }} · 查看处理进度</text></view><text class="q-arrow">›</text></view>
      <view v-if="pendingBillsCount" class="home-todo" @tap="goToBills"><view class="round-icon"><QIcon name="wallet" :size="36" /></view><view class="todo-copy"><text>{{ pendingBillsCount }} 笔账单待缴付</text><text class="todo-description">核对费用明细，安心安排生活</text></view><text class="q-arrow">›</text></view>
      <view v-if="!activeRepair && !pendingBillsCount" class="q-empty"><text class="q-empty-title">目前没有待处理事项</text><text>{{ loading ? '正在同步居住信息…' : '每一件小事，都已妥善安排。' }}</text></view>
    </view>
    <view class="home-landlord-banner q-surface" @tap="openContact">
      <view class="banner-avatar">{{ landlordContact.name?.slice(0, 1) || '管' }}</view>
      <view class="banner-body">
        <view class="banner-title-line">
          <text class="banner-title">专属管家 · {{ landlordContact.name }}</text>
          <text class="banner-time">{{ landlordContact.serviceHours }}</text>
        </view>
        <text class="banner-sub">微信 {{ landlordContact.wechat }} · 电话 {{ landlordContact.formattedPhone || landlordContact.phone }}</text>
      </view>
      <button class="banner-copy-btn" @tap.stop="copyWechat">复制微信</button>
    </view>
    <view v-if="visibleServices.length" class="q-section-heading"><text>常用服务</text></view>
    <view v-if="visibleServices.length" class="home-services"><view v-for="item in visibleServices" :key="item.name" class="service" @tap="openService(item.path, item.tab)"><QIcon :name="item.icon" :size="42" :active="true" /><text>{{ item.name }}</text></view></view>
    <view class="q-section-heading"><text>最近通知</text><text class="q-link" @tap="goToNotifications">查看全部 ›</text></view>
    <view class="q-surface notice-surface"><view v-for="notice in notices" :key="notice.id" class="home-notice" @tap="goToNotifications"><view :class="['notice-dot', { read: notice.isRead }]" /><view><text class="notice-title">{{ notice.title }}</text><text class="notice-description">{{ notice.body }}</text></view><text class="q-arrow">›</text></view><view v-if="!notices.length" class="q-empty"><text>暂时没有新的通知</text></view></view>
    <text class="q-note">栖居 · 让每一件小事，都有清楚的回应</text>
    <ContactCardModal
      :visible="showContactModal"
      :contact="landlordContact"
      @close="showContactModal = false"
    />
  </view>
</template>
<script>
import QIcon from '../../components/QIcon.vue'
import QCalendar from '../../components/QCalendar.vue'
import ContactCardModal from '../../components/ContactCardModal.vue'
import { getUserInfo, getMyBills, getMyMaintenance, getMyContracts, getNotifications, getUnreadCount } from '../../api/index.js'
import { openHome } from '../../utils/session.js'
import { homeEvents } from '../../utils/calendar.js'
import { getLandlordContact, copyToClipboard } from '../../utils/contact.js'
export default {
  components: { QIcon, QCalendar, ContactCardModal },
  data() {
    const d = new Date()
    return { today: `${d.getMonth() + 1}月${d.getDate()}日 · ${['星期日','星期一','星期二','星期三','星期四','星期五','星期六'][d.getDay()]}`, greeting: d.getHours() < 12 ? '早上好' : d.getHours() < 18 ? '下午好' : '晚上好', userName: '', roomInfo: '', pendingBillsCount: 0, recentBills: [], repairs: [], notices: [], unreadCount: 0, loading: true, error: '', showContactModal: false, landlordContact: getLandlordContact({}, []), capabilities: uni.getStorageSync('user_capabilities') || [], services: [{ name: '账单', icon: 'bill', path: '/pages/bills/bills', tab: true }, { name: '合同', icon: 'contract', path: '/pages/contract/contract' }, { name: '报修', icon: 'repair', path: '/pages/maintenance/maintenance', tab: true }, { name: '余额', icon: 'wallet', path: '/pages/account/account' }] }
  },
  computed: {
    calendarEvents() { return homeEvents(this.recentBills, this.repairs) },
    activeRepair() { return this.repairs.find(r => !['COMPLETED', 'CANCELLED'].includes(r.status)) },
    canViewContract() {
      return Array.isArray(this.capabilities) && this.capabilities.includes('tenant.contract.read')
    },
    visibleServices() {
      if (!Array.isArray(this.capabilities)) return []
      return this.services.filter(s => {
        if (s.name === '合同') return this.capabilities.includes('tenant.contract.read')
        if (s.name === '余额') return this.capabilities.includes('tenant.prepay.read')
        return true
      })
    }
  },
  onShow() { this.loadData() },
  methods: {
    async loadData() {
      if (!uni.getStorageSync('access_token')) { uni.reLaunch({ url: '/pages/login/login' }); return }
      this.loading = true; this.error = ''
      try {
        const user = await getUserInfo(); uni.setStorageSync('user_role', user.role)
        if (user.role === 'CLEANER') { openHome(user.role); return }
        this.userName = user.tenant?.name || '租客'
        this.capabilities = user.capabilities || []
        uni.setStorageSync('user_capabilities', this.capabilities)
        const caps = Array.isArray(this.capabilities) ? this.capabilities : []
        const billsPromise = caps.includes('tenant.bill.read')
          ? getMyBills({ page: 1, limit: 50 }).catch(() => ({ data: [] }))
          : Promise.resolve({ data: [] })
        const repairsPromise = caps.includes('tenant.maintenance.read')
          ? getMyMaintenance({ page: 1, limit: 20 }).catch(() => ({ data: [] }))
          : Promise.resolve({ data: [] })
        const contractsPromise = caps.includes('tenant.contract.read')
          ? getMyContracts().catch(() => ({ data: [] }))
          : Promise.resolve({ data: [] })
        const noticesPromise = getNotifications({ page: 1, limit: 3 }).catch(() => ({ data: [] }))
        const unreadPromise = getUnreadCount().catch(() => ({ unreadCount: 0 }))

        const [bills, repairs, contracts, notices, unread] = await Promise.all([
          billsPromise,
          repairsPromise,
          contractsPromise,
          noticesPromise,
          unreadPromise,
        ])
        this.recentBills = bills.data || []; this.repairs = repairs.data || []; this.notices = notices.data || []; this.unreadCount = unread.unreadCount || 0
        this.pendingBillsCount = this.recentBills.filter(b => ['PENDING', 'PARTIAL', 'OVERDUE'].includes(b.status)).length
        const contract = contracts.data?.find(c => c.status === 'ACTIVE')
        this.roomInfo = contract?.room ? `${contract.room.building?.name || '我的居所'} · ${contract.room.roomNumber}室` : ''
        this.landlordContact = getLandlordContact(user, contracts.data || [])
      } catch {
        this.error = '居住信息暂时未能加载，请检查连接'
        this.capabilities = null
      } finally { this.loading = false }
    },
    repairStatus(status) { return { SUBMITTED: '已提交，等待受理', ACKNOWLEDGED: '物业已受理', ASSIGNED: '维修人员已安排', IN_PROGRESS: '维修处理中', PENDING_CONFIRM: '维修完成，待确认' }[status] || '查看报修进度' },
    openContact() { this.showContactModal = true },
    copyWechat() { copyToClipboard(this.landlordContact.wechat, '微信号') },
    openService(path, tab) { if (tab) uni.switchTab({ url: path }); else uni.navigateTo({ url: path }) },
    openEvent(event) { if (event.type === 'bill') uni.navigateTo({ url: `/pages/bill-detail/bill-detail?id=${encodeURIComponent(event.recordId)}` }); else this.openRepair(event.recordId) },
    openRepair(id) { uni.navigateTo({ url: `/pages/maintenance/detail?id=${encodeURIComponent(id)}` }) },
    goToContract() { uni.navigateTo({ url: '/pages/contract/contract' }) }, goToBills() { uni.switchTab({ url: '/pages/bills/bills' }) }, goToMaintenance() { uni.switchTab({ url: '/pages/maintenance/maintenance' }) }, goToNotifications() { uni.navigateTo({ url: '/pages/notifications/notifications' }) },
  }
}
</script>
<style scoped>
.home-greeting{display:flex;align-items:center;justify-content:space-between;gap:16rpx}.home-greeting .q-title{font-size:46rpx}.home-bell{position:relative;width:74rpx;height:74rpx;background:#fffefa;border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0}.unread-dot{position:absolute;right:16rpx;top:12rpx;width:10rpx;height:10rpx;border-radius:50%;background:#ad735a}.home-room{display:flex;gap:12rpx;align-items:center;font-size:22rpx;color:#817e76;margin:20rpx 0 30rpx}.home-room text:first-of-type{flex:1;min-width:0}.home-room text:last-child{font-size:28rpx}.todo-surface{padding:10rpx 32rpx;margin-bottom:24rpx}.home-todo{display:flex;align-items:center;gap:20rpx;padding:24rpx 0;border-bottom:1rpx solid #e9e6de}.home-todo:last-child{border:0}.round-icon{width:68rpx;height:68rpx;display:flex;align-items:center;justify-content:center;border-radius:50%;background:#ecf0e9;flex-shrink:0}.round-icon.clay{background:#f8ece5}.todo-copy{flex:1;min-width:0}.todo-copy>text:first-child{display:block;font-size:25rpx;font-weight:550;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}.todo-description{display:block;margin-top:10rpx;font-size:21rpx;color:#817e76}.q-arrow{font-size:34rpx;color:#a49f95}.home-landlord-banner{display:flex;align-items:center;gap:20rpx;padding:22rpx 28rpx;margin-bottom:30rpx;border-radius:24rpx;background:#fdfcf9;border:1rpx solid #ede8de}.banner-avatar{width:72rpx;height:72rpx;border-radius:50%;background:#515c43;color:#fffefa;display:flex;align-items:center;justify-content:center;font-size:28rpx;font-weight:600;flex-shrink:0}.banner-body{flex:1;min-width:0}.banner-title-line{display:flex;align-items:center;gap:12rpx}.banner-title{font-size:26rpx;font-weight:600;color:#302f2a}.banner-time{font-size:20rpx;color:#8c857b}.banner-sub{display:block;font-size:21rpx;color:#8c857b;margin-top:6rpx;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.banner-copy-btn{background:#2e7d32;color:#ffffff;font-size:22rpx;font-weight:550;height:54rpx;line-height:54rpx;padding:0 20rpx;border-radius:12rpx;border:none;margin:0;flex-shrink:0}.banner-copy-btn::after{border:none}.home-services{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:18rpx}.service{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:20rpx;background:#fffefa;border:1rpx solid #e9e6de;border-radius:28rpx;padding:28rpx 0;font-size:23rpx}.notice-surface{padding:14rpx 30rpx}.home-notice{display:flex;align-items:center;gap:18rpx;padding:24rpx 0;border-bottom:1rpx solid #e9e6de}.home-notice:last-child{border:0}.notice-dot{width:10rpx;height:10rpx;border-radius:50%;background:#ad735a;flex-shrink:0}.notice-dot.read{background:#a49f95}.home-notice>view:nth-child(2){flex:1;min-width:0}.notice-title{display:block;font-size:24rpx;font-weight:550}.notice-description{display:block;font-size:21rpx;color:#817e76;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:10rpx}
</style>
<style scoped>
.home-greeting .q-title{font-size:52rpx;letter-spacing:-2.5rpx;font-weight:600}
</style>
