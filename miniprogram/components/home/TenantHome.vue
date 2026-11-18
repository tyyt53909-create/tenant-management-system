<template>
  <view class="tenant-home">
    <view class="home-greeting">
      <view>
        <text class="q-eyebrow">{{ today }}</text>
        <text class="q-title">{{ greeting }}，欢迎回家</text>
      </view>
      <view class="home-bell" @tap="goToNotifications">
        <QIcon name="bell" :size="40" />
        <view v-if="unreadCount" class="unread-dot" />
      </view>
    </view>

    <view v-if="canViewContract" class="home-room" @tap="goToContract">
      <QIcon name="home" :size="28" />
      <text>{{ roomInfo || (loading ? '正在加载居所…' : failed.includes('居所') ? '居所暂未更新' : '我的居所 · 暂无生效合同') }}</text>
      <text>›</text>
    </view>

    <SpaceMiniMap v-if="myRoomPosition" mode="tenant" title="我的居所位置"
      :subtitle="`${myRoomPosition.floor}楼 · ${myRoomPosition.roomNumber}室`" :rooms="[myRoomPosition]" />

    <view v-if="failed.length" class="q-error" @tap="loadData">{{ failed.join('、') }}暂未更新 · 点此重试</view>

    <QCalendar :events="calendarEvents" :loading="loading && !calendarEvents.length" :has-error="failed.includes('账单') || failed.includes('报修')" @open="openEvent" />

    <view v-if="canViewBills || canViewRepairs" class="q-section-heading">
      <text>待处理事项</text>
    </view>
    <view v-if="canViewBills || canViewRepairs" class="q-surface todo-surface">
      <view v-if="activeRepair" class="home-todo" @tap="openRepair(activeRepair.id)">
        <view class="round-icon clay">
          <QIcon name="repair" :size="36" />
        </view>
        <view class="todo-copy">
          <text>{{ activeRepair.title }}</text>
          <text class="todo-description">{{ repairStatus(activeRepair.status) }} · 查看处理进度</text>
        </view>
        <text class="q-arrow">›</text>
      </view>
      <view v-if="pendingBillsCount" class="home-todo" @tap="openPendingBills">
        <view class="round-icon">
          <QIcon name="wallet" :size="36" />
        </view>
        <view class="todo-copy">
          <text>{{ pendingBillsCount }} 笔账单待缴付</text>
          <text class="todo-description">核对费用明细，安心安排生活</text>
        </view>
        <text class="q-arrow">›</text>
      </view>
      <HomeSkeleton v-if="loading && !activeRepair && !pendingBillsCount" label="正在同步待办…" />
      <view v-else-if="!activeRepair && !pendingBillsCount" class="q-empty">
        <text v-if="failed.includes('账单') || failed.includes('报修')">待办暂未更新</text>
        <template v-else>
          <text v-if="canViewBills">暂无待缴账单</text>
          <text v-if="canViewRepairs">暂无进行中的报修</text>
        </template>
      </view>
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
    <view v-if="visibleServices.length" class="home-services">
      <view v-for="item in visibleServices" :key="item.name" class="service" @tap="openService(item.path, item.tab)">
        <QIcon :name="item.icon" :size="42" :active="true" />
        <text>{{ item.name }}</text>
      </view>
    </view>

    <view class="q-section-heading">
      <text>最近通知</text>
      <text class="q-link" @tap="goToNotifications">查看全部 ›</text>
    </view>
    <view class="q-surface notice-surface">
      <view v-for="notice in notices" :key="notice.id" class="home-notice" @tap="goToNotifications">
        <view :class="['notice-dot', { read: notice.isRead }]" />
        <view>
          <text class="notice-title">{{ notice.title }}</text>
          <text class="notice-description">{{ notice.body }}</text>
        </view>
        <text class="q-arrow">›</text>
      </view>
      <view v-if="!notices.length" class="q-empty"><text>{{ loading ? '正在加载通知…' : failed.includes('通知') ? '通知暂未更新' : '暂时没有新的通知' }}</text></view>
    </view>

    <text class="q-note">栖居 · 让每一件小事，都有清楚的回应</text>

    <ContactCardModal
      :visible="showContactModal"
      :contact="landlordContact"
      :can-open-maintenance="canOpenRepairs"
      :can-open-contract="canViewContract"
      @close="showContactModal = false"
    />
  </view>
</template>

<script>
import QIcon from '../QIcon.vue'
import HomeSkeleton from './HomeSkeleton.vue'
import QCalendar from '../QCalendar.vue'
import SpaceMiniMap from '../SpaceMiniMap.vue'
import ContactCardModal from '../ContactCardModal.vue'
import { getMyBills, getMyMaintenance, getMyContracts, getNotifications } from '../../api/index.js'
import { homeEvents } from '../../utils/calendar.js'
import { getLandlordContact, copyToClipboard } from '../../utils/contact.js'

