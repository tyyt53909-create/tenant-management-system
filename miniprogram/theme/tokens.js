/**
 * 设计 Token 系统
 * 所有主题的设计变量定义
 */

// 标准版主题（默认）
const standardTheme = {
  name: 'standard',
  label: '标准版',
  description: '适合大部分用户的清晰简洁风格',

  // 品牌色
  colors: {
    primary: '#1677ff',        // 主色调 - 蓝色
    primaryLight: '#4096ff',   // 主色调浅色
    primaryDark: '#0958d9',    // 主色调深色
    
    success: '#52c41a',        // 成功色
    warning: '#faad14',        // 警告色
    error: '#ff4d4f',          // 错误色
    info: '#1677ff',           // 信息色
    
    // 中性色
    textPrimary: '#1f1f1f',    // 主要文字
    textSecondary: '#606060',  // 次要文字
    textTertiary: '#8c8c8c',   // 辅助文字
    textDisabled: '#c0c0c0',   // 禁用文字
    
    // 背景色
    bgPrimary: '#ffffff',      // 主背景
    bgSecondary: '#f5f5f5',    // 次背景
    bgTertiary: '#fafafa',     // 三级背景
    
    // 边框色
    border: '#e8e8e8',
    borderLight: '#f0f0f0',
    borderDark: '#d9d9d9',
    
    // 功能色背景
    successBg: '#f6ffed',
    warningBg: '#fffbe6',
    errorBg: '#fff2f0',
    infoBg: '#e6f7ff',
  },

  // 字体
  typography: {
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    
    // 字号（rpx）
    fontSizeXL: 36,      // 特大标题
    fontSizeLG: 32,      // 大标题
    fontSizeMD: 28,      // 正文
    fontSizeSM: 26,      // 小字
    fontSizeXS: 24,      // 极小字
    
    // 行高
    lineHeightLG: 1.6,
    lineHeightMD: 1.5,
    lineHeightSM: 1.4,
    
    // 字重
    fontWeightLight: 300,
    fontWeightRegular: 400,
    fontWeightMedium: 500,
    fontWeightBold: 600,
  },

  // 间距（rpx）
  spacing: {
    xs: 8,
    sm: 12,
    md: 16,
    lg: 24,
    xl: 32,
    xxl: 48,
  },

  // 圆角（rpx）
  borderRadius: {
    sm: 4,
    md: 8,
    lg: 12,
    xl: 16,
    circle: '50%',
  },

  // 阴影
  shadows: {
    sm: '0 2rpx 8rpx rgba(0, 0, 0, 0.08)',
    md: '0 4rpx 16rpx rgba(0, 0, 0, 0.10)',
    lg: '0 8rpx 24rpx rgba(0, 0, 0, 0.12)',
  },

  // 动画时长（ms）
  animation: {
    fast: 150,
    normal: 250,
    slow: 350,
  },
}

// 青春版主题
const youthTheme = {
  name: 'youth',
  label: '青春版',
  description: '活力时尚，适合年轻用户',

  colors: {
    primary: '#722ed1',        // 主色调 - 紫色渐变
    primaryLight: '#9254de',
    primaryDark: '#531dab',
    
    success: '#52c41a',
    warning: '#faad14',
    error: '#ff4d4f',
    info: '#722ed1',
    
    textPrimary: '#1f1f1f',
    textSecondary: '#606060',
    textTertiary: '#8c8c8c',
    textDisabled: '#c0c0c0',
    
    bgPrimary: '#ffffff',
    bgSecondary: '#f9f0ff',    // 浅紫色背景
    bgTertiary: '#fafafa',
    
    border: '#e8e8e8',
    borderLight: '#f0f0f0',
    borderDark: '#d9d9d9',
    
    successBg: '#f6ffed',
    warningBg: '#fffbe6',
    errorBg: '#fff2f0',
    infoBg: '#f9f0ff',
    
    // 渐变色（青春版特有）
    gradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    gradientLight: 'linear-gradient(135deg, #a8c0ff 0%, #c5a4ff 100%)',
  },

  typography: {
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    
    fontSizeXL: 38,      // 稍大一些
    fontSizeLG: 32,
    fontSizeMD: 28,
    fontSizeSM: 26,
    fontSizeXS: 24,
    
    lineHeightLG: 1.6,
    lineHeightMD: 1.5,
    lineHeightSM: 1.4,
    
    fontWeightLight: 300,
    fontWeightRegular: 400,
    fontWeightMedium: 500,
    fontWeightBold: 600,
  },

  spacing: {
    xs: 8,
    sm: 12,
    md: 16,
    lg: 24,
    xl: 32,
    xxl: 48,
  },

  borderRadius: {
    sm: 6,       // 更圆润
    md: 12,
    lg: 16,
    xl: 20,
    circle: '50%',
  },

  shadows: {
    sm: '0 2rpx 12rpx rgba(114, 46, 209, 0.12)',
    md: '0 4rpx 20rpx rgba(114, 46, 209, 0.15)',
    lg: '0 8rpx 28rpx rgba(114, 46, 209, 0.18)',
  },

  animation: {
    fast: 150,
    normal: 300,     // 稍快一些
    slow: 400,
  },
}

