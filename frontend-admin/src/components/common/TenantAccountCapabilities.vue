<template>
  <div class="tenant-account-capabilities">
    <!-- 加载中 -->
    <el-skeleton v-if="loading" :rows="6" animated />

    <!-- 错误状态与重试 -->
    <div v-else-if="error" class="error-banner" role="alert">
      <el-alert
        :title="error"
        type="error"
        show-icon
        :closable="false"
      />
      <div class="retry-action">
        <el-button size="small" @click="fetchData">重新加载</el-button>
      </div>
    </div>

    <!-- 内容展示 -->
    <template v-else>
      <!-- 1. 登录账号层级 -->
      <section class="section-block">
        <h3 class="section-title">登录账号状态</h3>

        <!-- 未注册账号 -->
        <div v-if="account?.status === 'UNREGISTERED'" class="unregistered-box">
          <el-alert
            title="该租客尚未注册登录账号"
            type="info"
            :closable="false"
            show-icon
            description="租客通过邮箱验证码或邀请码绑定档案后，才可在此进行禁用登录与功能屏蔽配置。"
          />
        </div>

        <!-- 已注册账号卡片 -->
        <div v-else-if="account?.status === 'REGISTERED'" class="account-card">
          <div class="account-header">
            <div class="account-identity">
              <strong>{{ account.email || account.phone || '租客账号' }}</strong>
              <small v-if="account.phone && account.email">手机：{{ account.phone }}</small>
            </div>
            <el-tag :type="account.isActive ? 'success' : 'danger'" effect="light">
              {{ account.isActive ? '允许登录' : '已禁止登录' }}
            </el-tag>
          </div>

          <div class="account-meta-grid">
            <div class="meta-item">
              <span class="meta-label">最后登录</span>
              <span class="meta-value">{{ formatTime(account.lastLoginAt) }}</span>
            </div>
            <div class="meta-item">
              <span class="meta-label">注册时间</span>
              <span class="meta-value">{{ formatTime(account.createdAt) }}</span>
            </div>
          </div>

          <div class="account-action-row">
            <el-popconfirm
              :title="account.isActive ? '确认禁用此账号登录？禁用后已有登录态将立即失效。' : '确认恢复该租客的登录权限？'"
              :confirm-button-text="account.isActive ? '立即禁用' : '恢复登录'"
              :cancel-button-text="'取消'"
              @confirm="toggleAccountLogin"
            >
              <template #reference>
                <el-button
                  :type="account.isActive ? 'danger' : 'success'"
                  :loading="accountActionLoading"
                  size="small"
                >
                  {{ account.isActive ? '禁用登录账号' : '恢复登录账号' }}
                </el-button>
              </template>
            </el-popconfirm>
            <span class="action-note">立即无法登录，不影响档案启用状态</span>
          </div>
        </div>
      </section>

      <!-- 2. 租客功能权限开光层级 -->
      <section class="section-block">
        <div class="section-header">
          <h3 class="section-title">租客功能权限开关</h3>
          <small class="section-hint">管理租客登录小程序后的可访问功能，默认全部允许</small>
        </div>

        <!-- 未注册时的提示 -->
        <div v-if="account?.status === 'UNREGISTERED'" class="disabled-hint">
          租客尚未注册账号，功能权限开关暂不可用。
        </div>

        <!-- 功能分组列表 (拆分组件) -->
        <div v-else class="capabilities-group-list">
          <CapabilityGroupCard
            v-for="group in capabilityGroups"
            :key="group.key"
            :group="group"
            :denied-set="deniedSet"
            :reasons="reasons"
            @toggle="toggleCapability"
          />

          <!-- 保存按钮与反馈 -->
          <div v-if="saveError" class="save-error-box">
            <el-alert
              :title="saveError"
              type="error"
              show-icon
              :closable="false"
            />
          </div>

          <div class="save-action-row">
            <el-button
              type="primary"
              :loading="savingLoading"
              @click="handleSaveCapabilities"
            >
              保存功能权限设置
            </el-button>
            <el-button
              :disabled="savingLoading"
              @click="resetToCurrent"
            >
              还原更改
            </el-button>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, reactive, watch } from 'vue';
import { ElMessage } from 'element-plus';
import {
  getTenantAccount,
  updateTenantAccount,
  getTenantCapabilities,
  updateTenantCapabilities,
} from '@/api/tenants';
import type {
  TenantAccountResponse,
  TenantCapabilitiesResponse,
  TenantCapabilityItem,
} from '@/api/tenants';
import { formatDateTime } from '@/utils/table';
import CapabilityGroupCard from './capabilities/CapabilityGroupCard.vue';
import { apiErrorMessage } from '@/utils/apiError';

const props = defineProps<{
  tenantId: string;
  tenant?: any;
  editable?: boolean;
}>();

const loading = ref(false);
const error = ref('');
const account = ref<TenantAccountResponse | null>(null);
const capabilities = ref<TenantCapabilitiesResponse | null>(null);

const accountActionLoading = ref(false);
const savingLoading = ref(false);
const saveError = ref('');

// 本地编辑状态：存放当前被 DENY 的能力代码集合
const deniedSet = ref<Set<string>>(new Set());
// 本地编辑状态：存放各能力代码的屏蔽原因
const reasons = reactive<Record<string, string>>({});

function formatTime(val?: string | null) {
  if (!val) return '—';
  return formatDateTime(val);
}

