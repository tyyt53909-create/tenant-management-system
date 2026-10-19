<template>
  <div class="prepay-page">
    <ManagementMetrics resource="prepay" />
    <ResourcePanel title="预付账户" :count="pagination.total" :loading="loading" :error="loadError" @retry="fetchData"><template #actions><ExportCurrent resource="prepay" :rows="tableData" /><el-button :loading="exporting" @click="handleExportCsv">导出全量流水 CSV</el-button><el-button @click="fetchData">刷新</el-button><el-button type="primary" @click="handleCreate">＋ 新增账户</el-button></template>

      <el-table :data="tableData" v-loading="loading" empty-text="暂无预付账户，点击右上角「新增账户」开始录入">
        <el-table-column label="租客" min-width="120">
          <template #default="{ row }">{{ row.tenant?.name || '—' }}</template>
        </el-table-column>
        <el-table-column label="房号" width="110">
          <template #default="{ row }">
            {{ row.roomNumber || '—' }}
          </template>
        </el-table-column>
        <el-table-column label="余额" width="140">
          <template #default="{ row }">
            <span :class="{ 'low-balance': row.balanceCache < row.lowBalanceThreshold }">
              ¥{{ (row.balanceCache / 100).toFixed(2) }}
            </span>
            <el-tag v-if="row.balanceCache < row.lowBalanceThreshold" type="danger" size="small" style="margin-left: 6px">
              低余额
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="低余额阈值" width="120">
          <template #default="{ row }">¥{{ (row.lowBalanceThreshold / 100).toFixed(2) }}</template>
        </el-table-column>
        <el-table-column label="更新时间" width="170">
          <template #default="{ row }">{{ formatDateTime(row.updatedAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="280" fixed="right">
          <template #default="{ row }">
            <el-button type="success" link @click="handleTransaction(row)">充值/扣费</el-button>
            <el-button type="primary" link @click="handleViewTransactions(row)">流水</el-button>
            <el-button type="warning" link @click="handleEditThreshold(row)">阈值</el-button>
            <el-button type="danger" link @click="handleDelete(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>

      <div style="margin-top: 20px; text-align: right">
        <el-pagination
          v-model:current-page="pagination.page"
          v-model:page-size="pagination.limit"
          :total="pagination.total"
          layout="total, prev, pager, next"
          @current-change="fetchData"
        />
      </div>
    </ResourcePanel>

    <!-- 新增账户 -->
    <el-dialog v-model="createDialogVisible" title="新增预付账户" width="480px">
      <el-form ref="createFormRef" :model="createForm" :rules="createRules" label-width="110px">
        <el-form-item label="租客" prop="tenantId">
          <EntitySelect v-model="createForm.tenantId" resource="tenants" />
        </el-form-item>
        <el-form-item label="房源" prop="roomId">
          <EntitySelect v-model="createForm.roomId" resource="rooms" />
        </el-form-item>
        <el-form-item label="低余额阈值(元)">
          <el-input-number v-model="createForm.thresholdYuan" :min="0" :precision="2" :step="50" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitLoading" @click="handleCreateSubmit">确定</el-button>
      </template>
    </el-dialog>

    <!-- 充值/扣费/退款/调整 -->
    <el-dialog v-model="txDialogVisible" title="账户记账" width="520px">
      <el-descriptions :column="2" border size="small" style="margin-bottom: 16px">
        <el-descriptions-item label="租客">{{ currentAccount?.tenant?.name || '—' }}</el-descriptions-item>
        <el-descriptions-item label="当前余额">
          ¥{{ ((currentAccount?.balanceCache || 0) / 100).toFixed(2) }}
        </el-descriptions-item>
      </el-descriptions>

      <el-form ref="txFormRef" :model="txForm" :rules="txRules" label-width="90px">
        <el-form-item label="类型" prop="type">
          <el-select v-model="txForm.type">
            <el-option label="充值" value="RECHARGE" />
            <el-option label="扣费" value="DEDUCTION" />
            <el-option label="退款" value="REFUND" />
            <el-option label="调整" value="ADJUSTMENT" />
          </el-select>
        </el-form-item>
        <el-form-item label="金额(元)" prop="amount">
          <el-input-number
            v-model="txForm.amount"
            :min="txForm.type === 'ADJUSTMENT' ? undefined : 0.01"
            :precision="2"
            :step="50"
          />
          <span class="tx-hint">
            {{ txForm.type === 'ADJUSTMENT' ? '可正可负（手动修正）' : '必须为正数' }}
          </span>
        </el-form-item>
        <el-form-item label="说明" prop="description">
          <el-input v-model="txForm.description" placeholder="例如：2026-10 电费充值 / 余额退还" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="txDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="txSubmitLoading" @click="handleTxSubmit">确定</el-button>
      </template>
    </el-dialog>

    <!-- 流水 -->
    <el-dialog v-model="txListDialogVisible" title="账户流水" width="720px">
      <el-table :data="transactions" v-loading="txListLoading" size="small" border>
        <el-table-column label="时间" width="160">
          <template #default="{ row }">{{ formatDateTime(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="类型" width="90">
          <template #default="{ row }">
            <el-tag :type="typeBadgeMap[row.type] || 'info'" size="small">{{ typeMap[row.type] || row.type }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="金额" width="110">
          <template #default="{ row }">
            <span :style="{ color: row.amount >= 0 ? 'var(--success-text)' : 'var(--error-text)' }">
              {{ row.amount >= 0 ? '+' : '-' }}¥{{ (Math.abs(row.amount) / 100).toFixed(2) }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="操作后余额" width="110">
          <template #default="{ row }">¥{{ (row.balanceAfter / 100).toFixed(2) }}</template>
        </el-table-column>
        <el-table-column prop="description" label="说明" show-overflow-tooltip />
      </el-table>
      <div style="margin-top: 16px; text-align: right">
        <el-pagination
          v-model:current-page="txPagination.page"
          v-model:page-size="txPagination.limit"
          :total="txPagination.total"
          layout="total, prev, pager, next"
          @current-change="loadTransactions"
        />
      </div>
      <template #footer>
        <el-button :loading="exporting" @click="handleExportAccountCsv">导出本账户流水 CSV</el-button>
        <el-button @click="txListDialogVisible = false">关闭</el-button>
      </template>
    </el-dialog>

    <!-- 编辑阈值 -->
    <el-dialog v-model="thresholdDialogVisible" title="编辑低余额阈值" width="380px">
      <el-form label-width="110px">
        <el-form-item label="阈值(元)">
          <el-input-number v-model="thresholdYuan" :min="0" :precision="2" :step="50" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="thresholdDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitLoading" @click="handleThresholdSubmit">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import ResourcePanel from '@/components/common/ResourcePanel.vue';
import ManagementMetrics from '@/components/common/ManagementMetrics.vue';
import ExportCurrent from '@/components/common/ExportCurrent.vue';
import EntitySelect from '@/components/common/EntitySelect.vue';
import type { FormInstance } from 'element-plus';
import {
  getPrepayAccounts,
  createPrepayAccount,
  updatePrepayAccount,
  deletePrepayAccount,
  addPrepayTransaction,
  getPrepayTransactions,
} from '@/api/prepay';
import type { PrepayAccount, PrepayTransaction, PrepayTransactionType } from '@/api/prepay';
import { downloadCsv } from '@/utils/export';

const loading = ref(false);
const loadError=ref('');
const submitLoading = ref(false);
const exporting = ref(false);
const tableData = ref<PrepayAccount[]>([]);
const pagination = reactive({ page: 1, limit: 20, total: 0 });

// ── 新增账户 ──
const createDialogVisible = ref(false);
const createFormRef = ref<FormInstance>();
const createForm = reactive({ tenantId: '', roomId: '', thresholdYuan: 100 });
const createRules = {
  tenantId: [{ required: true, message: '请输入租客ID', trigger: 'blur' }],
  roomId: [{ required: true, message: '请输入房间ID', trigger: 'blur' }],
};

// ── 记账 ──
const txDialogVisible = ref(false);
const txFormRef = ref<FormInstance>();
const txSubmitLoading = ref(false);
const currentAccount = ref<PrepayAccount | null>(null);
const txForm = reactive({
  type: 'RECHARGE' as PrepayTransactionType,
  amount: 0,
  description: '',
});
const txRules = {
  type: [{ required: true, message: '请选择类型', trigger: 'change' }],
  amount: [{ required: true, message: '请输入金额', trigger: 'blur' }],
  description: [{ required: true, message: '请输入说明', trigger: 'blur' }],
};

// ── 流水 ──
const txListDialogVisible = ref(false);
const txListLoading = ref(false);
const transactions = ref<PrepayTransaction[]>([]);
const txPagination = reactive({ page: 1, limit: 20, total: 0 });

// ── 阈值 ──
const thresholdDialogVisible = ref(false);
const thresholdYuan = ref(0);

const typeMap: Record<string, string> = {
  RECHARGE: '充值',
  DEDUCTION: '扣费',
  REFUND: '退款',
  ADJUSTMENT: '调整',
};
const typeBadgeMap: Record<string, string> = {
  RECHARGE: 'success',
  DEDUCTION: 'warning',
  REFUND: 'danger',
  ADJUSTMENT: 'info',
};

const formatDateTime = (value: string) => (value ? value.replace('T', ' ').slice(0, 19) : '-');

const fetchData = async () => {
  loading.value = true;
  loadError.value='';
  try {
    const response = await getPrepayAccounts({ page: pagination.page, limit: pagination.limit });
    tableData.value = response.data;
    pagination.total = response.meta.total;
  } catch {
    loadError.value='账户列表未能更新，请检查连接后重试。';
  } finally {
    loading.value = false;
  }
};

const handleCreate = () => {
  createForm.tenantId = '';
  createForm.roomId = '';
  createForm.thresholdYuan = 100;
  createDialogVisible.value = true;
};

const handleCreateSubmit = async () => {
  if (!createFormRef.value) return;
  await createFormRef.value.validate(async (valid) => {
    if (!valid) return;
    submitLoading.value = true;
    try {
      await createPrepayAccount({
        tenantId: createForm.tenantId,
        roomId: createForm.roomId,
        lowBalanceThreshold: Math.round(createForm.thresholdYuan * 100),
      });
      ElMessage.success('创建成功');
      createDialogVisible.value = false;
      fetchData();
    } catch {
      // 请求拦截器已弹出错误提示
    } finally {
      submitLoading.value = false;
    }
  });
};

const handleTransaction = (row: PrepayAccount) => {
  currentAccount.value = row;
  txForm.type = 'RECHARGE';
  txForm.amount = 0;
  txForm.description = '';
  txDialogVisible.value = true;
};

const handleTxSubmit = async () => {
  const account = currentAccount.value;
  if (!txFormRef.value || !account) return;
  await txFormRef.value.validate(async (valid) => {
    if (!valid) return;
    txSubmitLoading.value = true;
    try {
      await addPrepayTransaction(account.id, {
        type: txForm.type,
        amount: Math.round(txForm.amount * 100),
        description: txForm.description,
      });
      ElMessage.success('记账成功');
      txDialogVisible.value = false;
      fetchData();
    } catch {
      // 请求拦截器已弹出错误提示（含余额不足等业务信息）
    } finally {
      txSubmitLoading.value = false;
    }
  });
};

const loadTransactions = async () => {
  const account = currentAccount.value;
  if (!account) return;
  txListLoading.value = true;
  try {
    const response = await getPrepayTransactions(account.id, {
      page: txPagination.page,
      limit: txPagination.limit,
    });
    transactions.value = response.data;
    txPagination.total = response.meta.total;
  } catch {
    // 请求拦截器已弹出错误提示
  } finally {
    txListLoading.value = false;
  }
};

const handleExportCsv = async () => {
  exporting.value = true;
  try {
    await downloadCsv(
      '/prepay-accounts/transactions/export',
      {},
      `预付流水汇总_${new Date().toISOString().split('T')[0]}.csv`,
    );
    ElMessage.success('导出成功');
  } catch {
    ElMessage.error('导出失败');
  } finally {
    exporting.value = false;
  }
};

const handleExportAccountCsv = async () => {
  const account = currentAccount.value;
  if (!account) return;
  exporting.value = true;
  try {
    await downloadCsv(
      '/prepay-accounts/transactions/export',
      { prepayAccountId: account.id },
      `预付账户流水_${account.roomNumber || account.roomId}_${new Date().toISOString().split('T')[0]}.csv`,
    );
    ElMessage.success('导出成功');
  } catch {
    ElMessage.error('导出失败');
  } finally {
    exporting.value = false;
  }
};

const handleViewTransactions = (row: PrepayAccount) => {
  currentAccount.value = row;
  txPagination.page = 1;
  txListDialogVisible.value = true;
  loadTransactions();
};

const handleEditThreshold = (row: PrepayAccount) => {
  currentAccount.value = row;
  thresholdYuan.value = row.lowBalanceThreshold / 100;
  thresholdDialogVisible.value = true;
};

const handleThresholdSubmit = async () => {
  const account = currentAccount.value;
  if (!account) return;
  submitLoading.value = true;
  try {
    await updatePrepayAccount(account.id, {
      lowBalanceThreshold: Math.round(thresholdYuan.value * 100),
    });
    ElMessage.success('更新成功');
    thresholdDialogVisible.value = false;
    fetchData();
  } catch {
    // 请求拦截器已弹出错误提示
  } finally {
    submitLoading.value = false;
  }
};

const handleDelete = async (row: PrepayAccount) => {
  try {
    await ElMessageBox.confirm(
      '确定删除该预付账户吗？其流水记录将一并删除，不可恢复。',
      '删除预付账户',
      { type: 'warning', confirmButtonText: '确定删除', cancelButtonText: '取消' },
    );
    await deletePrepayAccount(row.id);
    ElMessage.success('删除成功');
    fetchData();
  } catch (error: any) {
    if (error !== 'cancel') {
      // 请求拦截器已弹出错误提示
    }
  }
};

onMounted(fetchData);
</script>

<style scoped>
.prepay-page {
  padding: 0;
}

.low-balance {
  color: var(--error-text);
  font-weight: 600;
}

.tx-hint {
  margin-left: 8px;
  color: var(--text-muted);
  font-size: 12px;
}
</style>
