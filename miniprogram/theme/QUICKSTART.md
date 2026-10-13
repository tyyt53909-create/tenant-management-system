# 主题系统 - 快速开始指南

## ⚡ 5 分钟上手

### 第一步：安装依赖

```bash
cd miniprogram
npm install
```

### 第二步：启动开发服务器

```bash
# 微信小程序
npm run dev:mp-weixin

# H5 (浏览器预览)
npm run dev:h5

# Android/iOS App
# 使用 HBuilderX 打开项目并运行
```

### 第三步：在微信开发者工具中查看

1. 打开微信开发者工具
2. 导入项目目录：`miniprogram`
3. 选择 `dist/dev/mp-weixin` 目录
4. 查看效果

### 第四步：访问主题设置页面

在小程序中：
1. 点击底部 Tab "我的"
2. 点击 "主题设置" 菜单项
3. 选择不同主题查看效果

## 🎨 立即体验主题切换

### 方式 1：直接访问主题设置页面

在任何页面的控制台输入：

```javascript
uni.navigateTo({ url: '/pages/theme/theme' })
```

### 方式 2：在个人中心添加入口

编辑 `pages/profile/profile.vue`，添加主题设置入口：

```vue
<template>
  <view class="profile-page">
    <!-- 原有内容 -->
    
    <!-- 新增：主题设置入口 -->
    <view class="setting-section">
      <view class="setting-item" @tap="goToTheme">
        <view class="setting-left">
          <text class="setting-icon">🎨</text>
          <text class="setting-label">主题设置</text>
        </view>
        <view class="setting-right">
          <text class="setting-value">{{ currentThemeLabel }}</text>
          <text class="setting-arrow">›</text>
        </view>
      </view>
    </view>
  </view>
</template>

<script>
import { themeMixin } from '../../utils/theme.js'
import { themeList } from '../../theme/tokens.js'

export default {
  mixins: [themeMixin],
  
  computed: {
    currentThemeLabel() {
      const theme = themeList.find(t => t.name === this.$themeName)
      return theme ? theme.label : '标准版'
    }
  },
  
  methods: {
    goToTheme() {
      uni.navigateTo({ url: '/pages/theme/theme' })
    }
  }
}
</script>

<style scoped>
.setting-section {
  background-color: var(--color-bg-primary);
  margin: 20rpx;
  border-radius: var(--radius-lg);
  overflow: hidden;
}

.setting-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 30rpx 24rpx;
  border-bottom: 1rpx solid var(--color-border-light);
}

.setting-item:last-child {
  border-bottom: none;
}

.setting-item:active {
  background-color: var(--color-bg-tertiary);
}

.setting-left {
  display: flex;
  align-items: center;
}

.setting-icon {
  font-size: 40rpx;
  margin-right: 20rpx;
}

.setting-label {
  font-size: var(--font-size-md);
  color: var(--color-text-primary);
}

.setting-right {
  display: flex;
  align-items: center;
}

.setting-value {
  font-size: var(--font-size-sm);
  color: var(--color-text-tertiary);
  margin-right: 12rpx;
}

.setting-arrow {
  font-size: 32rpx;
  color: var(--color-text-tertiary);
}
</style>
```

## 🔄 改造现有页面（示例）

### 改造首页 - 使用主题

编辑 `pages/index/index.vue`：

