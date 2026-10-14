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

        <view class="oauth-divider">
          <text class="oauth-divider-text">或使用第三方账号</text>
        </view>

        <view class="oauth-btn-wrap">
          <button class="btn-google" :disabled="googleLoading" @tap="handleGoogleLogin">
            <image class="google-icon-img" src="/static/google-icon.svg" mode="aspectFit"></image>
            <text>{{ googleLoading ? '正在验证 Google 登录…' : 'Sign in with Google' }}</text>
          </button>
        </view>

        <view class="tips">
          <text>还没有账号？</text>
          <text class="link" @tap="goToRegister">立即注册</text>
        </view>
      </view>
    </view>
  </view>
</template>

<script>
import { login, loginWithGoogle, getGoogleClientId } from '../../api/index.js'
import { openHome } from '../../utils/session.js'

export default {
  data() {
    return {
      form: {
        account: '',
        password: ''
      },
      loading: false,
      googleLoading: false,
      googleClientId: ''
    }
  },
  mounted() {
    // #ifdef H5
    this.initGoogleGis()
    // #endif
  },
  methods: {
    async initGoogleGis() {
      try {
        const res = await getGoogleClientId()
        if (res && res.clientId && res.clientId.trim() !== '') {
          this.googleClientId = res.clientId
          const script = document.createElement('script')
          script.src = 'https://accounts.google.com/gsi/client'
          script.async = true
          script.defer = true
          script.onload = () => {
            if (window.google && window.google.accounts && window.google.accounts.id) {
              window.google.accounts.id.initialize({
                client_id: res.clientId,
                callback: (response) => {
                  if (response && response.credential) {
                    this.submitGoogleToken(response.credential)
                  }
                }
              })
            }
          }
          document.head.appendChild(script)
        }
      } catch (e) {
        console.warn('获取 Google Client ID 失败', e)
      }
    },
    async handleGoogleLogin() {
      if (this.googleLoading) return

      // #ifdef H5
      if (this.googleClientId && typeof window !== 'undefined' && window.google && window.google.accounts && window.google.accounts.id) {
        window.google.accounts.id.prompt((notification) => {
          if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
            this.promptMockGoogleLogin()
          }
        })
        return
      }
      this.promptMockGoogleLogin()
      // #endif

      // #ifndef H5
      uni.showModal({
        title: '提示',
        content: 'Google 账号登录支持网页端 (H5) 与独立 App 环境',
        showCancel: false
      })
      // #endif
    },
    promptMockGoogleLogin() {
      // #ifdef H5
      const email = window.prompt(
        '当前系统支持 Google 统一认证。如尚未在后台配置 Google Client ID，可输入测试 Google 账号快速验证（默认：tenant140@example.com）：',
        'tenant140@example.com'
      )
      if (!email || !email.trim()) return

      this.submitGoogleToken(`mock-google-token:${email.trim()}`)
      // #endif
    },
    async submitGoogleToken(idToken, inviteCode) {
      this.googleLoading = true
      try {
        const res = await loginWithGoogle({ idToken, inviteCode })
        uni.setStorageSync('access_token', res.accessToken)
        uni.setStorageSync('refresh_token', res.refreshToken)
        uni.setStorageSync('user_role', res.user.role)
        uni.showToast({
          title: 'Google 登录成功',
          icon: 'success'
        })
        openHome(res.user.role)
      } catch (error) {
        const msg = error.message || (error.data && error.data.message) || '登录失败'
        // #ifdef H5
        if (msg.includes('邀请码') && !inviteCode) {
          const code = window.prompt(msg + '\n\n请输入管理员提供的邀请码完成绑定：', '')
          if (code && code.trim()) {
            await this.submitGoogleToken(idToken, code.trim())
            return
          }
        }
        // #endif
        uni.showToast({
          title: msg,
          icon: 'none'
        })
      } finally {
        this.googleLoading = false
      }
    },
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

.oauth-divider {
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 36rpx 0 24rpx;
  position: relative;
}
.oauth-divider::before {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  top: 50%;
  height: 1rpx;
  background: #e9e6de;
  z-index: 1;
}
.oauth-divider-text {
  position: relative;
  z-index: 2;
  background: #fffefa;
  padding: 0 20rpx;
  color: #a49f95;
  font-size: 22rpx;
}

.oauth-btn-wrap {
  margin-bottom: 24rpx;
}

.btn-google {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16rpx;
  width: 100%;
  height: 84rpx;
  background: #ffffff;
  border: 1rpx solid #d8d2c8;
  border-radius: 12rpx;
  font-size: 28rpx;
  font-weight: 500;
  color: #302f2a;
}
.btn-google::after {
  border: none;
}
.btn-google:active {
  background: #f5f2ec;
}
.google-icon-img {
  width: 36rpx;
  height: 36rpx;
  flex-shrink: 0;
}
</style>
