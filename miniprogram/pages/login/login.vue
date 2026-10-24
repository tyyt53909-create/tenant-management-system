<template>
  <view class="page">
    <view class="login-container">
      <view class="logo-section">
        <image class="logo" src="/static/logo.png" mode="aspectFit"></image>
        <text class="app-name">栖居</text>
        <text class="login-subtitle">让每一件小事，都有清楚的回应。</text>
      </view>

      <view class="form-section">
        <!-- 登录方式切换 Tab -->
        <view class="login-tabs">
          <view 
            class="login-tab" 
            :class="{ active: loginType === 'email' }" 
            @tap="loginType = 'email'"
          >
            <text class="tab-text">验证码免密</text>
          </view>
          <view 
            class="login-tab" 
            :class="{ active: loginType === 'password' }" 
            @tap="loginType = 'password'"
          >
            <text class="tab-text">密码登录</text>
          </view>
        </view>

        <!-- 1. 邮箱验证码登录 (默认首选) -->
        <view v-if="loginType === 'email'" class="tab-content">
          <view class="input-group">
            <text class="label">登录邮箱</text>
            <input 
              class="input" 
              v-model="emailForm.email" 
              placeholder="请输入您的邮箱"
              placeholder-class="placeholder"
            />
          </view>

          <view class="input-group">
            <text class="label">验证码</text>
            <view class="otp-input-row">
              <input 
                class="input otp-input" 
                v-model="emailForm.code" 
                type="number"
                maxlength="6"
                placeholder="6 位数字验证码"
                placeholder-class="placeholder"
              />
              <button 
                class="btn-send-otp" 
                :disabled="otpCooldown > 0 || sendingCode" 
                @tap="handleSendOtp"
              >
                {{ sendingCode ? '发送中…' : (otpCooldown > 0 ? `${otpCooldown}s 后重发` : '获取验证码') }}
              </button>
            </view>
          </view>

          <view class="input-group">
            <text class="label">邀请码（首次登录必填）</text>
            <input
              class="input"
              v-model="emailForm.inviteCode"
              placeholder="管理员发放的 INVITE-… 邀请码"
              placeholder-class="placeholder"
            />
          </view>

          <button class="btn-login" :loading="emailLoading" :disabled="emailLoading" @tap="handleEmailLogin">
            登录 / 免密进入
          </button>
        </view>

        <!-- 2. 账号密码登录 -->
        <view v-else class="tab-content">
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
              @confirm="handlePasswordLogin"
              placeholder="请输入密码"
              placeholder-class="placeholder"
            />
          </view>

          <button class="btn-login" :loading="loading" :disabled="loading" @tap="handlePasswordLogin">
            登录
          </button>
        </view>

        <!-- 第三方账号登录 -->
        <view class="oauth-divider">
          <text class="oauth-divider-text">或使用第三方账号快捷登录</text>
        </view>

        <view class="oauth-btn-wrap">
          <!-- #ifdef H5 -->
          <view id="g_id_signin_container" class="google-official-btn"></view>
          <!-- #endif -->
          <button
            v-if="!gisButtonLoaded && mockEnabled"
            class="btn-google"
            :disabled="googleLoading"
            @tap="handleGoogleLogin"
          >
            <image class="google-icon-img" src="/static/google-icon.svg" mode="aspectFit"></image>
            <text>{{ googleLoading ? '正在验证 Google 登录…' : 'Sign in with Google' }}</text>
          </button>
        </view>

        <!-- 贴心指引 -->
        <view class="tips">
          <text class="tips-hint">🔑 租客账号由管理员预建并发放邀请码；首次登录时请填写邀请码，未受邀邮箱无法开通。</text>
        </view>
      </view>
    </view>
  </view>
</template>

<script>
import { 
  login, 
  sendEmailCode, 
  loginWithEmailCode, 
  loginWithGoogle, 
  getGoogleClientId 
} from '../../api/index.js'
import { openHome } from '../../utils/session.js'

