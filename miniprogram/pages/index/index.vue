<template>
  <view class="q-page page-with-tabbar home-page">
    <TenantHome v-if="user?.role === 'TENANT'" :key="tenantHomeKey" ref="home" :user="user" />
    <AdminHome v-else-if="isManager" :key="`${user.id}:${user.role}`" ref="home" />
    <view v-else-if="user" class="error-state">
      <text>当前角色请使用网页管理后台</text>
    </view>
    <view v-else-if="loading" class="loading-state">
      <text>加载中...</text>
    </view>
    <view v-else class="error-state">
      <text>{{ error }}</text>
      <button @tap="loadUser">重试</button>
    </view>
  </view>
</template>
<script>
import TenantHome from '../../components/home/TenantHome.vue'
import AdminHome from '../../components/home/AdminHome.vue'
import { getUserInfo } from '../../api/index.js'
import { isMaintenanceManager, openHome } from '../../utils/session.js'

export default {
  components: { TenantHome, AdminHome },
  data() {
    return { user: null, loading: true, refreshing: false, error: '' }
  },
  computed: {
    tenantHomeKey() {
      return JSON.stringify([this.user.id, this.user.capabilities])
    },
    isManager() {
      return isMaintenanceManager(this.user?.role)
    }
  },
  onShow() {
    this.loadUser()
  },
  async onPullDownRefresh() {
    try {
      await this.loadUser()
    } finally {
      uni.stopPullDownRefresh()
    }
  },
  methods: {
    async loadUser() {
      if (this.refreshing) return
      if (!uni.getStorageSync('access_token')) {
        this.user = null
        uni.reLaunch({ url: '/pages/login/login' })
        return
      }

      this.refreshing = true
      this.loading = !this.user
      this.error = ''
      try {
        const user = await getUserInfo()
        uni.setStorageSync('user_role', user.role)
        uni.setStorageSync('user_capabilities', Array.isArray(user.capabilities) ? user.capabilities : [])

        if (user.role === 'CLEANER') {
          this.user = null
          openHome(user.role)
          return
        }
        this.user = user
        if (user.role !== 'TENANT' && !isMaintenanceManager(user.role)) return

        await this.$nextTick()
        await this.$refs.home?.loadData()
      } catch {
        this.user = null
        this.error = '用户信息暂时未能加载，请检查连接'
      } finally {
        this.loading = false
        this.refreshing = false
      }
    }
  }
}
</script>
<style scoped>
.home-page {
  min-height: 100vh;
}

.loading-state,
.error-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 60vh;
  gap: 20rpx;
  color: #817e76;
}

.error-state button {
  margin-top: 20rpx;
  padding: 20rpx 40rpx;
  background: #4e5845;
  color: #fffefa;
  border-radius: 12rpx;
  border: none;
}

.error-state button::after {
  border: none;
}
</style>
