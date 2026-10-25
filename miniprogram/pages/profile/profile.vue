<template>
  <view class="q-page page-with-tabbar">
    <text class="q-eyebrow">MY SPACE / 我的生活</text>
    <text class="q-title">居住的小事，都在这里。</text>
    <view v-if="error" class="q-error" @tap="loadUserInfo">{{ error }} · 点此重试</view>

    <!-- 租客名片 -->
    <view class="profile-card q-surface">
      <view class="profile-avatar">{{ userInfo.name?.slice(0, 1) || '栖' }}</view>
      <view>
        <view class="profile-name-row">
          <text class="profile-name">{{ userInfo.name || '租客' }}</text>
          <text
            :class="['registration-badge', registrationStatusClass]"
            @tap="openRegistrationModal"
          >
            {{ registrationStatusText }}
          </text>
        </view>
        <text class="profile-phone">{{ maskedPhone || userEmail || '欢迎来到栖居' }}</text>
      </view>
      <text class="q-pill">{{ currentRoomTitle || '未绑定房源' }}</text>
    </view>

    <!-- 未绑定房源提示横幅 -->
    <view v-if="!currentRoomTitle" class="q-surface invite-banner">
      <view class="invite-banner-body">
        <text class="invite-banner-title">🔑 绑定房源邀请码</text>
        <text class="invite-banner-desc">已获得房源？输入管理员发放的邀请码，立即关联房间、合同与账单。</text>
      </view>
      <button class="invite-banner-btn" @tap="openBindModal">输入邀请码</button>
    </view>

    <!-- 租客自助中心聚合工作台 (LSE-05 / T297) -->
    <view class="q-section-heading">
      <text>租客自助中心</text>
      <text class="q-link" @tap="openRegistrationModal">实名档案 ›</text>
    </view>
    <view class="q-surface workbench-card">
      <view class="workbench-stats-grid">
        <view class="stat-cell" @tap="open('/pages/bills/bills')">
          <text class="stat-label">待缴费用</text>
          <text :class="['stat-value', { 'warn-text': overviewBills.pendingCount > 0 }]">
            {{ overviewBills.pendingCount > 0 ? `¥ ${overviewBills.pendingAmountYuan}` : '已结清' }}
          </text>
          <text class="stat-sub">{{ overviewBills.pendingCount > 0 ? `${overviewBills.pendingCount} 笔待缴` : '无需缴费' }}</text>
        </view>
        <view class="stat-cell" @tap="open('/packageA/account/account')">
          <text class="stat-label">预付余额</text>
          <text class="stat-value">¥ {{ overviewPrepay.balanceYuan || '0.00' }}</text>
          <text class="stat-sub">水电自动扣减</text>
        </view>
        <view class="stat-cell" @tap="open('/pages/maintenance/maintenance')">
          <text class="stat-label">在办报修</text>
          <text class="stat-value">{{ overviewMaintenance.activeCount > 0 ? `${overviewMaintenance.activeCount} 单` : '无' }}</text>
          <text class="stat-sub">{{ overviewMaintenance.activeCount > 0 ? '处理跟进中' : '设施运转良好' }}</text>
        </view>
        <view class="stat-cell" @tap="open('/packageA/contract/contract')">
          <text class="stat-label">生效合同</text>
          <text class="stat-value">
            {{ overviewContract?.daysRemaining !== null && overviewContract?.daysRemaining !== undefined ? `${overviewContract.daysRemaining} 天` : '有效' }}
          </text>
          <text class="stat-sub">{{ overviewContract ? '租期在约中' : '查看合同明细' }}</text>
        </view>
      </view>

      <view class="workbench-divider" />

      <!-- 自助快捷服务入口 (金刚区) -->
      <view class="workbench-actions-grid">
        <view class="action-item" @tap="openReceiptListModal">
          <view class="action-icon-circle action-receipt">📜</view>
          <text class="action-name">我的收据</text>
          <text class="action-hint">电子收据查验</text>
        </view>
        <view class="action-item" @tap="openVerifyModal">
          <view class="action-icon-circle action-verify">🔍</view>
          <text class="action-name">防伪验真</text>
          <text class="action-hint">收据单据真伪</text>
        </view>
        <view class="action-item" @tap="openRegistrationModal">
          <view class="action-icon-circle action-register">🪪</view>
          <text class="action-name">实名认证</text>
          <text class="action-hint">居住登记申报</text>
        </view>
        <view class="action-item" @tap="open('/pages/bills/bills')">
          <view class="action-icon-circle action-pay">💳</view>
          <text class="action-name">快捷缴费</text>
          <text class="action-hint">微信线上直缴</text>
        </view>
      </view>
    </view>

    <!-- 专属房东与管家联系卡片 -->
    <view class="q-section-heading">
      <text>专属管家与房东</text>
      <text class="q-link" @tap="showContact">联系详情 ›</text>
    </view>
    <view class="q-surface landlord-card">
      <view class="landlord-header">
        <view class="landlord-avatar">{{ landlordContact.name?.slice(0, 1) || '管' }}</view>
        <view class="landlord-meta">
          <view class="landlord-title-row">
            <text class="landlord-name">{{ landlordContact.name || '栖居管家' }}</text>
            <text class="landlord-role-tag">专属责任人</text>
          </view>
          <text class="landlord-room-sub">{{ landlordContact.roomTitle || '栖居居所生活服务' }}</text>
        </view>
      </view>

      <view class="landlord-items">
        <!-- 微信号 -->
        <view class="landlord-item-row">
          <view class="item-badge-wrap">
            <text class="item-tag wechat-tag">微信</text>
            <text class="item-value selectable" :selectable="true">{{ landlordContact.wechat }}</text>
          </view>
          <button class="pill-btn wechat-pill" @tap="copyWechat">复制微信号</button>
        </view>

        <!-- 电话号码 -->
        <view class="landlord-item-row">
          <view class="item-badge-wrap">
            <text class="item-tag phone-tag">电话</text>
            <text class="item-value selectable" :selectable="true">{{ landlordContact.formattedPhone || landlordContact.phone }}</text>
          </view>
          <view class="phone-btn-group">
            <button class="pill-btn call-pill" @tap="callLandlord">拨打</button>
            <button class="pill-btn copy-pill" @tap="copyPhone">复制</button>
          </view>
        </view>
      </view>

      <view class="landlord-card-footer">
        <text class="landlord-hours-text">⏰ 服务时间：{{ landlordContact.serviceHours }}</text>
        <text class="landlord-tip-text">设施紧急故障请直接拨打电话，日常沟通欢迎添加微信留言。</text>
      </view>
    </view>

    <!-- 居住服务 -->
    <view class="q-section-heading"><text>居住服务</text></view>
    <view class="q-surface profile-menu">
      <view class="profile-menu-item" @tap="openBindModal">
        <QIcon name="home" :size="36" />
        <text>房源与邀请码绑定</text>
        <text class="profile-subtext">{{ currentRoomTitle ? '已关联房源' : '待绑定' }}</text>
        <text class="profile-arrow">›</text>
      </view>
      <view v-for="item in visibleMenu" :key="item.label" class="profile-menu-item" @tap="open(item.path)">
        <QIcon :name="item.icon" :size="36" />
        <text>{{ item.label }}</text>
        <text v-if="item.icon === 'bell' && unreadCount" class="profile-badge">
          {{ unreadCount > 99 ? '99+' : unreadCount }}
        </text>
        <text class="profile-arrow">›</text>
      </view>
    </view>

    <!-- 帮助与账户 -->
    <view class="q-section-heading"><text>帮助与账户</text></view>
    <view class="q-surface profile-menu">
      <view class="profile-menu-item" @tap="showContact">
        <QIcon name="user" :size="36" />
        <text>联系管理者</text>
        <text class="profile-arrow">›</text>
      </view>
      <view class="profile-menu-item" @tap="showAbout">
        <QIcon name="home" :size="36" />
        <text>关于栖居</text>
        <text class="profile-arrow">›</text>
      </view>
    </view>

    <button class="q-outline profile-logout" @tap="logout">退出登录</button>
    <text class="q-note">栖居 · 让每一件小事，都有清楚的回应</text>

    <!-- 输入邀请码弹窗 -->
    <view v-if="showBindDialog" class="modal-overlay" @tap.self="showBindDialog = false">
      <view class="modal-card q-surface">
        <view class="modal-header">
          <text class="modal-title">绑定房源邀请码</text>
          <text class="modal-close" @tap="showBindDialog = false">✕</text>
        </view>
        <text class="modal-subtitle">请输入管理员或房东向您发放的房源邀请码：</text>
        <input 
          class="modal-input" 
          v-model="inputInviteCode" 
          placeholder="例如：INVITE-172895..." 
          placeholder-class="placeholder" 
        />
        <view class="modal-actions">
          <button class="modal-btn-cancel" @tap="showBindDialog = false">取消</button>
          <button 
            class="modal-btn-confirm" 
            :loading="bindLoading" 
            :disabled="bindLoading" 
            @tap="submitBindInvite"
          >
            确认绑定
          </button>
        </view>
      </view>
    </view>

    <!-- 我的收据列表弹窗 (LSE-05 / T297) -->
    <view v-if="showReceiptListModal" class="modal-overlay" @tap.self="showReceiptListModal = false">
      <view class="receipt-list-modal-card q-surface">
        <view class="modal-header">
          <text class="modal-title">我的官方电子收据</text>
          <text class="modal-close" @tap="showReceiptListModal = false">✕</text>
        </view>
        <view v-if="loadingReceipts" class="modal-loading-text">正在查询收据记录…</view>
        <view v-else-if="!receiptList.length" class="modal-empty-box">
          <text class="modal-empty-title">暂无已出具电子收据</text>
          <text class="modal-empty-sub">缴纳账单后，系统将自动开具带防伪校验码的官方收据。</text>
        </view>
        <scroll-view v-else scroll-y class="receipt-modal-scroll">
          <view v-for="item in receiptList" :key="item.paymentId" class="receipt-list-item">
            <view class="rli-header">
              <text class="rli-no">#{{ item.receiptNumber }}</text>
              <text :class="['q-pill', item.isVoided ? 'danger' : '']">
                {{ item.isVoided ? '已作废' : '官方有效' }}
              </text>
            </view>
            <view class="rli-body">
              <view class="rli-row"><text class="rli-k">账期类别</text><text class="rli-v">{{ item.period }} · {{ item.billTypeLabel }}</text></view>
              <view class="rli-row"><text class="rli-k">房源信息</text><text class="rli-v">{{ item.buildingName }} {{ item.roomNumber }}</text></view>
              <view class="rli-row"><text class="rli-k">实收金额</text><text class="rli-v rli-money">¥ {{ item.amountYuan }}</text></view>
              <view class="rli-row"><text class="rli-k">入账时间</text><text class="rli-v">{{ item.paidAt ? item.paidAt.slice(0, 16).replace('T', ' ') : '—' }}</text></view>
              <view class="rli-row"><text class="rli-k">防伪验证码</text><text class="rli-v mono-text">{{ item.verifyCode }}</text></view>
            </view>
            <view class="rli-actions">
              <button class="pill-btn copy-pill" @tap="handleDownloadReceiptPdf(item.receiptNumber)">📥 PDF 预览</button>
              <button class="pill-btn call-pill" @tap="quickVerify(item.receiptNumber, item.verifyCode)">🔍 防伪验真</button>
            </view>
          </view>
        </scroll-view>
      </view>
    </view>

    <!-- 防伪验真工具弹窗 (LSE-05 / T297) -->
    <view v-if="showVerifyModal" class="modal-overlay" @tap.self="showVerifyModal = false">
      <view class="verify-modal-card q-surface">
        <view class="modal-header">
          <text class="modal-title">电子收据防伪验真</text>
          <text class="modal-close" @tap="showVerifyModal = false">✕</text>
        </view>
        <text class="modal-subtitle">输入收据编号与防伪校验码，即时在线核验凭单真实有效性：</text>
        <view class="input-with-scan">
          <input
            class="modal-input"
            v-model="verifyReceiptNumber"
            placeholder="收据编号，例如 R20261025..."
            placeholder-class="placeholder"
          />
          <button class="scan-btn" @tap="handleScanReceiptQr">扫码</button>
        </view>
        <input
          class="modal-input"
          v-model="verifyCode"
          placeholder="防伪校验码 (可选)"
          placeholder-class="placeholder"
        />
        <button
          class="modal-btn-confirm full-width-btn"
          :loading="verifying"
          @tap="executeVerify"
        >
          立即在线验真
        </button>

        <!-- 验真结果展示卡片 -->
        <view v-if="verifyResult" :class="['verify-result-card', verifyResult.isValid ? 'vr-valid' : 'vr-invalid']">
          <view class="vr-badge-row">
            <text :class="['q-pill', verifyResult.isVoided ? 'danger' : '']">
              {{ verifyResult.isVoided ? '⚠️ 该收据已作废' : '✅ 官方真实收据' }}
            </text>
            <text class="vr-cert-label">栖居防伪认证</text>
          </view>
          <view class="vr-detail-row"><text>收据单号</text><text class="mono-text">{{ verifyResult.receiptNumber }}</text></view>
          <view class="vr-detail-row"><text>承租租客</text><text>{{ verifyResult.tenantName }}</text></view>
          <view class="vr-detail-row"><text>承租房源</text><text>{{ verifyResult.buildingName }} {{ verifyResult.roomNumber }}</text></view>
          <view class="vr-detail-row"><text>实收金额</text><text class="receipt-money">¥ {{ verifyResult.amountYuan }}</text></view>
          <view class="vr-detail-row"><text>大写金额</text><text class="chinese-uppercase">{{ verifyResult.amountInChinese }}</text></view>
          <view class="vr-detail-row"><text>出据时间</text><text>{{ verifyResult.paidAt ? verifyResult.paidAt.slice(0, 19).replace('T', ' ') : '—' }}</text></view>
          <view v-if="verifyResult.isVoided" class="vr-detail-row"><text>作废说明</text><text class="danger-text">{{ verifyResult.voidReason }}</text></view>
        </view>
      </view>
    </view>

    <!-- 租客实名认证登记弹窗 (SEC-08 / LSE-05 / T297) -->
    <view v-if="showRegistrationModal" class="modal-overlay" @tap.self="showRegistrationModal = false">
      <view class="registration-modal-card q-surface">
        <view class="modal-header">
          <text class="modal-title">实名认证与个资登记</text>
          <text class="modal-close" @tap="showRegistrationModal = false">✕</text>
        </view>

        <!-- 状态已认证提示 -->
        <view v-if="registrationData?.status === 'REGISTERED'" class="reg-state-box reg-state-ok">
          <text class="reg-state-title">✅ 已完成实名认证</text>
          <text class="reg-state-sub">您的居住登记已通过管家核验。根据数据合规策略，证件号全程执行 AES-256 加密保护。</text>
          <view class="reg-info-row"><text>证件类型</text><text>{{ formatIdType(registrationData.idType) }}</text></view>
          <view class="reg-info-row"><text>证件号码</text><text class="mono-text">{{ registrationData.idNumberMasked }}</text></view>
          <text class="reg-tip-small">如需变更实名信息，请联系专属管家办理线下核验与变更。</text>
        </view>

        <!-- 状态审核中提示 -->
        <view v-else-if="registrationData?.status === 'PENDING'" class="reg-state-box reg-state-pending">
          <text class="reg-state-title">⏳ 实名认证审核中</text>
          <text class="reg-state-sub">您提交的实名信息已送至管家审核，核实完成后将自动生效。</text>
          <view class="reg-info-row"><text>证件类型</text><text>{{ formatIdType(registrationData.idType) }}</text></view>
          <view class="reg-info-row"><text>证件号码</text><text class="mono-text">{{ registrationData.idNumberMasked }}</text></view>
        </view>

        <!-- 未登记或审核未通过表单 -->
        <view v-else class="reg-form-wrap">
          <text class="modal-subtitle">根据房屋管理法规与安全规范，请完善承租人真实身份信息：</text>
          <view class="form-row">
            <text class="form-label">真实姓名</text>
            <input class="modal-input" v-model="regForm.realName" placeholder="承租人真实姓名" />
          </view>
          <view class="form-row">
            <text class="form-label">证件类型</text>
            <picker :range="idTypeOptions" range-key="label" :value="selectedIdTypeIndex" @change="onIdTypeChange">
              <view class="picker-input">{{ idTypeOptions[selectedIdTypeIndex]?.label || '请选择证件类型' }}</view>
            </picker>
          </view>
          <view class="form-row">
            <text class="form-label">证件号码</text>
            <input class="modal-input" v-model="regForm.idNumber" placeholder="请输入身份证或护照号" />
          </view>
          <view class="form-row">
            <text class="form-label">紧急联系人 (选填)</text>
            <input class="modal-input" v-model="regForm.emergencyContact" placeholder="亲属或紧急联系人姓名" />
          </view>
          <view class="form-row">
            <text class="form-label">紧急联系电话 (选填)</text>
            <input class="modal-input" v-model="regForm.emergencyPhone" placeholder="紧急联系电话" />
          </view>
          <button
            class="modal-btn-confirm full-width-btn"
            :loading="submittingReg"
            @tap="submitRegistration"
          >
            提交实名认证
          </button>
        </view>
      </view>
    </view>

    <!-- 房东/管家联系卡片弹窗 -->
    <ContactCardModal
      :visible="showContactModal"
      :contact="landlordContact"
      @close="showContactModal = false"
    />
  </view>
