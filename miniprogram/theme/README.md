# 主题系统使用文档

## 📚 目录结构

```
miniprogram/
├── theme/
│   ├── tokens.js           # 设计 Token（颜色、字体、间距等）
│   ├── README.md           # 本文档
│   └── QUICKSTART.md       # 快速开始
├── utils/
│   └── theme.js            # 主题状态（reactive）+ 工具函数 + Mixin
├── components/
│   └── ThemeSelector.vue   # 主题选择组件
├── pages/
│   └── theme/
│       └── theme.vue       # 主题设置页面
├── app.css                 # 全局主题样式（CSS 变量）
├── App.vue                 # 应用入口（onLaunch 调用 initTheme）
└── main.js                 # Vue 入口（createSSRApp）
```

## 🎨 主题系统架构

### 1. 设计 Token 系统 (`theme/tokens.js`)

定义了 4 套主题 + 夜间模式：

#### **标准版** (Standard)
- 适合大部分用户
- 清晰简洁的蓝灰色系
- 标准字体大小（28-36rpx）
- 适中的间距和圆角

#### **青春版** (Youth)
- 适合年轻用户（18-30岁）
- 紫色渐变主色调
- 更活泼的视觉效果
- 支持渐变背景

#### **关怀版** (Care)
- 适合中老年用户（50+岁）
- **字体增大 20-40%**
- **高对比度配色**（纯黑文字）
- **更大的触控热区**
- 更宽松的间距

#### **栖居版** (Qiju) ⭐ 新增
- 温暖克制的自然美学
- **橄榄绿主色调**（#68715b）+ 陶土色点缀（#ad735a）
- **米白色背景**（#f5f2ec）+ 纸质白卡片（#fffefa）
- **更大的圆角**（18-20rpx），柔和亲切
- **轻柔阴影**（rgba(74,62,47,0.055)），若隐若现
- **优雅字重**（550/650/720），iOS 完整支持，Android 降级
- **精致字号**（略小于标准版），更加优雅
- 参考来源：HTML 交互原型设计

#### **夜间模式** (Dark Mode)
- 可叠加到任何主题上
- 深色背景 + 浅色文字
- 护眼配色

### 2. 状态管理 (`utils/theme.js`)

> **T146 重构说明**：原实现使用 Vuex（`store/` 目录）。为与 T144/T145 确立的架构保持一致
> （小程序统一采用"工具函数 + uni storage"模式，见 `utils/session.js`，全项目页面均直接
> import 工具函数，不引入状态管理库），现改为基于 Vue 3 `reactive()` 的轻量响应式模块。
> `store/` 目录已删除，**未新增任何状态管理依赖**。

```javascript
// 响应式状态（模块级单例）
themeState.currentTheme   // 当前主题
themeState.isDarkMode     // 是否夜间模式

// 读取
getTheme()        // 完整主题配置（含夜间模式颜色覆盖）
getThemeName()    // 当前主题名
isDark()          // 是否夜间模式

// 变更
initTheme()       // 初始化（从 storage 恢复）
setTheme(name)    // 切换主题
setDarkMode(bool) // 设置夜间模式
toggleDarkMode()  // 切换夜间模式
```

**持久化**：主题选择自动保存到 `uni storage`（key: `theme` / `darkMode`），下次打开由 `App.vue` 的 `initTheme()` 恢复。

### 3. 全局样式 (`app.css`)

使用 CSS 变量系统：

```css
page {
  --color-primary: #1677ff;
  --font-size-md: 28rpx;
  --spacing-lg: 24rpx;
  --radius-lg: 12rpx;
  --shadow-sm: 0 2rpx 8rpx rgba(0, 0, 0, 0.08);
}
```

**工具类**：
- 文字颜色：`.text-primary`, `.text-secondary`
- 字体大小：`.text-xl`, `.text-lg`, `.text-md`
- 间距：`.p-lg`, `.m-md`
- 圆角：`.rounded-lg`
- 阴影：`.shadow-sm`
- Flex 布局：`.flex-between`, `.flex-center`

## 🚀 使用方法

### 方法 1：使用 Mixin（推荐）

