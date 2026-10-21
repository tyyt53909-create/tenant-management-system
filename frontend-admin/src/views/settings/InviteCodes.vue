<template>
  <div class="invite-codes-view">
    <div class="invite-codes-toolbar">
      <el-form :inline="true" :model="queryForm" class="toolbar-form">
        <el-form-item label="关键字">
          <el-input
            v-model="queryForm.search"
            placeholder="搜索邀请码或备注"
            clearable
            @keyup.enter="handleQuery"
          />
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="queryForm.status" placeholder="全部状态" clearable style="width: 130px">
            <el-option label="全部" value="" />
            <el-option label="未使用" value="UNUSED" />
            <el-option label="已使用" value="USED" />
            <el-option label="已作废" value="REVOKED" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="handleQuery">查询</el-button>
          <el-button @click="handleReset">重置</el-button>
        </el-form-item>
      </el-form>

      <div class="toolbar-actions">
        <el-button type="primary" @click="openGenerateDialog">
          ＋ 生成邀请码
        </el-button>
        <el-button @click="fetchData">刷新</el-button>
      </div>
    </div>

    <el-table
      :data="tableData"
      v-loading="loading"
      stripe
      border
      style="width: 100%"
      empty-text="暂无邀请码记录"
    >
      <el-table-column prop="code" label="邀请码 / 备注" min-width="240">
        <template #default="{ row }">
          <div class="invite-code-cell">
            <div class="code-cell">
              <code class="code-text" :title="row.code">{{ row.code }}</code>
              <el-button class="table-action" @click="copyText(row.code)" title="复制邀请码">复制</el-button>
            </div>
            <small class="invite-notes" :title="row.notes || '无备注'">{{ row.notes || '无备注' }}</small>
          </div>
        </template>
      </el-table-column>

      <el-table-column label="角色 / 状态" width="130" align="center">
        <template #default="{ row }">
          <div class="invite-state">
            <el-tag size="small" :type="row.role === 'ADMIN' ? 'warning' : 'primary'">
              {{ row.role === 'ADMIN' ? '管理员' : '租客' }}
            </el-tag>
            <el-tag
              size="small"
              :type="row.status === 'UNUSED' ? 'success' : row.status === 'USED' ? 'info' : 'danger'"
            >
              {{ row.status === 'UNUSED' ? '未使用' : row.status === 'USED' ? '已使用' : '已作废' }}
            </el-tag>
          </div>
        </template>
      </el-table-column>

      <el-table-column label="创建 / 有效期" width="170">
        <template #default="{ row }">
          <div class="invite-dates">
            <strong>创建 {{ formatDate(row.createdAt) }}</strong>
            <small>至 {{ formatDate(row.expiresAt) }}</small>
          </div>
        </template>
      </el-table-column>

      <el-table-column label="核销 / 使用人" width="180">
        <template #default="{ row }">
          <div class="invite-used">
            <strong :title="row.usedBy?.email || row.usedBy?.phone || '未核销'">
              {{ row.usedBy?.email || row.usedBy?.phone || '未核销' }}
            </strong>
            <small>{{ row.usedAt ? formatDate(row.usedAt) : '—' }}</small>
          </div>
        </template>
      </el-table-column>

      <el-table-column label="操作" width="110" fixed="right" align="center">
        <template #default="{ row }">
          <el-button
            class="table-action table-action--danger"
            :disabled="row.status !== 'UNUSED'"
            @click="handleRevoke(row as InviteCode)"
          >
            作废
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <div class="pagination-container">
      <el-pagination
        v-model:current-page="pagination.page"
        v-model:page-size="pagination.limit"
        :total="pagination.total"
        :page-sizes="[10, 20, 50, 100]"
        layout="total, sizes, prev, pager, next, jumper"
        @size-change="fetchData"
        @current-change="fetchData"
      />
    </div>

    <!-- 生成邀请码对话框 -->
    <el-dialog
      v-model="generateDialogVisible"
      title="生成邀请码"
      width="480px"
      :close-on-click-modal="false"
    >
      <el-form :model="generateForm" label-width="100px">
        <el-form-item label="生成数量">
          <el-input-number
            v-model="generateForm.count"
            :min="1"
            :max="100"
            controls-position="right"
          />
          <span class="form-tip">支持批量生成 1~100 个独立邀请码</span>
        </el-form-item>

        <el-form-item label="目标角色">
          <el-select v-model="generateForm.role" style="width: 100%">
            <el-option label="租客 (TENANT)" value="TENANT" />
            <el-option label="管理员 (ADMIN)" value="ADMIN" />
          </el-select>
        </el-form-item>

        <el-form-item label="有效天数">
          <el-input-number
            v-model="generateForm.expiryDays"
            :min="1"
            :max="3650"
            controls-position="right"
          />
          <span class="form-tip">天数（默认 365 天）</span>
        </el-form-item>

        <el-form-item label="备注说明">
          <el-input
            v-model="generateForm.notes"
            placeholder="例如：2026秋季招租 / 1号楼租客"
            maxlength="100"
            show-word-limit
          />
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="generateDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="generating" @click="submitGenerate">
          确认生成
        </el-button>
      </template>
    </el-dialog>

    <!-- 生成结果对话框 -->
    <el-dialog
      v-model="resultDialogVisible"
      title="邀请码生成成功"
      width="540px"
    >
      <p class="result-summary">
        本次已成功生成 <strong>{{ generatedCodes.length }}</strong> 个独立邀请码，每个邀请码仅可兑换一次：
      </p>
      <el-input
        type="textarea"
        :rows="Math.min(generatedCodes.length, 10)"
        :value="generatedCodes.join('\n')"
        readonly
      />
      <template #footer>
        <el-button type="primary" @click="copyAllGenerated">复制全部邀请码</el-button>
        <el-button @click="resultDialogVisible = false">关闭</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { getInviteCodes, generateInviteCode, revokeInviteCode } from '@/api/auth';
