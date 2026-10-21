<template>
  <view class="role-tabbar">
    <view
      v-for="item in items"
      :key="item.key"
      :class="['role-tab', { active: active === item.key }]"
      @tap="go(item)"
    >
      <QIcon :name="item.icon" :size="40" :active="active === item.key" />
      <text class="role-tab-label">{{ item.label }}</text>
    </view>
  </view>
</template>

<script>
import QIcon from './QIcon.vue'

const MAINTENANCE_ITEMS = [
  { key: 'home', label: '首页', icon: 'home', path: '/pages/maintenance/home' },
  { key: 'work', label: '工单', icon: 'repair', path: '/pages/maintenance/workbench' },
  { key: 'settings', label: '设置', icon: 'user', path: '/pages/maintenance/settings' },
]
const CLEANER_ITEMS = [
  { key: 'home', label: '首页', icon: 'home', path: '/pages/cleaning/home' },
  { key: 'work', label: '清洁', icon: 'check', path: '/pages/cleaning/cleaning' },
  { key: 'settings', label: '设置', icon: 'user', path: '/pages/cleaning/settings' },
]

export default {
  components: { QIcon },
  props: {
    active: { type: String, default: 'home' },
    variant: { type: String, default: 'maintenance' },
  },
  computed: {
    items() {
      return this.variant === 'cleaner' ? CLEANER_ITEMS : MAINTENANCE_ITEMS
    },
  },
  methods: {
    go(item) {
      if (item.key === this.active) return
      uni.reLaunch({ url: item.path })
    },
  },
}
</script>

<style scoped>
.role-tabbar {
  position: fixed;
  left: 50%;
  bottom: 0;
  z-index: 40;
  width: 100%;
  /* 与 pages.json 的 rpxCalcMaxDeviceWidth 保持一致：H5 宽屏时与内容区同宽居中 */
  max-width: 430px;
  box-sizing: border-box;
  transform: translateX(-50%);
  display: flex;
  align-items: flex-start;
  padding: 14rpx 24rpx calc(12rpx + env(safe-area-inset-bottom));
  background: #fffefa;
  border-top: 1rpx solid #e9e6de;
  box-shadow: 0 -8rpx 26rpx rgba(74, 62, 47, .04);
}
.role-tab {
  position: relative;
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6rpx;
  padding: 6rpx 0;
  color: #8e8a80;
  font-size: 20rpx;
  line-height: 1.4;
}
.role-tab.active { color: #4e5845; }
.role-tab-label { font-weight: 450; }
.role-tab.active .role-tab-label { font-weight: 550; }
</style>