// 关怀版主题（中老年友好）
const careTheme = {
  name: 'care',
  label: '关怀版',
  description: '大字体高对比，适合中老年用户',

  colors: {
    primary: '#1890ff',        // 标准蓝色，对比度好
    primaryLight: '#40a9ff',
    primaryDark: '#096dd9',
    
    success: '#52c41a',
    warning: '#fa8c16',        // 更鲜艳的橙色
    error: '#f5222d',          // 更鲜艳的红色
    info: '#1890ff',
    
    textPrimary: '#000000',    // 纯黑，对比度最高
    textSecondary: '#434343',  // 深灰
    textTertiary: '#595959',   // 中灰
    textDisabled: '#bfbfbf',
    
    bgPrimary: '#ffffff',
    bgSecondary: '#f5f5f5',
    bgTertiary: '#fafafa',
    
    border: '#d9d9d9',         // 更深的边框
    borderLight: '#e8e8e8',
    borderDark: '#bfbfbf',
    
    successBg: '#f6ffed',
    warningBg: '#fff7e6',
    errorBg: '#fff1f0',
    infoBg: '#e6f7ff',
  },

  typography: {
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    
    // 字号大幅增加
    fontSizeXL: 48,      // +33%
    fontSizeLG: 40,      // +25%
    fontSizeMD: 34,      // +21%
    fontSizeSM: 30,      // +15%
    fontSizeXS: 28,      // +17%
    
    lineHeightLG: 1.7,   // 更宽松的行距
    lineHeightMD: 1.6,
    lineHeightSM: 1.5,
    
    fontWeightLight: 400,
    fontWeightRegular: 500,  // 更粗
    fontWeightMedium: 600,
    fontWeightBold: 700,     // 更粗
  },

  spacing: {
    xs: 12,      // 所有间距增加 50%
    sm: 16,
    md: 24,
    lg: 32,
    xl: 48,
    xxl: 64,
  },

  borderRadius: {
    sm: 4,       // 保持简单
    md: 8,
    lg: 12,
    xl: 16,
    circle: '50%',
  },

  shadows: {
    sm: '0 2rpx 8rpx rgba(0, 0, 0, 0.15)',   // 更明显的阴影
    md: '0 4rpx 16rpx rgba(0, 0, 0, 0.18)',
    lg: '0 8rpx 24rpx rgba(0, 0, 0, 0.20)',
  },

  animation: {
    fast: 200,      // 稍慢一些，更从容
    normal: 300,
    slow: 400,
  },
}

// 夜间模式（可以叠加到任何主题上）
const darkMode = {
  name: 'dark',
  label: '夜间模式',
  
  colors: {
    textPrimary: '#e8e8e8',
    textSecondary: '#a0a0a0',
    textTertiary: '#737373',
    textDisabled: '#525252',
    
    bgPrimary: '#141414',
    bgSecondary: '#1f1f1f',
    bgTertiary: '#262626',
    
    border: '#303030',
    borderLight: '#262626',
    borderDark: '#434343',
  },
}

// 导出所有主题
export const themes = {
  standard: standardTheme,
  youth: youthTheme,
  care: careTheme,
}

export const darkModeColors = darkMode.colors

// 默认主题
export const defaultTheme = 'standard'

// 主题列表（用于选择器）
export const themeList = [
  {
    name: 'standard',
    label: '标准版',
    description: '清晰简洁，适合大部分用户',
    icon: '📱',
    preview: '#1677ff',
  },
  {
    name: 'youth',
    label: '青春版',
    description: '活力时尚，适合年轻用户',
    icon: '🎨',
    preview: '#722ed1',
  },
  {
    name: 'care',
    label: '关怀版',
    description: '大字体高对比，适合长辈使用',
    icon: '❤️',
    preview: '#1890ff',
  },
]
