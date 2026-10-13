/**
 * 主题切换组件
 * 显示主题选择器
 */
<template>
  <view class="theme-selector">
    <!-- 主题列表 -->
    <view class="theme-list">
      <view
        v-for="item in themeList"
        :key="item.name"
        :class="['theme-item', { active: currentTheme === item.name }]"
        @tap="selectTheme(item.name)"
      >
        <view class="theme-icon">{{ item.icon }}</view>
        <view class="theme-info">
          <text class="theme-label">{{ item.label }}</text>
          <text class="theme-desc">{{ item.description }}</text>
        </view>
        <view class="theme-preview" :style="{ backgroundColor: item.preview }"></view>
        <view v-if="currentTheme === item.name" class="theme-check">✓</view>
      </view>
    </view>

    <!-- 夜间模式开关 -->
    <view class="dark-mode-toggle">
      <view class="toggle-info">
        <text class="toggle-icon">🌙</text>
        <view class="toggle-text">
          <text class="toggle-label">夜间模式</text>
          <text class="toggle-desc">降低屏幕亮度，保护视力</text>
        </view>
      </view>
      <switch
        :checked="isDarkMode"
        @change="toggleDarkMode"
        color="#1677ff"
      />
    </view>

    <!-- 预览提示 -->
    <view class="preview-tip">
      <text>💡 切换主题后立即生效</text>
    </view>
  </view>
</template>

<script>
import { themeList } from '../theme/tokens.js'
import { themeState, toggleDarkMode, setTheme } from '../utils/theme.js'

export default {
  name: 'ThemeSelector',

  data() {
    return {
      themeList,
    }
  },

  computed: {
    // 直接读取模块级响应式状态，保证跨组件同步
    currentTheme() {
      return themeState.currentTheme
    },

    isDarkMode() {
      return themeState.isDarkMode
    },
  },

  methods: {
    // 选择主题
    selectTheme(themeName) {
      if (themeName === this.currentTheme) {
        return
      }
      setTheme(themeName)
    },

    // 切换夜间模式
    toggleDarkMode() {
      toggleDarkMode()
    },
  },
}
</script>

<style scoped>
.theme-selector {
  padding: 20rpx;
}

.theme-list {
  background-color: #fff;
  border-radius: 16rpx;
  overflow: hidden;
}

.theme-item {
  display: flex;
  align-items: center;
  padding: 30rpx 24rpx;
  border-bottom: 1rpx solid #f0f0f0;
  position: relative;
  transition: background-color 0.2s;
}

.theme-item:last-child {
  border-bottom: none;
}

.theme-item.active {
  background-color: #f0f7ff;
}

.theme-item:active {
  background-color: #fafafa;
}

.theme-icon {
  font-size: 48rpx;
  margin-right: 20rpx;
}

.theme-info {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.theme-label {
  font-size: 30rpx;
  font-weight: 500;
  color: #1f1f1f;
  margin-bottom: 6rpx;
}

.theme-desc {
  font-size: 24rpx;
  color: #8c8c8c;
}

.theme-preview {
  width: 48rpx;
  height: 48rpx;
  border-radius: 12rpx;
  margin-right: 16rpx;
  box-shadow: 0 2rpx 8rpx rgba(0, 0, 0, 0.1);
}

.theme-check {
  font-size: 32rpx;
  color: #1677ff;
  font-weight: bold;
}

/* 夜间模式开关 */
.dark-mode-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background-color: #fff;
  border-radius: 16rpx;
  padding: 30rpx 24rpx;
  margin-top: 20rpx;
}

.toggle-info {
  flex: 1;
  display: flex;
  align-items: center;
}

.toggle-icon {
  font-size: 48rpx;
  margin-right: 20rpx;
}

.toggle-text {
  display: flex;
  flex-direction: column;
}

.toggle-label {
  font-size: 30rpx;
  font-weight: 500;
  color: #1f1f1f;
  margin-bottom: 6rpx;
}

.toggle-desc {
  font-size: 24rpx;
  color: #8c8c8c;
}

/* 预览提示 */
.preview-tip {
  text-align: center;
  padding: 30rpx;
}

.preview-tip text {
  font-size: 26rpx;
  color: #8c8c8c;
}
</style>
