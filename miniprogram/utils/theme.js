/**
 * 主题工具模块
 *
 * 2026-10-13 T146 重构：原实现依赖 Vuex（`store/theme.js` + `store/index.js`），
 * 与 T144/T145 确立的架构冲突（小程序统一使用"工具函数 + uni storage"，见 utils/session.js，
 * 全项目 8 个页面均直接 import 工具函数，不引入状态管理库）。
 *
 * 现改为基于 Vue 3 `reactive()` 的轻量响应式模块：
 * - 状态与读取：themeState / getTheme / getThemeName / isDark
 * - 变更：setTheme / toggleDarkMode / initTheme
 * - 组件便捷接入：themeMixin（沿用 options API）
 */

import { reactive, computed } from 'vue'
import { themes, defaultTheme, darkModeColors } from '../theme/tokens.js'

const STORAGE_KEY_THEME = 'theme'
const STORAGE_KEY_DARK = 'darkMode'

// 仅用于同步读取 storage 判断是否切换成功，不做 UI 提示
const canUseStorage = typeof uni !== 'undefined' && typeof uni.getStorageSync === 'function'

/**
 * 响应式主题状态（模块级单例，跨组件共享）
 */
const state = reactive({
  currentTheme: defaultTheme,
  isDarkMode: false,
})

// 内部缓存：主题别名 -> 解析后的主题名，避免重复校验
const isKnownTheme = (name) => Object.prototype.hasOwnProperty.call(themes, name)

/**
 * 供组件直接使用的响应式状态（只读语义，请通过 setTheme/toggleDarkMode 变更）
 */
export const themeState = state

/**
 * 应用主题的 CSS 变量（用于动态样式）
 */
const theme = computed(() => {
  const baseTheme = themes[state.currentTheme] || themes[defaultTheme]

  // 夜间模式：仅覆盖颜色，其余继承 baseTheme（与原 Vuex getter 语义一致）
  if (state.isDarkMode) {
    return {
      ...baseTheme,
      colors: {
        ...baseTheme.colors,
        ...darkModeColors,
      },
    }
  }

  return baseTheme
})

/**
 * 读取当前完整主题配置
 */
export function getTheme() {
  return theme.value
}

/**
 * 读取当前主题名
 */
export function getThemeName() {
  return state.currentTheme
}

/**
 * 是否夜间模式
 */
export function isDark() {
  return state.isDarkMode
}

/**
 * 写入 storage（storage 不可用时静默跳过，不阻断主题切换）
 */
function persist(key, value) {
  if (!canUseStorage || typeof uni.setStorageSync !== 'function') {
    return
  }
  try {
    uni.setStorageSync(key, value)
  } catch (error) {
    console.error('[主题] 持久化失败:', error)
  }
}

/**
 * 切换主题
 * @param {string} themeName 主题名（standard / youth / care）
 * @returns {boolean} 是否切换成功
 */
export function setTheme(themeName) {
  if (!isKnownTheme(themeName)) {
    console.error('[主题] 主题不存在:', themeName)
    return false
  }

  state.currentTheme = themeName
  persist(STORAGE_KEY_THEME, themeName)
  return true
}

/**
 * 设置夜间模式
 * @param {boolean} value
 */
export function setDarkMode(value) {
  state.isDarkMode = Boolean(value)
  persist(STORAGE_KEY_DARK, state.isDarkMode)
}

/**
 * 切换夜间模式
 * @returns {boolean} 切换后的夜间模式状态
 */
export function toggleDarkMode() {
  setDarkMode(!state.isDarkMode)
  return state.isDarkMode
}

/**
 * 初始化主题（从本地存储恢复），应用启动时调用一次
 */
export function initTheme() {
  if (!canUseStorage) {
    return
  }

  try {
    const savedTheme = uni.getStorageSync(STORAGE_KEY_THEME)
    const savedDarkMode = uni.getStorageSync(STORAGE_KEY_DARK)

    if (savedTheme && isKnownTheme(savedTheme)) {
      state.currentTheme = savedTheme
    }

    if (savedDarkMode !== null && savedDarkMode !== undefined) {
      state.isDarkMode = Boolean(savedDarkMode)
    }
  } catch (error) {
    console.error('[主题] 初始化失败:', error)
  }
}

/**
 * 主题 Mixin（options API 便捷接入）
 * 在组件中使用：mixins: [themeMixin]
 */
export const themeMixin = {
  computed: {
    // 当前主题配置（供页面模板直接以 theme 使用）
    theme() {
      return theme.value
    },

    // 当前主题配置
    $theme() {
      return theme.value
    },

    // 主题名称
    $themeName() {
      return state.currentTheme
    },

    // 是否夜间模式
    $isDark() {
      return state.isDarkMode
    },

    // 颜色
    $colors() {
      return this.$theme.colors
    },

    // 字体
    $typography() {
      return this.$theme.typography
    },

    // 间距
    $spacing() {
      return this.$theme.spacing
    },

    // 圆角
    $radius() {
      return this.$theme.borderRadius
    },

    // 阴影
    $shadows() {
      return this.$theme.shadows
    },
  },

  methods: {
    // 切换主题
    $changeTheme(themeName) {
      return setTheme(themeName)
    },

    // 切换夜间模式
    $toggleDarkMode() {
      return toggleDarkMode()
    },
  },
}

