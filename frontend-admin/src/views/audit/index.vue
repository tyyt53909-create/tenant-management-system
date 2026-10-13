<template>
  <div class="audit-page">
    <el-card shadow="never">
      <el-form :inline="true" :model="queryForm">
        <el-form-item label="实体类型">
          <el-select
            v-model="queryForm.entityType"
            placeholder="全部类型"
            clearable
            style="width: 170px"
            @change="handleQuery"
          >
            <el-option v-for="t in entityTypes" :key="t.value" :label="t.label" :value="t.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="实体 ID">
          <el-input
            v-model="queryForm.entityId"
            placeholder="精确匹配实体 ID"
            clearable
            style="width: 220px"
            @keyup.enter="handleQuery"
          />
        </el-form-item>
        <el-form-item label="操作者 ID">
          <el-input
            v-model="queryForm.userId"
            placeholder="精确匹配用户 ID"
            clearable
            style="width: 220px"
            @keyup.enter="handleQuery"
          />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="handleQuery">查询</el-button>
          <el-button @click="handleReset">重置</el-button>
        </el-form-item>
      </el-form>

      <el-alert
        type="info"
        :closable="false"
        show-icon
        title="审计日志由系统对所有写操作（新增/修改/删除）自动记录，不可编辑或删除。展开某行可查看当时的请求内容。"
        style="margin-bottom: 12px"
      />

      <el-table
        :data="tableData"
        v-loading="loading"
        border
        stripe
        :empty-text="emptyText"
        row-key="id"
      >
        <el-table-column type="expand">
          <template #default="{ row }">
            <div class="detail-body">
              <div class="detail-row">
                <span class="detail-label">完整动作</span>
                <span class="detail-value">{{ row.action }}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">User-Agent</span>
                <span class="detail-value">{{ row.userAgent || '—' }}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">请求内容</span>
                <pre class="detail-pre">{{ prettyChanges(row.changes) }}</pre>
              </div>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="createdAt" label="时间" width="170" sortable>
          <template #default="{ row }">{{ formatDateTime(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="操作者" width="210">
          <template #default="{ row }">
            <div v-if="row.user">
              <div>{{ row.user.email || row.user.id }}</div>
              <el-tag size="small" effect="plain">{{ roleMap[row.user.role] || row.user.role }}</el-tag>
            </div>
            <span v-else class="muted">{{ row.userId }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="action" label="操作" min-width="300" show-overflow-tooltip>
          <template #default="{ row }">
            <el-tag size="small" :type="methodType(row.action)" effect="plain">
              {{ methodOf(row.action) }}
            </el-tag>
            <span class="path-text">{{ pathOf(row.action) }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="entityType" label="实体" width="150" sortable>
          <template #default="{ row }">
            <div>{{ entityLabel(row.entityType) }}</div>
            <div class="muted small">{{ row.entityId === '-' ? '（列表操作）' : row.entityId }}</div>
          </template>
        </el-table-column>
        <el-table-column prop="ip" label="来源 IP" width="150" show-overflow-tooltip />
      </el-table>

      <div style="margin-top: 20px; text-align: right">
        <el-pagination
          v-model:current-page="pagination.page"
          v-model:page-size="pagination.limit"
          :total="pagination.total"
          :page-sizes="[20, 50, 100]"
          layout="total, sizes, prev, pager, next, jumper"
          @size-change="handleSizeChange"
          @current-change="fetchData"
        />
      </div>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import { getAuditLogs } from '@/api/audit';
import type { AuditLog } from '@/api/audit';
import { formatDateTime } from '@/utils/table';

const loading = ref(false);
const tableData = ref<AuditLog[]>([]);

const queryForm = reactive<{ entityType: string; entityId: string; userId: string }>({
  entityType: '',
  entityId: '',
  userId: '',
});

const pagination = reactive({ page: 1, limit: 20, total: 0 });

const roleMap: Record<string, string> = {
  ADMIN: '管理员',
  TENANT: '租客',
  CLEANER: '保洁',
};

/** 与后端 entityType 取值（取自 URL 首段）对应 */
const entityTypes = [
  { value: 'rooms', label: '房源' },
  { value: 'tenants', label: '租客' },
  { value: 'contracts', label: '合同' },
  { value: 'bills', label: '账单' },
  { value: 'prepay-accounts', label: '预付账户' },
  { value: 'meters', label: '水电表' },
  { value: 'maintenance', label: '报修' },
  { value: 'checkout', label: '退租' },
  { value: 'notifications', label: '通知' },
  { value: 'buildings', label: '楼栋' },
  { value: 'files', label: '文件' },
];

const entityLabel = (t: string) => entityTypes.find((x) => x.value === t)?.label || t;

const emptyText = computed(() =>
  queryForm.entityType || queryForm.entityId || queryForm.userId
    ? '没有符合条件的审计记录，试试调整筛选条件'
    : '暂无审计记录（系统会在产生写操作后自动记录）',
);

/** action 形如 "POST /api/rooms"，拆出方法与路径分别展示 */
const methodOf = (action: string) => (action || '').split(' ')[0] || '—';
const pathOf = (action: string) => (action || '').split(' ').slice(1).join(' ') || '';

const methodType = (action: string) => {
  const m = methodOf(action);
  if (m === 'POST') return 'success';
  if (m === 'PATCH' || m === 'PUT') return 'warning';
  if (m === 'DELETE') return 'danger';
  return 'info';
};

const prettyChanges = (changes: Record<string, unknown> | null) => {
  if (!changes) return '（无）';
  try {
    return JSON.stringify(changes, null, 2);
  } catch {
    return String(changes);
  }
};

const fetchData = async () => {
  loading.value = true;
  try {
    // 空字符串会被后端 @IsString 通过但语义上等于不筛选，
    // 这里显式剔除，避免发出无意义参数
    const params: Record<string, string | number> = {
      page: pagination.page,
      limit: pagination.limit,
    };
    if (queryForm.entityType) params.entityType = queryForm.entityType;
    if (queryForm.entityId.trim()) params.entityId = queryForm.entityId.trim();
    if (queryForm.userId.trim()) params.userId = queryForm.userId.trim();

    const res: any = await getAuditLogs(params);
    tableData.value = res.data;
    pagination.total = res.meta.total;
  } catch (error) {
    ElMessage.error('获取审计日志失败');
  } finally {
    loading.value = false;
  }
};

const handleQuery = () => {
  pagination.page = 1;
  fetchData();
};

const handleSizeChange = () => {
  pagination.page = 1;
  fetchData();
};

const handleReset = () => {
  queryForm.entityType = '';
  queryForm.entityId = '';
  queryForm.userId = '';
  handleQuery();
};

onMounted(fetchData);
</script>

<style scoped>
.audit-page { padding: 0; }
.muted { color: #909399; }
.small { font-size: 12px; }
.path-text { margin-left: 8px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
.detail-body { padding: 4px 16px 12px; }
.detail-row { display: flex; gap: 12px; margin-bottom: 10px; }
.detail-label { flex-shrink: 0; width: 90px; color: #909399; font-size: 13px; }
.detail-value { flex: 1; min-width: 0; word-break: break-all; font-size: 13px; }
.detail-pre {
  flex: 1;
  min-width: 0;
  margin: 0;
  padding: 10px 12px;
  background: #f5f7fa;
  border-radius: 4px;
  font-size: 12px;
  line-height: 1.5;
  max-height: 260px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
