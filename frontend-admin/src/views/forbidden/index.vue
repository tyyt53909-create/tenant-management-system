<template>
  <div class="forbidden-page">
    <section class="forbidden-card" role="alert">
      <span class="forbidden-code">403</span>
      <h1>当前账号无权访问这个页面</h1>
      <p>
        你以 <strong>{{ roleLabelText }}</strong> 登录。该页面仅对
        <strong>{{ requiredRoles }}</strong> 开放；如需使用，请联系管理员调整账号角色。
      </p>
      <div class="forbidden-actions">
        <el-button type="primary" @click="goHome">返回可用首页</el-button>
        <el-button @click="logout">退出登录</el-button>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useUserStore } from '@/stores/user';
import { roleLabel } from '@/utils/access';

const route = useRoute();
const router = useRouter();
const userStore = useUserStore();

const roleLabelText = computed(() => roleLabel(userStore.user?.role));
const requiredRoles = computed(() => {
  const roles = (route.meta?.roles as string[] | undefined) ?? [];
  const map: Record<string, string> = { ADMIN: '管理员', CLEANER: '保洁', TENANT: '租客' };
  return roles.map((role) => map[role] ?? role).join(' / ') || '特定角色';
});

function goHome() {
  // 保洁没有工作台权限，退回保洁队列；其余角色回工作台
  router.push(userStore.user?.role === 'CLEANER' ? '/cleaning' : '/dashboard');
}

function logout() {
  userStore.logout();
  router.push('/login');
}
</script>

<style scoped>
.forbidden-page {
  display: grid;
  place-items: center;
  min-height: 60vh;
  padding: 24px;
}
.forbidden-card {
  max-width: 520px;
  padding: 28px 30px;
  border: 1px solid var(--q-border, #e4e7ed);
  border-radius: 14px;
  background: var(--q-surface, #fff);
  text-align: left;
}
.forbidden-code {
  color: var(--q-text-muted, #6b7280);
  font-size: 12px;
  letter-spacing: 0.16em;
}
.forbidden-card h1 {
  margin: 6px 0 10px;
  font-size: 20px;
}
.forbidden-card p {
  margin: 0;
  color: var(--q-text-muted, #6b7280);
  line-height: 1.7;
}
.forbidden-actions {
  display: flex;
  gap: 10px;
  margin-top: 20px;
}
</style>
