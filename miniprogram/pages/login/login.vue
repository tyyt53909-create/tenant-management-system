<template>
  <view class="page">
    <view class="login-container">
      <view class="logo-section">
        <image class="logo" src="/static/logo.png" mode="aspectFit"></image>
        <text class="app-name">栖居</text>
        <text class="login-subtitle">让每一件小事，都有清楚的回应。</text>
      </view>

      <view class="form-section">
        <view class="input-group">
          <text class="label">账号</text>
          <input 
            class="input" 
            v-model="form.account" 
            placeholder="请输入邮箱或手机号"
            placeholder-class="placeholder"
          />
        </view>

        <view class="input-group">
          <text class="label">密码</text>
          <input 
            class="input" 
            v-model="form.password" 
            password
            confirm-type="go"
            @confirm="handleLogin"
            placeholder="请输入密码"
            placeholder-class="placeholder"
          />
        </view>

        <button class="btn-login" :loading="loading" :disabled="loading" @tap="handleLogin">
          登录
        </button>

        <view class="tips">
          <text>还没有账号？</text>
          <text class="link" @tap="goToRegister">立即注册</text>
        </view>
      </view>
    </view>
  </view>
</template>

<script>
import { login } from '../../api/index.js'
import { openHome } from '../../utils/session.js'

export default {
  data() {
    return {
      form: {
        account: '',
        password: ''
      },
      loading: false
    }
  },
  methods: {
    async handleLogin() {
      if (this.loading) return
      // 验证表单
      if (!this.form.account) {
        uni.showToast({
          title: '请输入账号',
          icon: 'none'
        })
        return
      }
      if (!this.form.password) {
        uni.showToast({
          title: '请输入密码',
          icon: 'none'
        })
        return
      }

      this.loading = true
      try {
        const res = await login({
          identifier: this.form.account,
          password: this.form.password
        })
        
        // 保存 token
        uni.setStorageSync('access_token', res.accessToken)
        uni.setStorageSync('refresh_token', res.refreshToken)
        uni.setStorageSync('user_role', res.user.role)
        
        uni.showToast({
          title: '登录成功',
          icon: 'success'
        })
        
        // 跳转到首页
        openHome(res.user.role)
      } catch (error) {
        console.error('登录失败:', error)
      } finally {
        this.loading = false
      }
    },
    goToRegister() {
      uni.showToast({
        title: '请联系管理员注册',
        icon: 'none'
      })
    }
  }
}
</script>

<style scoped>
.app-name { display: block; letter-spacing: 8rpx; }
.login-subtitle { display: block; font-size: 23rpx; color: #817e76; margin-top: 18rpx; }
.page {
  min-height: 100vh;
  background: #f5f2ec;
  display: flex;
  align-items: center;
  justify-content: center;
}

.login-container {
  width: 90%;
  max-width: 600rpx;
}

.logo-section {
  text-align: center;
  margin-bottom: 80rpx;
}

.logo {
  width: 160rpx;
  height: 160rpx;
  margin-bottom: 30rpx;
}

.app-name {
  font-size: 48rpx;
  color: #4e5845;
  font-weight: bold;
}

.form-section {
  background-color: #fffefa;
  border: 1rpx solid #e9e6de;
  border-radius: 36rpx;
  padding: 60rpx 40rpx;
}

.input-group {
  margin-bottom: 40rpx;
}

.label {
  display: block;
  font-size: 28rpx;
  color: #333;
  margin-bottom: 16rpx;
}

.input {
  width: 100%;
  height: 88rpx;
  background-color: #f5f2ec;
  border-radius: 12rpx;
  padding: 0 24rpx;
  font-size: 28rpx;
}

.placeholder {
  color: #999;
}

.btn-login {
  width: 100%;
  height: 88rpx;
  background: #68715b;
  color: #fff;
  border-radius: 12rpx;
  font-size: 32rpx;
  font-weight: bold;
  border: none;
  margin-top: 20rpx;
}

.tips {
  text-align: center;
  margin-top: 40rpx;
  font-size: 26rpx;
  color: #666;
}

.link {
  color: #68715b;
  margin-left: 10rpx;
}
</style>