export default {
  components: { QIcon, QCalendar, SpaceMiniMap, ContactCardModal, HomeSkeleton },
  props: {
    user: {
      type: Object,
      required: true
    }
  },
  data() {
    const d = new Date()
    return {
      today: `${d.getMonth() + 1}月${d.getDate()}日 · ${['星期日','星期一','星期二','星期三','星期四','星期五','星期六'][d.getDay()]}`,
      greeting: d.getHours() < 12 ? '早上好' : d.getHours() < 18 ? '下午好' : '晚上好',
      roomInfo: '',
      myRoomPosition: null,
      pendingBillsCount: 0,
      recentBills: [],
      repairs: [],
      notices: [],
      unreadCount: 0,
      pendingBillId: '',
      loading: true,
      refreshing: false,
      failed: [],
      showContactModal: false,
      landlordContact: getLandlordContact(),
      services: [
        { name: '账单', icon: 'bill', path: '/pages/bills/bills', tab: true, capability: 'tenant.bill.read' },
        { name: '合同', icon: 'contract', path: '/packageA/contract/contract', capability: 'tenant.contract.read' },
        { name: '报修', icon: 'repair', path: '/pages/maintenance/maintenance', tab: true, capability: 'tenant.maintenance.read' },
        { name: '余额', icon: 'wallet', path: '/packageA/account/account', capability: 'tenant.prepay.read' }
      ]
    }
  },
  computed: {
    capabilities() {
      return (this.user && Array.isArray(this.user.capabilities)) ? this.user.capabilities : []
    },
    calendarEvents() {
      return homeEvents(this.recentBills, this.repairs)
    },
    activeRepair() {
      return this.repairs.find(r => !['COMPLETED', 'CANCELLED'].includes(r.status))
    },
    canViewContract() {
      return this.capabilities.includes('tenant.contract.read')
    },
    canViewBills() {
      return this.capabilities.includes('tenant.bill.read')
    },
    canViewRepairs() {
      return this.capabilities.includes('tenant.maintenance.read')
    },
    canOpenRepairs() {
      return this.canViewRepairs || this.capabilities.includes('tenant.maintenance.create')
    },
    visibleServices() {
      return this.services.filter(service => service.capability === 'tenant.maintenance.read'
        ? this.canOpenRepairs
        : this.capabilities.includes(service.capability))
    }
  },
  methods: {
    async loadData() {
      if (this.refreshing) return
      this.loading = true
      this.refreshing = true
      const sections = []

      if (this.canViewBills) {
        sections.push(['账单', async () => {
          const [calendar, ...pending] = await Promise.all([
            getMyBills({ page: 1, limit: 50 }),
            ...['PENDING', 'PARTIAL', 'OVERDUE'].map(status => getMyBills({ page: 1, limit: 1, status }))
          ])
          this.recentBills = calendar.data
          this.pendingBillsCount = pending.reduce((total, page) => total + page.meta.total, 0)
          this.pendingBillId = this.pendingBillsCount === 1 ? pending.flatMap(page => page.data)[0]?.id : ''
        }])
      }
      if (this.canViewRepairs) {
        sections.push(['报修', async () => {
          const response = await getMyMaintenance({ page: 1, limit: 20 })
          this.repairs = response.data
        }])
      }
      if (this.canViewContract) {
        sections.push(['居所', async () => {
          const { data: contracts } = await getMyContracts()
          const contract = contracts.find(item => item.status === 'ACTIVE')
          const room = contract?.room
          this.roomInfo = room ? `${room.building?.name || contract.building?.name || '我的居所'} · ${room.roomNumber}室` : ''
          this.myRoomPosition = room && Number.isFinite(room.floor)
            ? { id: room.id, roomNumber: String(room.roomNumber), floor: room.floor }
            : null
          this.landlordContact = getLandlordContact(this.user, contracts)
        }])
      }
      sections.push(['通知', async () => {
        const response = await getNotifications({ page: 1, limit: 3 })
        this.notices = response.data
        this.unreadCount = response.meta.unreadCount
      }])

      const results = await Promise.allSettled(sections.map(([, load]) => load()))
      this.failed = sections.filter((_, index) => results[index].status === 'rejected').map(([label]) => label)
      this.loading = false
      this.refreshing = false
    },
    repairStatus(status) {
      return {
        SUBMITTED: '已提交，等待受理',
        ACKNOWLEDGED: '物业已受理',
        ASSIGNED: '维修人员已安排',
        IN_PROGRESS: '维修处理中',
        PENDING_CONFIRM: '维修完成，待确认'
      }[status] || '查看报修进度'
    },
    openContact() {
      this.showContactModal = true
    },
    copyWechat() {
      copyToClipboard(this.landlordContact.wechat, '微信号')
    },
    openService(path, tab) {
      if (tab) uni.switchTab({ url: path })
      else uni.navigateTo({ url: path })
    },
    openEvent(event) {
      if (event.type === 'bill') this.openBill(event.recordId)
      else this.openRepair(event.recordId)
    },
    openBill(id) {
      uni.navigateTo({ url: `/packageA/bill-detail/bill-detail?id=${encodeURIComponent(id)}` })
    },
    openRepair(id) {
      uni.navigateTo({ url: `/packageA/maintenance/detail?id=${encodeURIComponent(id)}` })
    },
    goToContract() {
      uni.navigateTo({ url: '/packageA/contract/contract' })
    },
    openPendingBills() {
      if (this.pendingBillId) this.openBill(this.pendingBillId)
      else uni.switchTab({ url: '/pages/bills/bills' })
    },
    goToNotifications() {
      uni.navigateTo({ url: '/packageA/notifications/notifications' })
    },
  }
}
</script>