/**
 * 生成主题样式对象
 * 用于动态样式绑定
 */
export function useThemeStyle(theme) {
  return {
    // 颜色
    color: {
      primary: theme.colors.primary,
      success: theme.colors.success,
      warning: theme.colors.warning,
      error: theme.colors.error,
    },

    // 文字
    text: {
      primary: { color: theme.colors.textPrimary },
      secondary: { color: theme.colors.textSecondary },
      tertiary: { color: theme.colors.textTertiary },
    },

    // 背景
    bg: {
      primary: { backgroundColor: theme.colors.bgPrimary },
      secondary: { backgroundColor: theme.colors.bgSecondary },
      tertiary: { backgroundColor: theme.colors.bgTertiary },
    },

    // 卡片
    card: {
      backgroundColor: theme.colors.bgPrimary,
      borderRadius: `${theme.borderRadius.lg}rpx`,
      boxShadow: theme.shadows.sm,
    },

    // 按钮
    button: {
      primary: {
        backgroundColor: theme.colors.primary,
        color: '#ffffff',
        borderRadius: `${theme.borderRadius.md}rpx`,
        padding: `${theme.spacing.sm}rpx ${theme.spacing.lg}rpx`,
      },
    },
  }
}

/**
 * 获取主题颜色（支持透明度）
 */
export function getThemeColor(color, alpha = 1) {
  if (alpha === 1) {
    return color
  }

  // 简单的 hex 转 rgba（仅支持 #rrggbb 格式）
  if (color.startsWith('#')) {
    const r = parseInt(color.slice(1, 3), 16)
    const g = parseInt(color.slice(3, 5), 16)
    const b = parseInt(color.slice(5, 7), 16)
    return `rgba(${r}, ${g}, ${b}, ${alpha})`
  }

  return color
}

/**
 * 响应式字体大小
 * 根据主题和屏幕尺寸调整
 */
export function responsiveFontSize(size, theme) {
  // 基础字号
  const base = theme.typography.fontSizeMD

  // 比例
  const scale = size / 28 // 28rpx 为基准

  return Math.round(base * scale)
}

/**
 * 主题过渡动画
 */
export function themeTransition(duration = 300) {
  return {
    transition: `all ${duration}ms ease-in-out`,
  }
}

/**
 * 生成渐变背景（仅青春版）
 */
export function getGradient(theme) {
  if (theme.colors.gradient) {
    return {
      background: theme.colors.gradient,
    }
  }

  return {
    backgroundColor: theme.colors.primary,
  }
}

/**
 * 生成 CSS 变量对象（逻辑与重构前逐字保持一致）
 */
export function generateCSSVariables(theme) {
  const vars = {}

  // 颜色
  Object.entries(theme.colors).forEach(([key, value]) => {
    vars[`--color-${camelToKebab(key)}`] = value
  })

  // 字体
  Object.entries(theme.typography).forEach(([key, value]) => {
    if (key === 'fontFamily') {
      vars['--font-family'] = value
    } else if (typeof value === 'number') {
      vars[`--${camelToKebab(key)}`] = `${value}rpx`
    } else {
      vars[`--${camelToKebab(key)}`] = value
    }
  })

  // 间距
  Object.entries(theme.spacing).forEach(([key, value]) => {
    vars[`--spacing-${key}`] = `${value}rpx`
  })

  // 圆角
  Object.entries(theme.borderRadius).forEach(([key, value]) => {
    const val = typeof value === 'number' ? `${value}rpx` : value
    vars[`--radius-${key}`] = val
  })

  // 阴影
  Object.entries(theme.shadows).forEach(([key, value]) => {
    vars[`--shadow-${key}`] = value
  })

  // 动画
  Object.entries(theme.animation).forEach(([key, value]) => {
    vars[`--duration-${key}`] = `${value}ms`
  })

  return vars
}

/**
 * 驼峰转短横线
 */
export function camelToKebab(str) {
  return str.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()
}

/**
 * 辅助函数：px 转 rpx
 */
export function px2rpx(px) {
  const systemInfo = uni.getSystemInfoSync()
  const screenWidth = systemInfo.screenWidth || 375
  return (px / 375) * screenWidth * 2
}

/**
 * 辅助函数：rpx 转 px
 */
export function rpx2px(rpx) {
  const systemInfo = uni.getSystemInfoSync()
  const screenWidth = systemInfo.screenWidth || 375
  return (rpx * screenWidth) / 750
}
