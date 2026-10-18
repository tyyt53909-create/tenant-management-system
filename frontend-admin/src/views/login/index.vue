<template>
  <div class="login-container">
    <el-card class="login-card">
      <template #header>
        <div class="login-brand">栖居 <span>PROPERTY CONSOLE</span></div>
        <h2>欢迎回来</h2>
        <p class="login-subtitle">每一处居所，都在有序运转。</p>
      </template>

      <el-form
        ref="loginFormRef"
        :model="loginForm"
        :rules="rules"
        label-width="80px"
      >
        <el-form-item label="账号" prop="identifier">
          <el-input
            v-model="loginForm.identifier"
            placeholder="请输入邮箱或手机号"
            clearable
          />
        </el-form-item>

        <el-form-item label="密码" prop="password">
          <el-input
            v-model="loginForm.password"
            type="password"
            placeholder="请输入密码"
            show-password
            @keyup.enter="handleLogin"
          />
        </el-form-item>

        <el-form-item>
          <el-button
            type="primary"
            :loading="loading"
            style="width: 100%"
            @click="handleLogin"
          >
              进入运营中心
          </el-button>
        </el-form-item>

        <div class="oauth-divider">
          <span>或通过第三方登录</span>
        </div>

        <div class="oauth-section">
          <div id="google-signin-btn" class="google-gis-container"></div>
          <button
            v-if="mockEnabled && !hasGoogleClientId"
            type="button"
            class="google-btn"
            :disabled="googleLoading"
            @click="handleGoogleClick"
          >
            <svg class="google-icon" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
            </svg>
            <span>{{ googleLoading ? '正在验证 Google 登录…' : 'Sign in with Google' }}</span>
          </button>
        </div>
      </el-form>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import type { FormInstance, FormRules } from 'element-plus';
import { useUserStore } from '@/stores/user';
import { getGoogleClientId } from '@/api/auth';

const router = useRouter();
const userStore = useUserStore();

const loginFormRef = ref<FormInstance>();
const loading = ref(false);
const googleLoading = ref(false);
const hasGoogleClientId = ref(false);
// 后端是否开启「模拟 Google 登录」开发者通道（T206：改由后端 GOOGLE_AUTH_MOCK 决定）
const mockEnabled = ref(false);

// 仅在开发模式预填种子账号，避免把默认口令随生产 bundle 发布（T206，AGENTS.md §8.1）
const loginForm = reactive({
  identifier: import.meta.env.DEV ? 'admin@example.com' : '',
  password: import.meta.env.DEV ? 'Admin@123' : '',
});

const rules: FormRules = {
  identifier: [{ required: true, message: '请输入账号', trigger: 'blur' }],
  password: [{ required: true, message: '请输入密码', trigger: 'blur' }],
};

const handleLogin = async () => {
  if (!loginFormRef.value) return;

  await loginFormRef.value.validate(async (valid) => {
    if (!valid) return;

    loading.value = true;
    try {
      await userStore.login(loginForm.identifier, loginForm.password);
      ElMessage.success('登录成功');
      router.push('/dashboard');
    } catch (error: any) {
      ElMessage.error(error.response?.data?.message || '登录失败');
    } finally {
      loading.value = false;
    }
  });
};

const handleGoogleCredential = async (idToken: string) => {
  googleLoading.value = true;
  try {
    await userStore.loginWithGoogleToken(idToken);
    ElMessage.success('Google 登录成功');
    router.push('/dashboard');
  } catch (error: any) {
    ElMessage.error(error.response?.data?.message || 'Google 登录失败');
  } finally {
    googleLoading.value = false;
  }
};

const handleGoogleClick = async () => {
  if (!mockEnabled.value) return;

  // 当尚未在 .env 配置真实 Google Client ID 时，提供开发者快速通道
  try {
    const { value: email } = await ElMessageBox.prompt(
      '当前系统支持 Google 统一认证。如尚未在后台配置 Google Client ID，可输入模拟 Google 邮箱进行快速验证：',
      'Google 登录（模拟测试通道）',
      {
        confirmButtonText: '确定登录',
        cancelButtonText: '取消',
        inputValue: loginForm.identifier || '',
        inputPlaceholder: '请输入测试 Gmail / 邮箱',
      }
    );

    if (email) {
      await handleGoogleCredential(`mock-google-token:${email.trim()}`);
    }
  } catch {
    // 用户取消弹窗
  }
};

onMounted(async () => {
  try {
    const res = await getGoogleClientId();
    mockEnabled.value = res?.mockEnabled === true;
    if (res?.clientId && res.clientId.trim() !== '') {
      hasGoogleClientId.value = true;
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
      script.onload = () => {
        const google = (window as any).google;
        if (google?.accounts?.id) {
          google.accounts.id.initialize({
            client_id: res.clientId,
            callback: (response: any) => {
              if (response?.credential) {
                handleGoogleCredential(response.credential);
              }
            },
          });
          const btnContainer = document.getElementById('google-signin-btn');
          if (btnContainer) {
            google.accounts.id.renderButton(btnContainer, {
              theme: 'outline',
              size: 'large',
              width: 386,
            });
          }
        }
      };
      document.head.appendChild(script);
    }
  } catch (e) {
    console.warn('获取 Google Client ID 失败', e);
  }
});
</script>

<style scoped>
.login-container {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 100vh;
  background: #f7f5f0;
}

.login-card {
  width: min(450px, calc(100vw - 32px));
  border-radius: 18px;
  padding: 16px;
  background: #fffefa;
  box-shadow: 0 15px 55px rgba(54, 45, 26, .06);
}

.login-card h2 {
  margin: 25px 0 10px;
  font-size: 26px;
  font-weight: 550;
  color: #302f2a;
}
.login-brand { font-size: 18px; color: #535b43; letter-spacing: .1em; }
.login-brand span { font-size: 9px; margin-left: 10px; color: var(--text-subtle); }
.login-subtitle { color: var(--text-muted); font-size: 12px; margin-bottom: 10px; }

.oauth-divider {
  display: flex;
  align-items: center;
  margin: 24px 0 18px;
  color: var(--text-muted);
  font-size: 12px;
}
.oauth-divider::before,
.oauth-divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: #e9e6de;
}
.oauth-divider span {
  padding: 0 12px;
}

.oauth-section {
  display: flex;
  justify-content: center;
}

.google-gis-container {
  width: 100%;
  display: flex;
  justify-content: center;
}

.google-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  width: 100%;
  height: 40px;
  background: #ffffff;
  border: 1px solid #d8d2c8;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  color: #302f2a;
  cursor: pointer;
  transition: all 0.2s ease;
}
.google-btn:hover {
  background: #f9f8f5;
  border-color: #beb8ac;
}
.google-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.google-icon {
  width: 18px;
  height: 18px;
}
</style>
