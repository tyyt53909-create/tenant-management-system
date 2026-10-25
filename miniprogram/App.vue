<script>
import { initTheme } from './utils/theme.js'
import { installPrivacyHandler } from './utils/privacy.js'

export default {
  onLaunch: function () {
    console.log('App Launch')

    // 从本地存储恢复主题与夜间模式
    initTheme()

    // 隐私授权：首次调用相册/剪贴板等接口前展示《隐私保护指引》（FE-02 / T287）
    installPrivacyHandler()

    // 检查登录状态
    const token = uni.getStorageSync('access_token')
    if (!token) {
      // 未登录，跳转到登录页
      // uni.reLaunch({ url: '/pages/login/login' })
    }
  },
  onShow: function () {
    console.log('App Show')
  },
  onHide: function () {
    console.log('App Hide')
  }
}
</script>

<style>
@import './app.css';
@import './qiju.css';
</style>
