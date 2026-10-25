<template>
  <div class="announcements-page">
    <ResourcePanel
      title="公告与定向消息"
      description="公告发布后会进入租客的通知中心；定向范围按楼栋、标签或指定租客解析，重发不会重复打扰。"
      :count="pagination.total"
      :loading="loading"
      :error="loadError || undefined"
      @retry="fetchData"
    >
      <template #actions>
        <el-button :loading="loading" @click="fetchData">刷新</el-button>
        <el-button type="primary" @click="openCreate">新建公告</el-button>
      </template>

      <div class="resource-tabs">
        <button
          v-for="tab in statusTabs"
          :key="tab.value"
          :class="{ active: statusFilter === tab.value }"
          @click="statusFilter = tab.value; handleFilterChange()"
        >
          {{ tab.label }}
        </button>
      </div>

      <el-form :inline="true">
        <el-form-item label="搜索">
          <el-input
            v-model="search"
            placeholder="标题或正文…"
            :maxlength="100"
            clearable
            @keyup.enter="handleFilterChange"
          />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="handleFilterChange">查询</el-button>
          <el-button @click="search = ''; statusFilter = ''; handleFilterChange()">重置</el-button>
        </el-form-item>
      </el-form>

      <el-table :data="tableData" v-loading="loading" empty-text="暂无公告" data-test="announcement-table">
        <el-table-column label="标题" min-width="220">
          <template #default="{ row }">
            <div class="announcement-title">
              <strong>{{ row.title }}</strong>
              <small>{{ row.body }}</small>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="范围" width="160">
          <template #default="{ row }">
            {{ audienceLabel(row.audience) }}
            <small v-if="row.audience !== 'ALL_TENANTS'" class="muted">（{{ row.targetIds.length }} 项）</small>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="110">
          <template #default="{ row }">
            <el-tag :type="statusTagType(row.status)" size="small">{{ statusLabel(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="接收人数" width="100">
          <template #default="{ row }">{{ row.status === 'DRAFT' ? '-' : row.recipientCount }}</template>
        </el-table-column>
        <el-table-column label="发布时间" width="170">
          <template #default="{ row }">{{ formatTime(row.publishedAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="220" fixed="right">
          <template #default="{ row }">
            <div class="table-actions">
              <el-button v-if="row.status === 'DRAFT'" class="table-action" @click="openEdit(row as Announcement)">编辑</el-button>
              <el-button
                v-if="row.status !== 'ARCHIVED'"
                class="table-action"
                :loading="publishingId === row.id"
                @click="handlePublish(row as Announcement)"
              >
                {{ row.status === 'PUBLISHED' ? '重发' : '发布' }}
              </el-button>
              <el-button v-if="row.status !== 'ARCHIVED'" class="table-action" @click="handleArchive(row as Announcement)">归档</el-button>
              <el-button
                v-if="row.status === 'DRAFT'"
                class="table-action table-action--danger"
                @click="handleDelete(row as Announcement)"
              >
                删除
              </el-button>
            </div>
          </template>
        </el-table-column>
      </el-table>

      <div class="pagination">
        <el-pagination
          v-model:current-page="pagination.page"
          v-model:page-size="pagination.limit"
          :total="pagination.total"
          :page-sizes="[10, 20, 50]"
          layout="total, sizes, prev, pager, next"
          @current-change="fetchData"
          @size-change="handleFilterChange"
        />
      </div>
    </ResourcePanel>

    <el-dialog v-model="dialogVisible" :title="editingId ? '编辑公告' : '新建公告'" width="640px">
      <el-alert
        v-if="editingId && editingStatus !== 'DRAFT'"
        type="warning"
        :closable="false"
        show-icon
        title="已发布公告不可编辑，请归档后重新创建"
      />
      <el-form ref="formRef" :model="form" :rules="rules" label-width="110px">
        <el-form-item label="标题" prop="title">
          <el-input v-model="form.title" maxlength="200" show-word-limit placeholder="例如：本周六上午停水通知" />
        </el-form-item>
        <el-form-item label="正文" prop="body">
          <el-input
            v-model="form.body"
            type="textarea"
            :rows="5"
            maxlength="5000"
            show-word-limit
            placeholder="说明时间、范围与需要租客配合的事项"
          />
        </el-form-item>
        <el-form-item label="优先级">
          <el-radio-group v-model="form.priority">
            <el-radio value="NORMAL">普通</el-radio>
            <el-radio value="URGENT">紧急（同时发邮件）</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="发送范围">
          <el-radio-group v-model="form.audience" @change="handleAudienceChange">
            <el-radio value="ALL_TENANTS">全部在租租客</el-radio>
            <el-radio value="BUILDING">按楼栋</el-radio>
            <el-radio value="TAGS">按标签</el-radio>
            <el-radio value="TENANTS">指定租客</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item v-if="form.audience === 'BUILDING'" label="楼栋">
          <el-select v-model="form.targetIds" multiple filterable placeholder="选择楼栋" style="width: 100%">
            <el-option v-for="b in buildings" :key="b.id" :label="b.name" :value="b.id" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="form.audience === 'TAGS'" label="标签">
          <el-select v-model="form.targetIds" multiple filterable placeholder="选择标签" style="width: 100%">
            <el-option v-for="t in tags" :key="t.id" :label="t.name" :value="t.id" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="form.audience === 'TENANTS'" label="租客">
          <el-select
            v-model="form.targetIds"
            multiple
            filterable
            remote
            reserve-keyword
            :remote-method="searchTenants"
            :loading="tenantLoading"
            placeholder="输入姓名或手机号搜索"
            style="width: 100%"
          >
            <el-option v-for="t in tenants" :key="t.id" :label="`${t.name}（${t.phone}）`" :value="t.id" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="!editingId" label="立即发布">
          <el-switch v-model="form.publish" />
          <span class="muted">关闭则先保存草稿，稍后手动发布</span>
        </el-form-item>
        <el-form-item label="过期时间">
          <el-date-picker
            v-model="form.expiredAt"
            type="datetime"
            value-format="YYYY-MM-DDTHH:mm:ss.SSSZ"
            placeholder="留空表示不过期"
            style="width: 100%"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="handleSubmit">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus';
import ResourcePanel from '@/components/common/ResourcePanel.vue';
import {
  archiveAnnouncement,
  createAnnouncement,
  deleteAnnouncement,
  getAnnouncements,
  publishAnnouncement,
  updateAnnouncement,
  type Announcement,
  type AnnouncementAudience,
  type AnnouncementPayload,
  type AnnouncementPublishResult,
  type AnnouncementStatus,
} from '@/api/announcements';
import { getBuildings } from '@/api/buildings';
import { getTags, type Tag } from '@/api/tags';
import { getTenants } from '@/api/tenants';
import type { Building, Tenant } from '@/types';

const statusTabs: Array<{ value: '' | AnnouncementStatus; label: string }> = [
  { value: '', label: '全部' },
  { value: 'DRAFT', label: '草稿' },
  { value: 'PUBLISHED', label: '已发布' },
  { value: 'ARCHIVED', label: '已归档' },
];

const loading = ref(false);
const loadError = ref('');
const search = ref('');
const statusFilter = ref<'' | AnnouncementStatus>('');
const tableData = ref<Announcement[]>([]);
const pagination = reactive({ page: 1, limit: 20, total: 0 });

const dialogVisible = ref(false);
const editingId = ref('');
const editingStatus = ref<AnnouncementStatus>('DRAFT');
const saving = ref(false);
const publishingId = ref('');
const formRef = ref<FormInstance>();

const buildings = ref<Building[]>([]);
const tags = ref<Tag[]>([]);
const tenants = ref<Tenant[]>([]);
const tenantLoading = ref(false);

const form = reactive<AnnouncementPayload & { targetIds: string[] }>({
  title: '',
  body: '',
  priority: 'NORMAL',
  audience: 'ALL_TENANTS',
  targetIds: [],
  publish: false,
  expiredAt: undefined,
});

const rules: FormRules = {
  title: [{ required: true, message: '请填写标题', trigger: 'blur' }],
  body: [{ required: true, message: '请填写正文', trigger: 'blur' }],
};

const audienceLabel = (audience: AnnouncementAudience) =>
  ({ ALL_TENANTS: '全部在租租客', BUILDING: '按楼栋', TAGS: '按标签', TENANTS: '指定租客' })[audience];

const statusLabel = (status: AnnouncementStatus) =>
  ({ DRAFT: '草稿', PUBLISHED: '已发布', ARCHIVED: '已归档' })[status];

const statusTagType = (status: AnnouncementStatus) =>
  status === 'PUBLISHED' ? 'success' : status === 'ARCHIVED' ? 'info' : 'warning';

const formatTime = (value?: string | null) => (value ? new Date(value).toLocaleString('zh-CN') : '-');

const fetchData = async () => {
  loading.value = true;
  loadError.value = '';
  try {
    const res = await getAnnouncements({
      page: pagination.page,
      limit: pagination.limit,
      status: statusFilter.value || undefined,
      q: search.value.trim() || undefined,
    });
    tableData.value = res.data ?? [];
    pagination.total = res.meta?.total ?? 0;
  } catch {
    loadError.value = '公告列表未能加载，请检查连接后重试。';
  } finally {
    loading.value = false;
  }
};

const handleFilterChange = () => {
  pagination.page = 1;
  void fetchData();
};

const loadReferenceData = async () => {
  try {
    const buildingRes = await getBuildings({ page: 1, limit: 100 });
    buildings.value = buildingRes.data ?? [];
  } catch {
    buildings.value = [];
  }
  try {
    tags.value = await getTags();
  } catch {
    tags.value = [];
  }
};

const searchTenants = async (keyword: string) => {
  tenantLoading.value = true;
  try {
    const res = await getTenants({ page: 1, limit: 20, name: keyword || undefined });
    tenants.value = res.data ?? [];
  } catch {
    tenants.value = [];
  } finally {
    tenantLoading.value = false;
  }
};

const resetForm = () => {
  form.title = '';
  form.body = '';
  form.priority = 'NORMAL';
  form.audience = 'ALL_TENANTS';
  form.targetIds = [];
  form.publish = false;
  form.expiredAt = undefined;
};

const handleAudienceChange = () => {
  form.targetIds = [];
  if (form.audience === 'TENANTS' && tenants.value.length === 0) void searchTenants('');
};

const openCreate = () => {
  editingId.value = '';
  editingStatus.value = 'DRAFT';
  resetForm();
  dialogVisible.value = true;
  void loadReferenceData();
};

const openEdit = (row: Announcement) => {
  editingId.value = row.id;
  editingStatus.value = row.status;
  form.title = row.title;
  form.body = row.body;
  form.priority = row.priority;
  form.audience = row.audience;
  form.targetIds = [...(row.targetIds ?? [])];
  form.publish = false;
  form.expiredAt = row.expiredAt ?? undefined;
  dialogVisible.value = true;
  void loadReferenceData();
};

const summarizePublish = (result: AnnouncementPublishResult) => {
  if (result.failed > 0) {
    ElMessage.warning(`已送达 ${result.recipients - result.failed} / ${result.recipients} 人，${result.failed} 人失败`);
  } else {
    ElMessage.success(`已发送给 ${result.recipients} 位租客`);
  }
};

const handleSubmit = async () => {
  if (!formRef.value) return;
  const valid = await formRef.value.validate().catch(() => false);
  if (!valid) return;

  const payload: AnnouncementPayload = {
    title: form.title.trim(),
    body: form.body.trim(),
    priority: form.priority,
    audience: form.audience,
    targetIds: form.audience === 'ALL_TENANTS' ? [] : form.targetIds,
    publish: form.publish,
    expiredAt: form.expiredAt || undefined,
  };

  saving.value = true;
  try {
    if (editingId.value) {
      await updateAnnouncement(editingId.value, payload);
      ElMessage.success('公告已更新');
    } else {
      const result = await createAnnouncement(payload);
      if ('recipients' in result) summarizePublish(result);
      else ElMessage.success('草稿已保存');
    }
    dialogVisible.value = false;
    await fetchData();
  } finally {
    saving.value = false;
  }
};

const handlePublish = async (row: Announcement) => {
  publishingId.value = row.id;
  try {
    const result = await publishAnnouncement(row.id);
    summarizePublish(result);
    await fetchData();
  } finally {
    publishingId.value = '';
  }
};

const handleArchive = async (row: Announcement) => {
  try {
    await ElMessageBox.confirm(
      '归档后公告不再出现在默认列表，但已送达的通知仍保留在租客通知中心。',
      '归档公告',
      { type: 'warning' },
    );
  } catch {
    return;
  }
  await archiveAnnouncement(row.id);
  ElMessage.success('公告已归档');
  await fetchData();
};

const handleDelete = async (row: Announcement) => {
  try {
    await ElMessageBox.confirm('删除草稿后无法恢复，确定继续？', '删除草稿', { type: 'warning' });
  } catch {
    return;
  }
  await deleteAnnouncement(row.id);
  ElMessage.success('草稿已删除');
  if (tableData.value.length === 1 && pagination.page > 1) pagination.page -= 1;
  await fetchData();
};

onMounted(() => {
  void fetchData();
});
</script>

<style scoped>
.announcement-title {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.announcement-title small {
  color: var(--q-text-muted, #6b7280);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.muted {
  color: var(--q-text-muted, #6b7280);
  font-size: 12px;
}
</style>
