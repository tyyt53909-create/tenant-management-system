import test, { beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { themes, defaultTheme, darkModeColors } from '../theme/tokens.js'

// utils/theme.js 在模块加载时探测 globalThis.uni，且持有模块级 reactive 状态，
// 因此每个用例用带 query 的动态 import 取得全新实例（不复制业务逻辑）。
let storage
let version = 0

beforeEach(() => {
  storage = new Map()
  version += 1
  globalThis.uni = {
    getStorageSync: key => storage.get(key),
    setStorageSync: (key, value) => storage.set(key, value),
  }
})

function loadTheme() {
  return import(`../utils/theme.js?case=${version}`)
}

test('defaults to the default theme (qiju) with dark mode off', async () => {
  const mod = await loadTheme()
  assert.equal(mod.getThemeName(), defaultTheme)
  assert.equal(mod.getThemeName(), 'qiju')
  assert.equal(mod.isDark(), false)
  assert.deepEqual(mod.getTheme(), themes[defaultTheme])
})

test('setTheme switches theme and persists to storage', async () => {
  const mod = await loadTheme()
  assert.equal(mod.setTheme('youth'), true)
  assert.equal(mod.getThemeName(), 'youth')
  assert.equal(mod.getTheme().label, themes.youth.label)
  assert.equal(storage.get('theme'), 'youth')
})

test('setTheme rejects unknown theme without touching storage', async () => {
  const mod = await loadTheme()
  assert.equal(mod.setTheme('nope'), false)
  assert.equal(mod.getThemeName(), defaultTheme)
  assert.equal(storage.has('theme'), false)
})

test('dark mode overrides colors but keeps the base theme elsewhere', async () => {
  const mod = await loadTheme()
  mod.setTheme('youth')
  const before = mod.getTheme()

  mod.setDarkMode(true)
  const after = mod.getTheme()

  // 夜间模式仅覆盖颜色
  assert.equal(after.colors.bgPrimary, darkModeColors.bgPrimary)
  assert.equal(after.colors.textPrimary, darkModeColors.textPrimary)
  // 非颜色字段继承 baseTheme，且主题名未受影响
  assert.deepEqual(after.typography, before.typography)
  assert.deepEqual(after.spacing, before.spacing)
  assert.equal(after.name, 'youth')
  assert.equal(storage.get('darkMode'), true)

  mod.setDarkMode(false)
  assert.deepEqual(mod.getTheme(), themes.youth)
})

test('toggleDarkMode flips and returns the new state', async () => {
  const mod = await loadTheme()
  assert.equal(mod.toggleDarkMode(), true)
  assert.equal(mod.isDark(), true)
  assert.equal(mod.toggleDarkMode(), false)
  assert.equal(mod.isDark(), false)
})

test('initTheme restores theme and dark mode from storage', async () => {
  storage.set('theme', 'care')
  storage.set('darkMode', true)

  const mod = await loadTheme()
  // 加载时尚未初始化
  assert.equal(mod.getThemeName(), defaultTheme)
  assert.equal(mod.isDark(), false)

  mod.initTheme()
  assert.equal(mod.getThemeName(), 'care')
  assert.equal(mod.isDark(), true)
  assert.equal(mod.getTheme().colors.bgPrimary, darkModeColors.bgPrimary)
})

test('initTheme ignores an unknown stored theme', async () => {
  storage.set('theme', 'does-not-exist')
  const mod = await loadTheme()
  mod.initTheme()
  assert.equal(mod.getThemeName(), defaultTheme)
})

test('themeState is reactive and shared across consumers', async () => {
  const mod = await loadTheme()
  mod.setTheme('care')
  // 直接读取导出状态可观察到变更
  assert.equal(mod.themeState.currentTheme, 'care')
  assert.equal(mod.themeState.isDarkMode, false)
})

test('generateCSSVariables maps tokens to CSS custom properties', async () => {
  const mod = await loadTheme()
  const vars = mod.generateCSSVariables(themes.standard)

  assert.equal(vars['--color-primary'], themes.standard.colors.primary)
  assert.equal(vars['--color-bg-primary'], themes.standard.colors.bgPrimary)
  assert.equal(vars['--font-size-md'], `${themes.standard.typography.fontSizeMD}rpx`)
  assert.equal(vars['--spacing-lg'], `${themes.standard.spacing.lg}rpx`)
  assert.equal(vars['--radius-lg'], `${themes.standard.borderRadius.lg}rpx`)
  assert.equal(vars['--shadow-sm'], themes.standard.shadows.sm)
  assert.equal(vars['--duration-fast'], `${themes.standard.animation.fast}ms`)
})

test('camelToKebab converts camelCase keys', async () => {
  const mod = await loadTheme()
  assert.equal(mod.camelToKebab('bgPrimary'), 'bg-primary')
  // 连续大写（如 MD 后缀）视为一个词，产出 --font-size-md
  assert.equal(mod.camelToKebab('fontSizeMD'), 'font-size-md')
  assert.equal(mod.camelToKebab('primary'), 'primary')
})

test('themeMixin exposes theme state for options API components', async () => {
  const mod = await loadTheme()
  mod.setTheme('youth')
  const mixin = mod.themeMixin

  const theme = mixin.computed.theme.call({})
  const themeName = mixin.computed.$themeName.call({})
  const isDarkMode = mixin.computed.$isDark.call({})

  assert.equal(themeName, 'youth')
  assert.equal(isDarkMode, false)
  assert.equal(theme.label, themes.youth.label)
})

test('themeMixin methods delegate to the module functions', async () => {
  const mod = await loadTheme()
  const mixin = mod.themeMixin

  assert.equal(mixin.methods.$changeTheme.call({}, 'care'), true)
  assert.equal(mod.getThemeName(), 'care')
  assert.equal(mixin.methods.$toggleDarkMode.call({}), true)
  assert.equal(mod.isDark(), true)
})

test('qiju theme has correct color palette', () => {
  const qiju = themes.qiju
  assert.equal(qiju.name, 'qiju')
  assert.equal(qiju.label, '栖居版')
  assert.equal(qiju.colors.primary, '#68715b')  // 橄榄绿
  assert.equal(qiju.colors.bgPrimary, '#fffefa')  // 纸质白
  assert.equal(qiju.colors.bgSecondary, '#f5f2ec')  // 米白
  assert.equal(qiju.colors.warning, '#ad735a')  // 陶土色
})

test('qiju theme has refined typography', () => {
  const qiju = themes.qiju
  // 字号略小，更精致
  assert.equal(qiju.typography.fontSizeXL, 38)
  assert.equal(qiju.typography.fontSizeMD, 26)
  // 字重更优雅
  assert.equal(qiju.typography.fontWeightRegular, 550)
  assert.equal(qiju.typography.fontWeightMedium, 650)
  assert.equal(qiju.typography.fontWeightBold, 720)
})

test('qiju theme has larger border radius', () => {
  const qiju = themes.qiju
  // 栖居版圆角更大，更柔和
  assert.equal(qiju.borderRadius.sm, 10)
  assert.equal(qiju.borderRadius.md, 14)
  assert.equal(qiju.borderRadius.lg, 18)
  assert.equal(qiju.borderRadius.xl, 20)
})

test('qiju theme has softer shadows', () => {
  const qiju = themes.qiju
  // 阴影更轻柔，使用暖色调
  assert.ok(qiju.shadows.sm.includes('rgba(74, 62, 47'))
  assert.ok(qiju.shadows.md.includes('rgba(74, 62, 47'))
})

test('qiju theme has custom animation timing', () => {
  const qiju = themes.qiju
  // 动画时长符合原型
  assert.equal(qiju.animation.fast, 160)
  assert.equal(qiju.animation.normal, 260)
  assert.equal(qiju.animation.slow, 380)
})

test('setTheme accepts qiju as valid theme', async () => {
  const mod = await loadTheme()
  assert.equal(mod.setTheme('qiju'), true)
  assert.equal(mod.getThemeName(), 'qiju')
  assert.equal(mod.getTheme().label, '栖居版')
  assert.equal(storage.get('theme'), 'qiju')
})
