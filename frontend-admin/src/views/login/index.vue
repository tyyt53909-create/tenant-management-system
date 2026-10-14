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
      </el-form>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import type { FormInstance, FormRules } from 'element-plus';
import { useUserStore } from '@/stores/user';

const router = useRouter();
const userStore = useUserStore();

const loginFormRef = ref<FormInstance>();
const loading = ref(false);

const loginForm = reactive({
  identifier: 'admin@example.com',
  password: 'Admin@123',
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
.login-brand span { font-size: 9px; margin-left: 10px; color: #a39a8c; }
.login-subtitle { color: #8b897f; font-size: 12px; margin-bottom: 10px; }
</style>