import type { InviteCode } from '@/types';
import { usePagedTable } from '@/composables';

const generating = ref(false);

const {
  loading,
  tableData,
  pagination,
  queryForm,
  fetchData,
  handleQuery,
  handleReset,
} = usePagedTable<InviteCode, { search: string; status: string }>({
  fetchApi: (params) =>
    getInviteCodes({
      page: params.page,
      limit: params.limit,
      search: params.search || undefined,
      status: params.status || undefined,
    }),
  defaultQuery: { search: '', status: '' },
});

const generateDialogVisible = ref(false);
const generateForm = reactive({
  count: 1,
  role: 'TENANT' as 'TENANT' | 'ADMIN',
  expiryDays: 365,
  notes: '',
});

const resultDialogVisible = ref(false);
const generatedCodes = ref<string[]>([]);

const openGenerateDialog = () => {
  generateForm.count = 1;
  generateForm.role = 'TENANT';
  generateForm.expiryDays = 365;
  generateForm.notes = '';
  generateDialogVisible.value = true;
};

const submitGenerate = async () => {
  generating.value = true;
  try {
    const res: any = await generateInviteCode({
      count: generateForm.count,
      role: generateForm.role,
      expiryDays: generateForm.expiryDays,
      notes: generateForm.notes?.trim() || undefined,
    });

    generateDialogVisible.value = false;
    ElMessage.success('邀请码生成成功');

    if (res.inviteCodes && Array.isArray(res.inviteCodes)) {
      generatedCodes.value = res.inviteCodes;
    } else if (res.inviteCode) {
      generatedCodes.value = [res.inviteCode];
    } else {
      generatedCodes.value = [];
    }

    resultDialogVisible.value = true;
    fetchData();
  } catch (error: any) {
    ElMessage.error(error?.response?.data?.message || '生成邀请码失败');
  } finally {
    generating.value = false;
  }
};

const handleRevoke = (row: InviteCode) => {
  ElMessageBox.confirm(
    `确定要作废邀请码 "${row.code}" 吗？作废后将无法使用。`,
    '作废确认',
    {
      confirmButtonText: '作废',
      cancelButtonText: '取消',
      type: 'warning',
    },
  )
    .then(async () => {
      await revokeInviteCode(row.id);
      ElMessage.success('邀请码已作废');
      fetchData();
    })
    .catch(() => {});
};

const copyText = async (text: string) => {
  try {
    await navigator.clipboard.writeText(text);
    ElMessage.success('邀请码已复制到剪贴板');
  } catch {
    ElMessage.info(`请手动复制：${text}`);
  }
};

const copyAllGenerated = async () => {
  try {
    await navigator.clipboard.writeText(generatedCodes.value.join('\n'));
    ElMessage.success('所有邀请码已复制到剪贴板');
  } catch {
    ElMessage.info('复制失败，请在文本框中手动全选复制');
  }
};

const formatDate = (val?: string | null) => {
  if (!val) return '—';
  const d = new Date(val);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
};

onMounted(() => {
  fetchData();
});
</script>

<style scoped>
.invite-codes-view {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.invite-codes-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  flex-wrap: wrap;
  gap: 12px;
}

.toolbar-form {
  margin-bottom: 0;
}

.toolbar-actions {
  display: flex;
  gap: 8px;
}

.invite-code-cell {
  min-width: 0;
}

.code-cell {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.code-text {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-weight: 600;
  font-size: var(--font-micro);
  text-overflow: ellipsis;
  white-space: nowrap;
  background: var(--el-fill-color-light, #f5f7fa);
  padding: 2px 5px;
  border-radius: 4px;
}

.code-cell .table-action {
  flex-shrink: 0;
}

.invite-notes {
  display: block;
  margin-top: 4px;
  overflow: hidden;
  color: var(--text-muted);
  font-size: var(--font-micro);
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.invite-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}
.invite-state :deep(.el-tag) {
  height: 18px;
  padding: 0 5px;
  font-size: var(--font-micro);
}

.invite-dates strong,
.invite-used strong {
  display: block;
  overflow: hidden;
  color: var(--text-primary);
  font-size: var(--font-micro);
  font-weight: 600;
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.invite-dates small,
.invite-used small {
  display: block;
  margin-top: 4px;
  overflow: hidden;
  color: var(--text-muted);
  font-size: var(--font-micro);
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pagination-container {
  display: flex;
  justify-content: flex-end;
  margin-top: 12px;
}

.form-tip {
  margin-left: 12px;
  color: var(--el-text-color-secondary, var(--text-muted));
  font-size: 12px;
}

.result-summary {
  margin-bottom: 12px;
  font-size: 14px;
  color: var(--el-text-color-primary, #303133);
}
</style>
