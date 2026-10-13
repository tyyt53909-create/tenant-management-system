<template>
  <view class="theme-settings">
    <!-- 页面标题 -->
    <view class="page-header">
      <text class="page-title">主题设置</text>
      <text class="page-desc">选择您喜欢的界面风格</text>
    </view>

    <!-- 主题选择器 -->
    <ThemeSelector />

    <!-- 主题预览 -->
    <view class="preview-section">
      <view class="section-title">
        <text>效果预览</text>
      </view>
      
      <!-- 预览卡片 -->
      <view :style="previewCardStyle" class="preview-card">
        <view class="preview-header">
          <text :style="previewTitleStyle">示例卡片标题</text>
          <text :style="previewMoreStyle">查看更多</text>
        </view>
        
        <view class="preview-content">
          <text :style="previewTextStyle">这是正文内容，展示当前主题的文字效果</text>
        </view>
        
        <view class="preview-buttons">
          <view :style="previewButtonPrimaryStyle" class="preview-btn">
            <text style="color: #fff;">主要按钮</text>
          </view>
          <view :style="previewButtonOutlineStyle" class="preview-btn">
            <text :style="{ color: theme.colors.primary }">次要按钮</text>
          </view>
        </view>
      </view>
    </view>

    <!-- 说明文字 -->
    <view class="tips-section">
      <view class="tips-item">
        <text class="tips-icon">📱</text>
        <text class="tips-text">标准版：简洁清晰，适合大部分用户日常使用</text>
      </view>
      <view class="tips-item">
        <text class="tips-icon">🎨</text>
        <text class="tips-text">青春版：色彩丰富，适合追求个性的年轻用户</text>
      </view>
      <view class="tips-item">
        <text class="tips-icon">❤️</text>
        <text class="tips-text">关怀版：大字体高对比，特别适合长辈使用</text>
      </view>
      <view class="tips-item">
        <text class="tips-icon">🌙</text>
        <text class="tips-text">夜间模式：护眼配色，适合夜晚或暗光环境</text>
      </view>
    </view>
  </view>
</template>

<script>
import ThemeSelector from '../../components/ThemeSelector.vue'
import { themeMixin } from '../../utils/theme.js'

export default {
  name: 'ThemeSettings',

  components: {
    ThemeSelector,
  },

  // themeMixin 已提供响应式 `theme` 计算属性（对应主题配置）
  mixins: [themeMixin],

  computed: {
    // 预览卡片样式
    previewCardStyle() {
      return {
        backgroundColor: this.theme.colors.bgPrimary,
        borderRadius: `${this.theme.borderRadius.lg}rpx`,
        padding: `${this.theme.spacing.lg}rpx`,
        boxShadow: this.theme.shadows.sm,
      }
    },
    
    previewTitleStyle() {
      return {
        fontSize: `${this.theme.typography.fontSizeLG}rpx`,
        fontWeight: this.theme.typography.fontWeightBold,
        color: this.theme.colors.textPrimary,
      }
    },
    
    previewMoreStyle() {
      return {
        fontSize: `${this.theme.typography.fontSizeSM}rpx`,
        color: this.theme.colors.textTertiary,
      }
    },
    
    previewTextStyle() {
      return {
        fontSize: `${this.theme.typography.fontSizeMD}rpx`,
        color: this.theme.colors.textSecondary,
        lineHeight: this.theme.typography.lineHeightMD,
      }
    },
    
    previewButtonPrimaryStyle() {
      return {
        backgroundColor: this.theme.colors.primary,
        borderRadius: `${this.theme.borderRadius.md}rpx`,
        padding: `${this.theme.spacing.sm}rpx ${this.theme.spacing.lg}rpx`,
      }
    },
    
    previewButtonOutlineStyle() {
      return {
        backgroundColor: 'transparent',
        borderRadius: `${this.theme.borderRadius.md}rpx`,
        padding: `${this.theme.spacing.sm}rpx ${this.theme.spacing.lg}rpx`,
        border: `2rpx solid ${this.theme.colors.border}`,
      }
    },
  },
}
</script>

<style scoped>
.theme-settings {
  min-height: 100vh;
  background-color: var(--color-bg-secondary);
  padding-bottom: 40rpx;
}

.page-header {
  background-color: var(--color-bg-primary);
  padding: 40rpx 30rpx;
  margin-bottom: 20rpx;
}

.page-title {
  display: block;
  font-size: 40rpx;
  font-weight: 600;
  color: var(--color-text-primary);
  margin-bottom: 12rpx;
}

.page-desc {
  display: block;
  font-size: 26rpx;
  color: var(--color-text-secondary);
}

/* 预览区域 */
.preview-section {
  margin: 20rpx;
}

.section-title {
  padding: 20rpx 24rpx 16rpx;
}

.section-title text {
  font-size: 28rpx;
  font-weight: 500;
  color: var(--color-text-secondary);
}

.preview-card {
  margin-bottom: 20rpx;
}

.preview-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20rpx;
}

.preview-content {
  margin-bottom: 24rpx;
}

.preview-buttons {
  display: flex;
  gap: 16rpx;
}

.preview-btn {
  flex: 1;
  text-align: center;
  padding: 20rpx;
  border-radius: 8rpx;
  font-size: 28rpx;
  transition: all 0.2s;
}

.preview-btn:active {
  opacity: 0.8;
  transform: scale(0.98);
}

/* 说明文字 */
.tips-section {
  background-color: var(--color-bg-primary);
  margin: 20rpx;
  border-radius: 16rpx;
  padding: 30rpx 24rpx;
}

.tips-item {
  display: flex;
  align-items: flex-start;
  margin-bottom: 24rpx;
}

.tips-item:last-child {
  margin-bottom: 0;
}

.tips-icon {
  font-size: 36rpx;
  margin-right: 16rpx;
  flex-shrink: 0;
}

.tips-text {
  flex: 1;
  font-size: 26rpx;
  color: var(--color-text-secondary);
  line-height: 1.6;
}
</style>