export default {
  data() {
    return {
      loginType: 'email', // 'email' | 'password'
      emailForm: {
        email: '',
        code: '',
        inviteCode: ''
      },
      form: {
        account: '',
        password: ''
      },
      sendingCode: false,
      otpCooldown: 0,
      timer: null,
      emailLoading: false,
      loading: false,
      googleLoading: false,
      googleClientId: '',
      gisButtonLoaded: false,
      // 后端是否开启「模拟 Google 登录」开发者通道（T206：改由后端 GOOGLE_AUTH_MOCK 决定，
      // 未开启时前端不再提供模拟入口，否则点下去只会拿到 503）
      mockEnabled: false
    }
  },
  mounted() {
    // #ifdef H5
    this.initGoogleGis()
    // #endif
  },
  beforeUnmount() {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  },
  methods: {
    async handleSendOtp() {
      if (this.otpCooldown > 0 || this.sendingCode) return
      const email = (this.emailForm.email || '').trim()
      if (!email) {
        uni.showToast({ title: '请输入邮箱', icon: 'none' })
        return
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        uni.showToast({ title: '邮箱格式不正确', icon: 'none' })
        return
      }

      this.sendingCode = true
      try {
        const res = await sendEmailCode({ email })
        uni.showToast({ title: '验证码已发送', icon: 'success' })
        this.startOtpTimer(res.cooldown || 60)
      } catch (error) {
        const msg = error.message || (error.data && error.data.message) || '发送验证码失败'
        uni.showToast({ title: msg, icon: 'none' })
      } finally {
        this.sendingCode = false
      }
    },
    startOtpTimer(seconds) {
      this.otpCooldown = seconds
      if (this.timer) clearInterval(this.timer)
      this.timer = setInterval(() => {
        if (this.otpCooldown <= 1) {
          clearInterval(this.timer)
          this.timer = null
          this.otpCooldown = 0
        } else {
          this.otpCooldown--
        }
      }, 1000)
    },
    async handleEmailLogin() {
      if (this.emailLoading) return
      const email = (this.emailForm.email || '').trim()
      const code = (this.emailForm.code || '').trim()
      if (!email) {
        uni.showToast({ title: '请输入邮箱', icon: 'none' })
        return
      }
      if (!code) {
        uni.showToast({ title: '请输入验证码', icon: 'none' })
        return
      }
      if (code.length !== 6) {
        uni.showToast({ title: '请输入6位验证码', icon: 'none' })
        return
      }

      this.emailLoading = true
      try {
        const inviteCode = (this.emailForm.inviteCode || '').trim()
        const res = await loginWithEmailCode({ email, code, ...(inviteCode ? { inviteCode } : {}) })
        uni.setStorageSync('access_token', res.accessToken)
        uni.setStorageSync('refresh_token', res.refreshToken)
        uni.setStorageSync('user_role', res.user.role)
        uni.showToast({
          title: res.isNewUser ? '欢迎加入栖居！' : '登录成功',
          icon: 'success'
        })
        openHome(res.user.role)
      } catch (error) {
        const msg = error.message || (error.data && error.data.message) || '登录失败'
        uni.showToast({ title: msg, icon: 'none' })
      } finally {
        this.emailLoading = false
      }
    },
    async initGoogleGis() {
      try {
        const res = await getGoogleClientId()
        this.mockEnabled = !!(res && res.mockEnabled === true)
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
              const container = document.getElementById('g_id_signin_container')
              if (container) {
                window.google.accounts.id.renderButton(container, {
                  theme: 'outline',
                  size: 'large',
                  text: 'signin_with',
                  shape: 'rectangular',
                  width: 280,
                  logo_alignment: 'left'
                })
                this.gisButtonLoaded = true
              }
              window.google.accounts.id.prompt()
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
            this.fallbackGoogleLogin()
          }
        })
        return
      }
      this.fallbackGoogleLogin()
      // #endif

      // #ifndef H5
      uni.showModal({
        title: '提示',
        content: 'Google 账号登录支持网页端 (H5) 与独立 App 环境',
        showCancel: false
      })
      // #endif
    },
    /**
     * GIS 不可用时的兜底：只有后端开了模拟通道才走模拟登录，否则明确提示，
     * 不要发出必然被后端拒绝（503）的 mock token（T206）。
     */
    fallbackGoogleLogin() {
      // #ifdef H5
      if (this.mockEnabled) {
        this.promptMockGoogleLogin()
        return
      }
      uni.showToast({ title: 'Google 登录暂不可用，请使用邮箱验证码登录', icon: 'none' })
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
    async submitGoogleToken(idToken) {
      this.googleLoading = true
      try {
        const res = await loginWithGoogle({ idToken })
        uni.setStorageSync('access_token', res.accessToken)
        uni.setStorageSync('refresh_token', res.refreshToken)
        uni.setStorageSync('user_role', res.user.role)
        uni.showToast({
          title: res.isNewUser ? '欢迎使用 Google 登录！' : '登录成功',
          icon: 'success'
        })
        openHome(res.user.role)
      } catch (error) {
        const msg = error.message || (error.data && error.data.message) || '登录失败'
        uni.showToast({
          title: msg,
          icon: 'none'
        })
      } finally {
        this.googleLoading = false
      }
    },
    async handlePasswordLogin() {
      if (this.loading) return
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
        
        uni.setStorageSync('access_token', res.accessToken)
        uni.setStorageSync('refresh_token', res.refreshToken)
        uni.setStorageSync('user_role', res.user.role)
        
        uni.showToast({
          title: '登录成功',
          icon: 'success'
        })
        
        openHome(res.user.role)
      } catch (error) {
        console.error('登录失败:', error)
      } finally {
        this.loading = false
      }
    },
    handleLogin() {
      return this.handlePasswordLogin()
    }
  }
}
</script>

