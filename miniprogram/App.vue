<script>
export default {
  onLaunch: function () {
    console.log('App Launch')
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
</style>