</template>

<script>
import QIcon from '../../components/QIcon.vue'
import ContactCardModal from '../../components/ContactCardModal.vue'
import {
  getUserInfo,
  getUnreadCount,
  bindInviteCode,
  getMyOverview,
  getMyReceipts,
  verifyReceipt,
  downloadReceiptPdf,
  getMyRegistration,
  submitMyRegistration,
} from '../../api/index.js'
import { logoutSession, openHome } from '../../utils/session.js'
import { getLandlordContact, copyToClipboard, makePhoneCall } from '../../utils/contact.js'

export default {
  components: { QIcon, ContactCardModal },
  data() {
    return {
      userInfo: {},
      rawUser: {},
      userEmail: '',
      unreadCount: 0,
      showBindDialog: false,
      inputInviteCode: '',
      bindLoading: false,
      showContactModal: false,
      error: '',
      landlordContact: getLandlordContact({}, []),
      capabilities: uni.getStorageSync('user_capabilities') || [],
      overviewData: null,
      showReceiptListModal: false,
      loadingReceipts: false,
      receiptList: [],
      showVerifyModal: false,
      verifying: false,
      verifyReceiptNumber: '',
      verifyCode: '',
      verifyResult: null,
      showRegistrationModal: false,
      registrationData: null,
      submittingReg: false,
      idTypeOptions: [
        { key: 'ID_CARD', label: '居民身份证' },
        { key: 'PASSPORT', label: '护照' },
        { key: 'OTHER', label: '港澳台/其他有效证件' },
      ],
      selectedIdTypeIndex: 0,
      regForm: {
        realName: '',
        idType: 'ID_CARD',
        idNumber: '',
        emergencyContact: '',
        emergencyPhone: '',
      },
      menu: [
        { label: '通知提醒', icon: 'bell', path: '/packageA/notifications/notifications' },
        { label: '我的合同', icon: 'contract', path: '/packageA/contract/contract', capability: 'tenant.contract.read' },
        { label: '账户余额', icon: 'wallet', path: '/packageA/account/account', capability: 'tenant.prepay.read' },
      ],
    }
  },
  computed: {
    visibleMenu() {
      if (!Array.isArray(this.capabilities)) {
        return this.menu.filter((item) => !item.capability)
      }
      return this.menu.filter(
        (item) => !item.capability || this.capabilities.includes(item.capability),
      )
    },
    maskedPhone() {
      const p = this.userInfo.phone || ''
      if (p.startsWith('pending-')) return ''
      return /^\d{11}$/.test(p) ? `${p.slice(0, 3)}****${p.slice(-4)}` : p
    },
    currentRoomTitle() {
      const contracts = this.userInfo.contracts || []
      const active = contracts[0]
      if (active && active.room) {
        const b = active.room.building?.name || ''
        const r = active.room.roomNumber || ''
        return `${b} ${r}室`.trim()
      }
      if (this.rawUser?.invitedBy) {
        return '已绑定邀请'
      }
      return ''
    },
    overviewBills() {
      return this.overviewData?.bills || { pendingCount: 0, pendingAmount: 0, pendingAmountYuan: '0.00' }
    },
    overviewPrepay() {
      return this.overviewData?.prepay || { hasAccount: false, balance: 0, balanceYuan: '0.00' }
    },
    overviewMaintenance() {
      return this.overviewData?.maintenance || { activeCount: 0, latestItem: null }
    },
    overviewContract() {
      return this.overviewData?.contract || null
    },
    registrationStatusText() {
      const st = this.overviewData?.registration?.status
      if (st === 'REGISTERED') return '已实名'
      if (st === 'PENDING') return '实名审核中'
      if (st === 'REJECTED') return '实名未通过'
      return '待实名'
    },
    registrationStatusClass() {
      const st = this.overviewData?.registration?.status
      if (st === 'REGISTERED') return 'reg-ok'
      if (st === 'PENDING') return 'reg-pending'
      if (st === 'REJECTED') return 'reg-rejected'
      return 'reg-none'
    },
  },
  onShow() {
    this.loadUserInfo()
  },
  methods: {
    async loadUserInfo() {
      if (!uni.getStorageSync('access_token')) {
        uni.reLaunch({ url: '/pages/login/login' })
        return
      }
      this.error = ''
      try {
        const user = await getUserInfo()
        uni.setStorageSync('user_role', user.role)
        if (user.role === 'CLEANER') {
          openHome(user.role)
          return
        }
        this.rawUser = user
        this.userEmail = user.email || ''
        this.userInfo = user.tenant || {}
        this.capabilities = user.capabilities || []
        uni.setStorageSync('user_capabilities', this.capabilities)
        this.landlordContact = getLandlordContact(user, this.userInfo.contracts || [])

        // 仅在租客身份下加载自助中心总览数据与未读通知
        try {
          const [overviewRes, unreadRes] = await Promise.all([
            getMyOverview(),
            getUnreadCount(),
          ])
          this.overviewData = overviewRes
          this.registrationData = overviewRes?.registration || null
          this.unreadCount = unreadRes?.unreadCount || 0
        } catch (subErr) {
          // 自助数据拉取失败不影响个人中心基本展示
        }
      } catch (error) {
        console.error('个人信息加载失败', error)
        this.error = '居住信息暂时未能加载，请检查连接'
        this.capabilities = null
      }
    },
    open(path) {
      uni.navigateTo({ url: path })
    },
    openBindModal() {
      this.inputInviteCode = ''
      this.showBindDialog = true
    },
    async submitBindInvite() {
      const code = (this.inputInviteCode || '').trim()
      if (!code) {
        uni.showToast({ title: '请输入邀请码', icon: 'none' })
        return
      }

      this.bindLoading = true
      try {
        const res = await bindInviteCode({ inviteCode: code })
        uni.showToast({
          title: res.message || '绑定成功！',
          icon: 'success',
        })
        this.showBindDialog = false
        this.inputInviteCode = ''
        await this.loadUserInfo()
      } catch (err) {
        const msg = err.message || (err.data && err.data.message) || '邀请码无效或已过期'
        uni.showToast({ title: msg, icon: 'none' })
      } finally {
        this.bindLoading = false
      }
    },
    async openReceiptListModal() {
      this.showReceiptListModal = true
      this.loadingReceipts = true
      try {
        this.receiptList = await getMyReceipts()
      } catch (err) {
        uni.showToast({ title: err?.message || '获取收据记录失败', icon: 'none' })
      } finally {
        this.loadingReceipts = false
      }
    },
    async handleDownloadReceiptPdf(receiptNumber) {
      uni.showLoading({ title: '正在导出 PDF…' })
      try {
        await downloadReceiptPdf(receiptNumber)
        uni.showToast({ title: '已打开电子收据', icon: 'success' })
      } catch (err) {
        uni.showToast({ title: err?.message || '下载收据失败', icon: 'none' })
      } finally {
        uni.hideLoading()
      }
    },
    openVerifyModal() {
      this.showVerifyModal = true
    },
    quickVerify(receiptNumber, code) {
      this.showReceiptListModal = false
      this.showVerifyModal = true
      this.verifyReceiptNumber = receiptNumber
      this.verifyCode = code || ''
      this.executeVerify()
    },
    handleScanReceiptQr() {
      if (typeof uni === 'undefined' || !uni.scanCode) return
      uni.scanCode({
        success: (res) => {
          const result = res.result || ''
          const match = result.match(/receipts\/([A-Za-z0-9_-]+)/)
          if (match) {
            this.verifyReceiptNumber = decodeURIComponent(match[1])
            const codeMatch = result.match(/code=([A-Za-z0-9_-]+)/)
            if (codeMatch) {
              this.verifyCode = codeMatch[1]
            }
            this.executeVerify()
          } else {
            this.verifyReceiptNumber = result
          }
        },
      })
    },
    async executeVerify() {
      const num = (this.verifyReceiptNumber || '').trim()
      if (!num) {
        uni.showToast({ title: '请输入收据编号', icon: 'none' })
        return
      }
      this.verifying = true
      this.verifyResult = null
      uni.showLoading({ title: '正在核验证真…' })
      try {
        this.verifyResult = await verifyReceipt(num, (this.verifyCode || '').trim())
      } catch (err) {
        uni.showToast({ title: err?.message || '查验未通过或收据不存在', icon: 'none' })
      } finally {
        this.verifying = false
        uni.hideLoading()
      }
    },
    async openRegistrationModal() {
      this.showRegistrationModal = true
      try {
        const reg = await getMyRegistration()
        this.registrationData = reg
        if (this.userInfo?.name) {
          this.regForm.realName = this.userInfo.name
        }
      } catch (e) {
        // 获取失败保留旧数据
      }
    },
    onIdTypeChange(e) {
      this.selectedIdTypeIndex = e.detail.value
      this.regForm.idType = this.idTypeOptions[this.selectedIdTypeIndex].key
    },
    formatIdType(type) {
      return { ID_CARD: '居民身份证', PASSPORT: '护照', OTHER: '港澳台/其他有效证件' }[type] || type || '—'
    },
    async submitRegistration() {
      if (!this.regForm.idNumber || this.regForm.idNumber.trim().length < 4) {
        uni.showToast({ title: '请输入有效的证件号码', icon: 'none' })
        return
      }
      this.submittingReg = true
      uni.showLoading({ title: '正在提交认证…' })
      try {
        const res = await submitMyRegistration({
          idType: this.regForm.idType,
          idNumber: this.regForm.idNumber.trim(),
          realName: (this.regForm.realName || '').trim() || undefined,
          emergencyContact: (this.regForm.emergencyContact || '').trim() || undefined,
          emergencyPhone: (this.regForm.emergencyPhone || '').trim() || undefined,
        })
        uni.showToast({ title: res.message || '实名认证已提交', icon: 'success' })
        this.registrationData = res.registration
        if (this.overviewData) {
          this.overviewData.registration = res.registration
        }
        await this.loadUserInfo()
      } catch (err) {
        uni.showToast({ title: err?.message || '提交实名认证失败', icon: 'none' })
      } finally {
        this.submittingReg = false
        uni.hideLoading()
      }
    },
    showContact() {
      this.showContactModal = true
    },
    copyWechat() {
      copyToClipboard(this.landlordContact.wechat, '微信号')
    },
    copyPhone() {
      copyToClipboard(this.landlordContact.phone, '电话号码')
    },
    callLandlord() {
      makePhoneCall(this.landlordContact.phone)
    },
    showAbout() {
      uni.showModal({
        title: '关于栖居',
        content: '栖居 · 租客生活服务\n账单、合同、报修与通知，妥善照顾居住中的每一件小事。',
        showCancel: false,
      })
    },
    logout() {
      uni.showModal({
        title: '退出登录',
        content: '确认退出当前账户吗？',
        success: (res) => {
          if (res.confirm) {
            logoutSession()
            uni.reLaunch({ url: '/pages/login/login' })
          }
        },
      })
    },
  },
}
</script>