<style scoped>
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
  margin-bottom: 50rpx;
}

.logo {
  width: 160rpx;
  height: 160rpx;
  margin-bottom: 24rpx;
}

.app-name {
  display: block;
  font-size: 48rpx;
  color: #4e5845;
  font-weight: bold;
  letter-spacing: 8rpx;
}

.login-subtitle {
  display: block;
  font-size: 23rpx;
  color: #817e76;
  margin-top: 14rpx;
}

.form-section {
  background-color: #fffefa;
  border: 1rpx solid #e9e6de;
  border-radius: 36rpx;
  padding: 50rpx 40rpx;
  box-shadow: 0 4rpx 20rpx rgba(78, 88, 69, 0.05);
}

.login-tabs {
  display: flex;
  background: #f0ece3;
  border-radius: 16rpx;
  padding: 6rpx;
  margin-bottom: 36rpx;
}

.login-tab {
  flex: 1;
  text-align: center;
  padding: 14rpx 0;
  border-radius: 12rpx;
  cursor: pointer;
  transition: all 0.2s ease;
}

.login-tab.active {
  background: #fffefa;
  box-shadow: 0 2rpx 8rpx rgba(0, 0, 0, 0.06);
}

.tab-text {
  font-size: 26rpx;
  font-weight: 550;
  color: #817e76;
}

.login-tab.active .tab-text {
  color: #4e5845;
}

.tab-content {
  width: 100%;
}

.input-group {
  margin-bottom: 32rpx;
}

.label {
  display: block;
  font-size: 26rpx;
  color: #555;
  margin-bottom: 12rpx;
}

.input {
  width: 100%;
  height: 84rpx;
  background-color: #f7f5f0;
  border: 1rpx solid #e5e0d8;
  border-radius: 12rpx;
  padding: 0 24rpx;
  font-size: 28rpx;
  color: #302f2a;
  box-sizing: border-box;
}

.placeholder {
  color: #a8a39b;
}

.otp-input-row {
  display: flex;
  gap: 16rpx;
  align-items: center;
}

.otp-input {
  flex: 1;
}

.btn-send-otp {
  height: 84rpx;
  line-height: 84rpx;
  padding: 0 24rpx;
  background: #eae5d9;
  color: #4e5845;
  font-size: 24rpx;
  font-weight: 500;
  border-radius: 12rpx;
  border: none;
  white-space: nowrap;
  flex-shrink: 0;
  margin: 0;
}

.btn-send-otp::after {
  border: none;
}

.btn-send-otp[disabled] {
  background: #f1eee7;
  color: #b5b0a6;
}

.btn-login {
  width: 100%;
  height: 88rpx;
  line-height: 88rpx;
  background: #68715b;
  color: #fff;
  border-radius: 12rpx;
  font-size: 30rpx;
  font-weight: bold;
  border: none;
  margin-top: 16rpx;
}

.btn-login::after {
  border: none;
}

.btn-login[disabled] {
  opacity: 0.7;
}

.oauth-divider {
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 40rpx 0 24rpx;
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

.google-official-btn {
  display: flex;
  justify-content: center;
  align-items: center;
  margin: 0 auto 12rpx;
  min-height: 84rpx;
}

.btn-google {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16rpx;
  width: 100%;
  height: 84rpx;
  line-height: 84rpx;
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

.tips {
  text-align: center;
  margin-top: 24rpx;
}

.tips-hint {
  font-size: 22rpx;
  color: #8c887f;
  line-height: 1.5;
  display: block;
}
</style>