在页面或组件中引入 `themeMixin`：

```vue
<template>
  <view :style="{ backgroundColor: $colors.bgPrimary }">
    <text :style="{ 
      color: $colors.textPrimary,
      fontSize: $typography.fontSizeLG + 'rpx'
    }">
      标题文字
    </text>
  </view>
</template>

<script>
import { themeMixin } from '@/utils/theme.js'

export default {
  mixins: [themeMixin],
  
  methods: {
    changeTheme() {
      this.$changeTheme('youth')  // 切换到青春版
    }
  }
}
</script>
```

**可用属性**：
- `$theme` - 完整主题配置
- `$themeName` - 主题名称
- `$isDark` - 是否夜间模式
- `$colors` - 颜色配置
- `$typography` - 字体配置
- `$spacing` - 间距配置
- `$radius` - 圆角配置
- `$shadows` - 阴影配置

**可用方法**：
- `$changeTheme(name)` - 切换主题
- `$toggleDarkMode()` - 切换夜间模式

### 方法 2：使用 CSS 变量

直接在样式中使用 CSS 变量：

```vue
<template>
  <view class="card">
    <text class="title">标题</text>
    <text class="content">内容</text>
  </view>
</template>

<style scoped>
.card {
  background-color: var(--color-bg-primary);
  border-radius: var(--radius-lg);
  padding: var(--spacing-lg);
  box-shadow: var(--shadow-sm);
}

.title {
  font-size: var(--font-size-lg);
  color: var(--color-text-primary);
  font-weight: var(--font-weight-bold);
}

.content {
  font-size: var(--font-size-md);
  color: var(--color-text-secondary);
  margin-top: var(--spacing-md);
}
</style>
```

### 方法 3：使用工具类

直接使用预定义的工具类：

```vue
<template>
  <view class="card shadow-sm rounded-lg p-lg">
    <text class="text-lg font-bold text-primary">标题</text>
    <text class="text-md text-secondary m-md">内容</text>
  </view>
</template>
```

### 方法 4：直接调用工具函数（高级）

适用于 `<script setup>` 或非组件环境：

```javascript
import { getTheme, setTheme, toggleDarkMode } from '@/utils/theme.js'

// 获取当前主题
const theme = getTheme()

// 切换主题
setTheme('youth')

// 切换夜间模式
toggleDarkMode()
```

如需在组件中响应式读取，直接使用导出的 `themeState`：

```javascript
import { themeState } from '@/utils/theme.js'

export default {
  computed: {
    currentTheme() {
      return themeState.currentTheme
    },
  },
}
```

## 📖 示例：改造现有页面

### 改造前（硬编码样式）

```vue
<template>
  <view style="background-color: #ffffff; padding: 30rpx;">
    <text style="font-size: 32rpx; color: #333;">标题</text>
  </view>
</template>
```

### 改造后（使用主题系统）

```vue
<template>
  <view :style="cardStyle">
    <text :style="titleStyle">标题</text>
  </view>
</template>

<script>
import { themeMixin } from '@/utils/theme.js'

export default {
  mixins: [themeMixin],
  
  computed: {
    cardStyle() {
      return {
        backgroundColor: this.$colors.bgPrimary,
        padding: `${this.$spacing.lg}rpx`,
        borderRadius: `${this.$radius.lg}rpx`,
      }
    },
    
    titleStyle() {
      return {
        fontSize: `${this.$typography.fontSizeLG}rpx`,
        color: this.$colors.textPrimary,
        fontWeight: this.$typography.fontWeightBold,
      }
    }
  }
}
</script>
```

或者使用 CSS 变量：

```vue
<template>
  <view class="card">
    <text class="title">标题</text>
  </view>
</template>

<style scoped>
.card {
  background-color: var(--color-bg-primary);
  padding: var(--spacing-lg);
  border-radius: var(--radius-lg);
}

.title {
  font-size: var(--font-size-lg);
  color: var(--color-text-primary);
  font-weight: var(--font-weight-bold);
}
</style>
```

## 🎯 在个人中心添加主题入口

在 `pages/profile/profile.vue` 中添加：