<style scoped>
.profile-card {
  display: flex;
  align-items: center;
  gap: 24rpx;
  margin-top: 38rpx;
}

.profile-avatar {
  height: 92rpx;
  width: 92rpx;
  background: #e8e5da;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 34rpx;
  color: #68715b;
  flex-shrink: 0;
}

.profile-card > view:nth-child(2) {
  flex: 1;
  min-width: 0;
}

.profile-name-row {
  display: flex;
  align-items: center;
  gap: 12rpx;
}

.profile-name {
  font-size: 30rpx;
  font-weight: 550;
  overflow-wrap: anywhere;
}

.registration-badge {
  font-size: 19rpx;
  padding: 2rpx 10rpx;
  border-radius: 8rpx;
  font-weight: 600;
}
.reg-ok {
  background: #e6f4ea;
  color: #137333;
}
.reg-pending {
  background: #fef7e0;
  color: #b06000;
}
.reg-rejected {
  background: #fce8e6;
  color: #c5221f;
}
.reg-none {
  background: #f1ede4;
  color: #7d7567;
}

.profile-phone {
  display: block;
  color: #a49f95;
  font-size: 22rpx;
  margin-top: 12rpx;
}

/* 租客自助中心工作台卡片 */
.workbench-card {
  padding: 28rpx;
  border-radius: 24rpx;
  margin-top: 12rpx;
  background: #ffffff;
  border: 1rpx solid #ede8de;
}
.workbench-stats-grid {
  display: flex;
  justify-content: space-between;
}
.stat-cell {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}
.stat-label {
  font-size: 21rpx;
  color: #8c857b;
  margin-bottom: 6rpx;
}
.stat-value {
  font-size: 26rpx;
  font-weight: 700;
  color: #272320;
}
.stat-cell .warn-text {
  color: #c04928;
}
.stat-sub {
  font-size: 19rpx;
  color: #a49f95;
  margin-top: 4rpx;
}
.workbench-divider {
  height: 1rpx;
  background: #f1ede4;
  margin: 22rpx 0;
}
.workbench-actions-grid {
  display: flex;
  justify-content: space-around;
}
.action-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}
.action-icon-circle {
  width: 72rpx;
  height: 72rpx;
  border-radius: 20rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 32rpx;
  margin-bottom: 10rpx;
}
.action-receipt { background: #fbf3e6; }
.action-verify { background: #eaf3fd; }
.action-register { background: #edf7ed; }
.action-pay { background: #f4ecfc; }
.action-name {
  font-size: 23rpx;
  font-weight: 600;
  color: #302f2a;
}
.action-hint {
  font-size: 18rpx;
  color: #9c9589;
  margin-top: 2rpx;
}

.invite-banner {
  margin-top: 24rpx;
  padding: 24rpx 28rpx;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20rpx;
  background: #fdfaf3;
  border: 1rpx solid #eedec9;
  border-radius: 20rpx;
}

.invite-banner-body {
  flex: 1;
}

.invite-banner-title {
  display: block;
  font-size: 26rpx;
  font-weight: bold;
  color: #8f603c;
  margin-bottom: 6rpx;
}

.invite-banner-desc {
  display: block;
  font-size: 21rpx;
  color: #8c857b;
  line-height: 1.4;
}

.invite-banner-btn {
  background: #8f603c;
  color: #ffffff;
  font-size: 24rpx;
  font-weight: 550;
  padding: 0 24rpx;
  height: 64rpx;
  line-height: 64rpx;
  border-radius: 12rpx;
  border: none;
  white-space: nowrap;
  flex-shrink: 0;
  margin: 0;
}

.invite-banner-btn::after {
  border: none;
}

.profile-menu {
  padding: 8rpx 32rpx;
}

.profile-menu-item {
  display: flex;
  align-items: center;
  gap: 22rpx;
  padding: 28rpx 0;
  border-bottom: 1rpx solid #e9e6de;
  font-size: 25rpx;
}

.profile-menu-item:last-child {
  border: 0;
}

.profile-subtext {
  margin-left: auto;
  color: #8c857b;
  font-size: 22rpx;
}

.profile-arrow {
  margin-left: 12rpx;
  color: #a49f95;
  font-size: 34rpx;
}

.profile-badge {
  background: #ad735a;
  color: white;
  font-size: 20rpx;
  padding: 3rpx 12rpx;
  border-radius: 10rpx;
}

.profile-logout {
  margin-top: 40rpx;
  color: #ad735a;
  border-color: #e2cfc2;
}

/* 弹窗通用样式 */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 999;
  padding: 30rpx;
}

.modal-card,
.verify-modal-card,
.registration-modal-card,
.receipt-list-modal-card {
  width: 100%;
  max-width: 620rpx;
  background: #fffefa;
  border-radius: 28rpx;
  padding: 36rpx 32rpx;
  box-shadow: 0 10rpx 30rpx rgba(0, 0, 0, 0.15);
  max-height: 85vh;
  box-sizing: border-box;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20rpx;
}

.modal-title {
  font-size: 30rpx;
  font-weight: bold;
  color: #302f2a;
}

.modal-close {
  font-size: 32rpx;
  color: #999;
  padding: 0 10rpx;
  cursor: pointer;
}

.modal-subtitle {
  font-size: 24rpx;
  color: #817e76;
  margin-bottom: 24rpx;
  display: block;
  line-height: 1.5;
}

.modal-input {
  width: 100%;
  height: 84rpx;
  background: #f7f5f0;
  border: 1rpx solid #e5e0d8;
  border-radius: 12rpx;
  padding: 0 20rpx;
  font-size: 26rpx;
  color: #302f2a;
  box-sizing: border-box;
  margin-bottom: 24rpx;
}

.picker-input {
  width: 100%;
  height: 84rpx;
  line-height: 84rpx;
  background: #f7f5f0;
  border: 1rpx solid #e5e0d8;
  border-radius: 12rpx;
  padding: 0 20rpx;
  font-size: 26rpx;
  color: #302f2a;
  box-sizing: border-box;
  margin-bottom: 24rpx;
}

.modal-actions {
  display: flex;
  gap: 16rpx;
}

.modal-btn-cancel {
  flex: 1;
  height: 76rpx;
  line-height: 76rpx;
  background: #f0ece3;
  color: #666;
  font-size: 26rpx;
  border-radius: 12rpx;
  border: none;
}

.modal-btn-confirm {
  flex: 1;
  height: 76rpx;
  line-height: 76rpx;
  background: #68715b;
  color: #ffffff;
  font-size: 26rpx;
  font-weight: 550;
  border-radius: 12rpx;
  border: none;
}
.full-width-btn {
  width: 100%;
  margin-top: 8rpx;
}

/* 收据列表弹窗 */
.receipt-modal-scroll {
  max-height: 60vh;
  margin-top: 12rpx;
}
.modal-loading-text,
.modal-empty-box {
  text-align: center;
  padding: 40rpx 0;
  color: #8c857b;
}
.modal-empty-title {
  display: block;
  font-size: 26rpx;
  font-weight: 600;
  color: #302f2a;
  margin-bottom: 8rpx;
}
.modal-empty-sub {
  font-size: 22rpx;
  color: #9c9589;
}
.receipt-list-item {
  background: #fcfbf8;
  border: 1rpx solid #eee9e0;
  border-radius: 16rpx;
  padding: 20rpx;
  margin-bottom: 16rpx;
}
.rli-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1rpx solid #f1ece4;
  padding-bottom: 12rpx;
  margin-bottom: 12rpx;
}
.rli-no {
  font-size: 24rpx;
  font-family: monospace;
  font-weight: 600;
  color: #272320;
}
.rli-body {
  font-size: 22rpx;
}
.rli-row {
  display: flex;
  justify-content: space-between;
  margin-bottom: 8rpx;
}
.rli-k { color: #8c857b; }
.rli-v { color: #272320; }
.rli-money { font-weight: 700; color: #137333; }
.rli-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12rpx;
  margin-top: 12rpx;
  padding-top: 10rpx;
  border-top: 1rpx dashed #eee9e0;
}

/* 验真工具弹窗 */
.input-with-scan {
  display: flex;
  gap: 12rpx;
}
.input-with-scan .modal-input {
  flex: 1;
}
.scan-btn {
  height: 84rpx;
  line-height: 84rpx;
  padding: 0 24rpx;
  background: #ede8df;
  color: #515c43;
  font-size: 24rpx;
  font-weight: 600;
  border-radius: 12rpx;
  border: none;
}
.verify-result-card {
  margin-top: 24rpx;
  padding: 20rpx;
  border-radius: 14rpx;
}
.vr-valid {
  background: #f4fbf5;
  border: 1rpx solid #c9ebd0;
}
.vr-invalid {
  background: #fef7f7;
  border: 1rpx solid #f8d5d4;
}
.vr-badge-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 14rpx;
}
.vr-cert-label {
  font-size: 20rpx;
  color: #515c43;
  font-weight: 600;
}
.vr-detail-row {
  display: flex;
  justify-content: space-between;
  font-size: 22rpx;
  margin-bottom: 8rpx;
}
.receipt-money {
  font-size: 26rpx;
  font-weight: 700;
  color: #272320;
}
.chinese-uppercase {
  font-size: 22rpx;
  color: #6a6459;
}
.danger-text { color: #c5221f; }

/* 实名认证登记弹窗 */
.reg-state-box {
  padding: 24rpx;
  border-radius: 16rpx;
}
.reg-state-ok {
  background: #f2f9f3;
  border: 1rpx solid #cfead4;
}
.reg-state-pending {
  background: #fef9e8;
  border: 1rpx solid #f8e8b0;
}
.reg-state-title {
  display: block;
  font-size: 28rpx;
  font-weight: 700;
  margin-bottom: 8rpx;
  color: #272320;
}
.reg-state-sub {
  display: block;
  font-size: 22rpx;
  color: #6f685c;
  line-height: 1.5;
  margin-bottom: 16rpx;
}
.reg-info-row {
  display: flex;
  justify-content: space-between;
  font-size: 24rpx;
  padding: 10rpx 0;
  border-bottom: 1rpx solid rgba(0, 0, 0, 0.05);
}
.reg-tip-small {
  display: block;
  font-size: 20rpx;
  color: #9c9589;
  margin-top: 16rpx;
}
.form-row {
  margin-bottom: 8rpx;
}
.form-label {
  display: block;
  font-size: 22rpx;
  color: #7d7567;
  margin-bottom: 6rpx;
}
.mono-text {
  font-family: monospace;
}

/* 专属管家与房东名片样式 */
.landlord-card {
  padding: 32rpx;
  margin-top: 12rpx;
  border-radius: 28rpx;
  background: #fffefa;
  border: 1rpx solid #eedec9;
}

.landlord-header {
  display: flex;
  align-items: center;
  gap: 22rpx;
  margin-bottom: 26rpx;
}

.landlord-avatar {
  width: 80rpx;
  height: 80rpx;
  border-radius: 50%;
  background: #515c43;
  color: #fffefa;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 32rpx;
  font-weight: 600;
  flex-shrink: 0;
}

.landlord-meta {
  flex: 1;
  min-width: 0;
}

.landlord-title-row {
  display: flex;
  align-items: center;
  gap: 12rpx;
}

.landlord-name {
  font-size: 30rpx;
  font-weight: 600;
  color: #302f2a;
}

.landlord-role-tag {
  font-size: 20rpx;
  color: #515c43;
  background: #ecf0e9;
  padding: 2rpx 12rpx;
  border-radius: 10rpx;
}

.landlord-room-sub {
  display: block;
  font-size: 22rpx;
  color: #8c857b;
  margin-top: 6rpx;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.landlord-items {
  display: flex;
  flex-direction: column;
  gap: 16rpx;
}

.landlord-item-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: #fbf9f4;
  border: 1rpx solid #ede8de;
  border-radius: 18rpx;
  padding: 18rpx 22rpx;
  gap: 12rpx;
}

.item-badge-wrap {
  display: flex;
  align-items: center;
  gap: 16rpx;
  flex: 1;
  min-width: 0;
}

.item-tag {
  font-size: 20rpx;
  padding: 4rpx 12rpx;
  border-radius: 10rpx;
  font-weight: 600;
  flex-shrink: 0;
}

.wechat-tag {
  background: #e8f5e9;
  color: #2e7d32;
}

.phone-tag {
  background: #eef2eb;
  color: #515c43;
}

.item-value {
  font-size: 26rpx;
  font-weight: 600;
  color: #302f2a;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pill-btn {
  font-size: 22rpx;
  font-weight: 550;
  height: 56rpx;
  line-height: 56rpx;
  padding: 0 20rpx;
  border-radius: 14rpx;
  border: none;
  margin: 0;
  flex-shrink: 0;
}

.pill-btn::after {
  border: none;
}

.wechat-pill {
  background: #2e7d32;
  color: #ffffff;
}

.phone-btn-group {
  display: flex;
  gap: 10rpx;
  flex-shrink: 0;
}

.call-pill {
  background: #515c43;
  color: #ffffff;
}

.copy-pill {
  background: #ece8df;
  color: #68715b;
}

.landlord-card-footer {
  margin-top: 22rpx;
  padding-top: 18rpx;
  border-top: 1rpx dashed #ede8de;
  display: flex;
  flex-direction: column;
  gap: 8rpx;
}

.landlord-hours-text {
  font-size: 21rpx;
  color: #8c857b;
}

.landlord-tip-text {
  font-size: 20rpx;
  color: #a49f95;
  line-height: 1.4;
}
</style>