```vue
<template>
  <view class="page" :style="{ backgroundColor: $colors.bgSecondary }">
    <!-- 顶部用户信息 - 使用主题渐变 -->
    <view class="header" :style="headerStyle">
      <view class="user-info">
        <image class="avatar" src="/static/avatar-default.png"></image>
        <view class="info">
          <text class="name" :style="{ color: '#fff' }">{{ userName || '租客' }}</text>
          <text class="room" :style="{ color: 'rgba(255,255,255,0.9)' }">{{ roomInfo || '暂无房间' }}</text>
        </view>
      </view>
    </view>

    <!-- 快捷功能卡片 - 使用主题样式 -->
    <view class="quick-menu" :style="cardStyle">
      <view class="menu-item" @tap="goToContract">
        <view class="menu-icon-wrapper" :style="iconWrapperStyle">
          <text class="menu-icon">📄</text>
        </view>
        <text :style="menuTextStyle">我的合同</text>
      </view>
      <!-- 其他菜单项... -->
    </view>

    <!-- 待办事项卡片 -->
    <view class="card" :style="cardStyle">
      <view class="card-header">
        <text :style="titleStyle">待办事项</text>
        <text :style="moreStyle" @tap="goToBills">查看全部</text>
      </view>
      <!-- 内容... -->
    </view>
  </view>
</template>

<script>
import { themeMixin } from '../../utils/theme.js'
import { getUserInfo, getMyBills, getMyMaintenance } from '../../api/index.js'

export default {
  mixins: [themeMixin],  // 引入主题 Mixin
  
  data() {
    return {
      userName: '',
      roomInfo: '',
      // ...
    }
  },
  
  computed: {
    // 头部样式（青春版支持渐变）
    headerStyle() {
      if (this.$theme.colors.gradient) {
        return {
          background: this.$theme.colors.gradient,
          padding: `${this.$spacing.xl}rpx ${this.$spacing.lg}rpx ${this.$spacing.xxl}rpx`,
        }
      }
      return {
        backgroundColor: this.$colors.primary,
        padding: `${this.$spacing.xl}rpx ${this.$spacing.lg}rpx ${this.$spacing.xxl}rpx`,
      }
    },
    
    // 卡片样式
    cardStyle() {
      return {
        backgroundColor: this.$colors.bgPrimary,
        borderRadius: `${this.$radius.lg}rpx`,
        padding: `${this.$spacing.lg}rpx`,
        margin: `0 ${this.$spacing.md}rpx ${this.$spacing.md}rpx`,
        boxShadow: this.$shadows.sm,
      }
    },
    
    // 图标容器样式
    iconWrapperStyle() {
      return {
        backgroundColor: `${this.$colors.primary}10`,
        borderRadius: `${this.$radius.md}rpx`,
        width: '80rpx',
        height: '80rpx',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: `${this.$spacing.sm}rpx`,
      }
    },
    
    // 标题样式
    titleStyle() {
      return {
        fontSize: `${this.$typography.fontSizeLG}rpx`,
        fontWeight: this.$typography.fontWeightBold,
        color: this.$colors.textPrimary,
      }
    },
    
    // "查看更多" 样式
    moreStyle() {
      return {
        fontSize: `${this.$typography.fontSizeSM}rpx`,
        color: this.$colors.textTertiary,
      }
    },
    
    // 菜单文字样式
    menuTextStyle() {
      return {
        fontSize: `${this.$typography.fontSizeSM}rpx`,
        color: this.$colors.textPrimary,
      }
    },
  },
  
  // 方法保持不变...
}
</script>

<style scoped>
/* 大部分样式可以删除，使用 computed 动态绑定 */
.page {
  min-height: 100vh;
}

.user-info {
  display: flex;
  align-items: center;
}

.avatar {
  width: 100rpx;
  height: 100rpx;
  border-radius: 50%;
  margin-right: 20rpx;
  background-color: #fff;
}

.info {
  display: flex;
  flex-direction: column;
}

.quick-menu {
  display: flex;
  margin-top: -40rpx;
}

.menu-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.menu-icon {
  font-size: 40rpx;
}
</style>
```

## 📱 测试不同主题效果

### 测试标准版
1. 打开主题设置
2. 选择 "📱 标准版"
3. 观察：蓝色主色调，标准字体大小

### 测试青春版
1. 选择 "🎨 青春版"
2. 观察：紫色渐变，更活泼的视觉效果

### 测试关怀版
1. 选择 "❤️ 关怀版"
2. 观察：字体变大，对比度更高，更易阅读

### 测试夜间模式
1. 打开夜间模式开关
2. 观察：背景变深色，文字变浅色

## 🎯 验证清单

完成以下检查确保主题系统工作正常：

- [ ] 主题设置页面可以正常打开
- [ ] 可以切换三种主题（标准、青春、关怀）
- [ ] 可以开关夜间模式
- [ ] 切换主题后页面立即更新
- [ ] 关闭小程序重新打开，主题保持不变
- [ ] 不同页面的主题风格一致

## 🐛 常见问题

### Q1: 切换主题后页面没有变化？

**解决方案**：
1. 检查是否引入了 `themeMixin`
2. 检查是否使用了主题变量（如 `$colors.primary`）
3. 如果使用硬编码颜色，需要改为主题变量

### Q2: 提示 "Cannot read property 'colors' of undefined"？

**解决方案**：
1. 确保在 `App.vue` 的 `onLaunch` 中调用了 `initTheme()`（`utils/theme.js`）
2. 检查页面/组件是否通过 `themeMixin`（提供 `theme` 计算属性）或 `getTheme()` 读取主题
3. 不要直接访问已移除的 `this.$store`（T146 起 store 目录已删除）

### Q3: 主题设置页面打不开？

**解决方案**：
1. 检查 `pages.json` 是否注册了 `pages/theme/theme`
2. 检查路径是否正确

### Q4: 保存的主题丢失？

**解决方案**：
1. 检查 uni storage 是否可用（`uni.getStorageSync`）
2. 检查 `utils/theme.js` 中 `persist()` 是否成功写入（key: `theme` / `darkMode`）
3. 清除小程序缓存后重试

## 📚 下一步学习

1. **阅读完整文档**：`miniprogram/theme/README.md`
2. **查看架构图**：`docs/10-主题系统架构.md`
3. **改造其他页面**：账单、报修、合同等页面
4. **自定义主题**：添加自己的品牌主题

## 💡 提示

- 主题状态在 `utils/theme.js`，与 `utils/session.js` 同为"工具函数 + storage"模式，风格统一
- 优先改造高频使用的页面（首页、账单、报修）
- 使用 CSS 变量比动态绑定更简洁
- 关怀版特别注意字体大小和触控热区
- 测试时使用真机，模拟器可能有差异

## 🎉 恭喜

你已经掌握了主题系统的基本使用！

现在可以：
- ✅ 切换不同主题
- ✅ 开关夜间模式
- ✅ 改造现有页面支持主题
- ✅ 添加自定义主题

开始打造一个真正专业的、适合所有年龄段用户的租客管理系统吧！