```vue
<template>
  <view class="profile">
    <!-- 其他设置项 -->
    
    <!-- 主题设置 -->
    <view class="menu-item" @tap="goToThemeSettings">
      <text class="menu-icon">🎨</text>
      <text class="menu-text">主题设置</text>
      <text class="menu-value">{{ currentThemeLabel }}</text>
      <text class="menu-arrow">›</text>
    </view>
  </view>
</template>

<script>
import { themeMixin } from '@/utils/theme.js'
import { themeList } from '@/theme/tokens.js'

export default {
  mixins: [themeMixin],
  
  computed: {
    currentThemeLabel() {
      const theme = themeList.find(t => t.name === this.$themeName)
      return theme ? theme.label : '标准版'
    }
  },
  
  methods: {
    goToThemeSettings() {
      uni.navigateTo({ url: '/pages/theme/theme' })
    }
  }
}
</script>
```

## 🎨 自定义主题

如果需要添加新主题，在 `theme/tokens.js` 中添加：

```javascript
const customTheme = {
  name: 'custom',
  label: '自定义主题',
  description: '我的专属主题',
  
  colors: {
    primary: '#ff6b6b',
    // ... 其他颜色
  },
  
  typography: {
    fontSizeMD: 30,
    // ... 其他字体设置
  },
  
  // ... 其他配置
}

// 添加到主题列表
export const themes = {
  standard: standardTheme,
  youth: youthTheme,
  care: careTheme,
  custom: customTheme,  // 新增
}
```

## 📱 适配建议

### 关怀版（老年人友好）设计要点

1. **字体更大**：字号增大 20-40%
2. **对比度更高**：使用纯黑文字 (#000000)
3. **触控区域更大**：按钮高度至少 88rpx
4. **间距更宽松**：增加 50% 间距
5. **减少干扰元素**：简化布局，减少装饰
6. **明确的视觉反馈**：点击效果更明显

### 青春版设计要点

1. **渐变背景**：使用 `theme.colors.gradient`
2. **微动效**：添加过渡动画
3. **圆角更大**：使用 `borderRadius.xl`
4. **色彩更丰富**：使用紫色主调

### 栖居版设计要点

1. **配色温暖克制**：橄榄绿主色 + 米白背景，营造自然居住氛围
2. **圆角柔和**：14-20rpx 大圆角，亲切温润
3. **阴影轻柔**：rgba(74,62,47,0.055-0.10)，若隐若现
4. **字重优雅**：550/650/720，层次分明（注意 Android 降级）
5. **细节精致**：字号略小、间距考究，适合追求品质的用户
6. **动效流畅**：160/260/380ms，快速响应但不急促

## 🔧 技术细节

### 主题切换流程

```
用户点击主题 
  → setTheme(themeName)
  → 更新 reactive state（themeState）
  → 写入 uni storage
  → 依赖该状态的 computed 自动重新求值 → 页面更新
```

### 性能优化

- 使用 CSS 变量，切换主题不需要重新编译样式
- 主题配置由 `computed()` 缓存，避免重复计算
- `reactive()` 仅追踪实际读取的属性，开销极小

### 兼容性

- ✅ 微信小程序
- ✅ Android App (uni-app)
- ✅ iOS App (uni-app)
- ✅ H5 (部分特性需调整)

## 📝 后续扩展

可以继续添加：
1. **更多主题**：简约风、科技风等
2. **自定义配色**：让用户自由选择颜色
3. **字体大小调节**：单独调整字体大小
4. **动画效果开关**：节省性能
5. **对比度调节**：无障碍功能
6. **栖居版深色模式**：为栖居主题设计专属深色变体

## 🎉 总结

主题系统已经搭建完成，包含：

✅ **4 套主题** + 夜间模式（标准版、青春版、关怀版、栖居版）  
✅ **完整的设计 Token 体系**  
✅ **Vue 3 reactive 轻量状态管理**（无额外依赖）  
✅ **CSS 变量系统**  
✅ **便捷的 Mixin 和工具函数**  
✅ **主题选择器组件**  
✅ **主题设置页面**  
✅ **持久化存储**  

现在可以开始改造现有页面，让它们支持主题切换了！