function toggleCapability(code: string, active: any) {
  const isNowAllowed = Boolean(active);
  const next = new Set(deniedSet.value);
  if (isNowAllowed) {
    next.delete(code);
  } else {
    next.add(code);
  }
  deniedSet.value = next;
}

// 分组计算
const capabilityGroups = computed(() => {
  if (!capabilities.value?.catalog) return [];
  const catalog = capabilities.value.catalog;

  const groupMeta: Record<string, string> = {
    contract: '合同模块',
    bill: '账单与收据模块',
    prepay: '预付钱包模块',
    maintenance: '房屋报修模块',
    checkout: '退租结算模块',
  };

  const groupKeys = ['contract', 'bill', 'prepay', 'maintenance', 'checkout'];
  return groupKeys
    .map((key) => ({
      key,
      label: groupMeta[key] || key,
      items: catalog.filter((item: TenantCapabilityItem) => item.group === key),
    }))
    .filter((g) => g.items.length > 0);
});

// 重置到当前已保存状态
function resetToCurrent() {
  saveError.value = '';
  if (!capabilities.value) return;

  const currentDenied = new Set<string>();
  const catalogCodes = (capabilities.value.catalog || []).map((c) => c.code);
  const effectiveCodes = new Set(capabilities.value.effectiveCapabilities || []);

  for (const code of catalogCodes) {
    if (!effectiveCodes.has(code)) {
      currentDenied.add(code);
    }
  }

  deniedSet.value = currentDenied;

  // 清空并加载原因
  for (const k in reasons) {
    delete reasons[k];
  }
  for (const ov of capabilities.value.overrides || []) {
    if (ov.reason) {
      reasons[ov.capability] = ov.reason;
    }
  }
}

// 获取详情数据
async function fetchData() {
  if (!props.tenantId) return;
  loading.value = true;
  error.value = '';
  saveError.value = '';

  try {
    const [accData, capData] = await Promise.all([
      getTenantAccount(props.tenantId),
      getTenantCapabilities(props.tenantId),
    ]);

    account.value = accData;
    capabilities.value = capData;
    resetToCurrent();
  } catch (err: any) {
    error.value = apiErrorMessage(err, '获取租客账号与权限状态失败，请重试');
  } finally {
    loading.value = false;
  }
}

// 切换账号登录状态
async function toggleAccountLogin() {
  if (!account.value || account.value.status !== 'REGISTERED') return;
  const targetState = !account.value.isActive;
  accountActionLoading.value = true;

  try {
    await updateTenantAccount(props.tenantId, { isActive: targetState });
    account.value.isActive = targetState;
    ElMessage.success(targetState ? '已恢复租客登录权限' : '已禁用租客登录账号');
  } catch (err: any) {
    ElMessage.error(apiErrorMessage(err, '变更登录状态失败，请重试'));
  } finally {
    accountActionLoading.value = false;
  }
}

// 保存功能权限设置
async function handleSaveCapabilities() {
  saveError.value = '';
  savingLoading.value = true;

  const deniedArray = Array.from(deniedSet.value);
  const reasonsPayload: Record<string, string> = {};
  for (const code of deniedArray) {
    if (reasons[code]?.trim()) {
      reasonsPayload[code] = reasons[code].trim();
    }
  }

  try {
    const updated = await updateTenantCapabilities(props.tenantId, {
      denied: deniedArray,
      reasons: reasonsPayload,
    });
    capabilities.value = updated;
    resetToCurrent();
    ElMessage.success('租客功能权限配置已保存');
  } catch (err: any) {
    saveError.value = apiErrorMessage(err, '保存失败，请检查网络或配置后重试');
  } finally {
    savingLoading.value = false;
  }
}

watch(
  () => props.tenantId,
  (val) => {
    if (val) {
      void fetchData();
    }
  },
  { immediate: true },
);
</script>

<style scoped>
.tenant-account-capabilities {
  padding: 4px 0 16px;
  font-size: 13px;
  color: var(--text-primary);
}

.section-block {
  margin-bottom: 24px;
}

.section-title {
  font-size: 14px;
  font-weight: 600;
  margin: 0 0 12px;
  color: var(--text-primary);
}

.section-header {
  margin-bottom: 12px;
}

.section-hint {
  font-size: 11px;
  color: var(--text-muted);
}

.unregistered-box {
  margin: 8px 0;
}

.account-card {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 14px 16px;
  background: var(--bg-card);
}

.account-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.account-identity {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.account-identity strong {
  font-size: 14px;
}

.account-identity small {
  color: var(--text-muted);
  font-size: 12px;
}

.account-meta-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
  margin-bottom: 14px;
  padding-bottom: 12px;
  border-bottom: 1px dashed var(--border);
}

.meta-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.meta-label {
  font-size: 11px;
  color: var(--text-muted);
}

.meta-value {
  font-size: 12px;
  font-weight: 500;
}

.account-action-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.action-note {
  font-size: 11px;
  color: var(--text-muted);
}

.disabled-hint {
  font-size: 12px;
  color: var(--text-muted);
  background: var(--bg-section);
  padding: 12px;
  border-radius: 6px;
}

.capabilities-group-list {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.save-error-box {
  margin-top: 10px;
}

.save-action-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid var(--border);
}

.retry-action {
  margin-top: 8px;
}
</style>