<style scoped>
.tenant-home { padding-bottom: 40rpx; }
.home-greeting { display: flex; align-items: center; justify-content: space-between; gap: 16rpx; }
.home-greeting .q-title { font-size: 52rpx; letter-spacing: -2.5rpx; font-weight: 600; }
.home-bell { position: relative; width: 74rpx; height: 74rpx; background: #fffefa; border-radius: 50%; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.unread-dot { position: absolute; right: 16rpx; top: 12rpx; width: 10rpx; height: 10rpx; border-radius: 50%; background: #ad735a; }
.home-room { display: flex; gap: 12rpx; align-items: center; font-size: 22rpx; color: #817e76; margin: 20rpx 0 30rpx; }
.home-room text:first-of-type { flex: 1; min-width: 0; }
.home-room text:last-child { font-size: 28rpx; }
.todo-surface { padding: 10rpx 32rpx; margin-bottom: 24rpx; }
.home-todo { display: flex; align-items: center; gap: 20rpx; padding: 24rpx 0; border-bottom: 1rpx solid #e9e6de; }
.home-todo:last-child { border: 0; }
.round-icon { width: 68rpx; height: 68rpx; display: flex; align-items: center; justify-content: center; border-radius: 50%; background: #ecf0e9; flex-shrink: 0; }
.round-icon.clay { background: #f8ece5; }
.todo-copy { flex: 1; min-width: 0; }
.todo-copy > text:first-child { display: block; font-size: 25rpx; font-weight: 550; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.todo-description { display: block; margin-top: 10rpx; font-size: 21rpx; color: #817e76; }
.q-arrow { font-size: 34rpx; color: #a49f95; }
.home-landlord-banner { display: flex; align-items: center; gap: 20rpx; padding: 22rpx 28rpx; margin-bottom: 30rpx; border-radius: 24rpx; background: #fdfcf9; border: 1rpx solid #ede8de; }
.banner-avatar { width: 72rpx; height: 72rpx; border-radius: 50%; background: #515c43; color: #fffefa; display: flex; align-items: center; justify-content: center; font-size: 28rpx; font-weight: 600; flex-shrink: 0; }
.banner-body { flex: 1; min-width: 0; }
.banner-title-line { display: flex; align-items: center; gap: 12rpx; }
.banner-title { font-size: 26rpx; font-weight: 600; color: #302f2a; }
.banner-time { font-size: 20rpx; color: #8c857b; }
.banner-sub { display: block; font-size: 21rpx; color: #8c857b; margin-top: 6rpx; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.banner-copy-btn { background: #2e7d32; color: #ffffff; font-size: 22rpx; font-weight: 550; height: 54rpx; line-height: 54rpx; padding: 0 20rpx; border-radius: 12rpx; border: none; margin: 0; flex-shrink: 0; }
.banner-copy-btn::after { border: none; }
.home-services { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 18rpx; }
.service { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 20rpx; background: #fffefa; border: 1rpx solid #e9e6de; border-radius: 28rpx; padding: 28rpx 0; font-size: 23rpx; }
.notice-surface { padding: 14rpx 30rpx; }
.home-notice { display: flex; align-items: center; gap: 18rpx; padding: 24rpx 0; border-bottom: 1rpx solid #e9e6de; }
.home-notice:last-child { border: 0; }
.notice-dot { width: 10rpx; height: 10rpx; border-radius: 50%; background: #ad735a; flex-shrink: 0; }
.notice-dot.read { background: #a49f95; }
.home-notice > view:nth-child(2) { flex: 1; min-width: 0; }
.notice-title { display: block; font-size: 24rpx; font-weight: 550; }
.notice-description { display: block; font-size: 21rpx; color: #817e76; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 10rpx; }
</style>
