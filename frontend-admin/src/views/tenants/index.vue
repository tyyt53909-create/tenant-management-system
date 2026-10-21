<template>
  <div class="tenants-page">
    <ManagementMetrics resource="tenants" />
    <ResourcePanel title="租客档案" :count="pagination.total" :loading="loading" :error="loadError" @retry="fetchData"><template #actions><ExportCurrent resource="tenants" :rows="tableData" /><el-button type="primary" @click="handleCreate">＋ 新增租客</el-button></template>
      <!-- 搜索区域 -->
      <el-form :inline="true" :model="queryForm">
        <el-form-item label="姓名">
          <el-input v-model="queryForm.name" placeholder="请输入姓名" clearable @keyup.enter="handleQuery" />
        </el-form-item>
        <el-form-item label="手机号">
          <el-input v-model="queryForm.phone" placeholder="请输入手机号" clearable @keyup.enter="handleQuery" />
        </el-form-item>
        <el-form-item label="标签">
          <el-select v-model="queryForm.tagId" placeholder="全部标签" clearable style="width: 150px" @change="handleQuery">
            <el-option v-for="tag in tagOptions" :key="tag.id" :label="tag.name" :value="tag.id" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="handleQuery">查询</el-button>
          <el-button @click="handleReset">重置</el-button>
        </el-form-item>
      </el-form>

      <!-- 表格 -->
      <el-table
        :data="tableData"
        v-loading="loading"
        @row-dblclick="openDetail"
        :empty-text="emptyText"
        :default-sort="{ prop: 'createdAt', order: 'descending' }"
      >
        <el-table-column prop="name" label="租客" min-width="190" sortable>
          <template #default="{ row }">
            <button class="record-cell" @click="openDetail(row as Tenant)">
              <span class="record-avatar">{{ row.name?.slice(0, 1) }}</span>
              <span>
                <strong :title="row.name">{{ row.name }}</strong>
                <small :title="row.phone || '尚未填写电话'">{{ row.phone || '尚未填写电话' }}</small>
              </span>
            </button>
          </template>
        </el-table-column>

        <el-table-column label="房源 / 租期" min-width="185">
          <template #default="{ row }">
            <div class="tenant-lease">
              <strong :title="row.contracts?.[0]?.room?.roomNumber || '暂无生效租约'">
                {{ row.contracts?.[0]?.room?.roomNumber || '暂无生效租约' }}
              </strong>
              <small v-if="row.contracts?.[0]">
                {{ formatDateOnly(row.contracts[0].startDate) }} → {{ formatDateOnly(row.contracts[0].endDate) }}
              </small>
              <small v-else>可查看历史合同</small>
            </div>
          </template>
        </el-table-column>

        <el-table-column label="余额 / 标签" width="140">
          <template #default="{ row }">
            <div class="tenant-balance">
              <strong :title="row.prepayAccounts?.length ? `${row.prepayAccounts.length} 个账户` : '未开通账户'">
                {{ row.prepayAccounts?.length ? formatMoney(row.prepayAccounts.reduce((sum:number,account:any)=>sum+account.balanceCache,0)) : '未开通账户' }}
              </strong>
              <div v-if="row.tags?.length" class="tenant-tags">
                <el-tag v-for="tag in row.tags.slice(0, 2)" :key="tag.id" size="small" effect="plain">{{ tag.name }}</el-tag>
                <span v-if="row.tags.length > 2" class="tenant-tag-more">+{{ row.tags.length - 2 }}</span>
              </div>
              <small v-else class="tenant-tag-empty">未打标签</small>
            </div>
          </template>
        </el-table-column>

        <el-table-column label="状态" width="70">
          <template #default="{ row }">
            <el-tag :type="row.isActive ? 'success' : 'info'">{{ row.isActive ? '启用' : '停用' }}</el-tag>
          </template>
        </el-table-column>

        <el-table-column prop="createdAt" sort-by="createdAtSort" label="创建时间" width="120" sortable>
          <template #default="{ row }">{{ formatDateOnly(row.createdAt) }}</template>
        </el-table-column>

        <el-table-column label="操作" width="110" fixed="right">
          <template #default="{ row }">
            <div class="table-actions">
              <el-button class="table-action" @click="openDetail(row as Tenant)">档案</el-button>
              <el-dropdown trigger="click" @command="handleTenantCommand($event, row as Tenant)">
                <el-button class="table-action table-action--icon" aria-label="更多租客操作">
                  <el-icon><MoreFilled /></el-icon>
                </el-button>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item command="edit">编辑资料</el-dropdown-item>
                    <el-dropdown-item command="delete" divided style="color: var(--error-text)">删除档案</el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
            </div>
          </template>
        </el-table-column>
      </el-table>

      <!-- 分页 -->
      <div style="margin-top: 20px; text-align: right">
        <el-pagination
          v-model:current-page="pagination.page"
          v-model:page-size="pagination.limit"
          :total="pagination.total"
          :page-sizes="[10, 20, 50, 100]"
          layout="total, sizes, prev, pager, next, jumper"
          @size-change="handleSizeChange"
          @current-change="fetchData"
        />
      </div>
    </ResourcePanel>
    <ResourceDrawer v-model="detailVisible" resource="tenants" :id="detailId" @edit="handleEdit($event as any)" />

    <!-- 新增/编辑对话框 -->
    <el-dialog
      v-model="dialogVisible"
      :title="dialogTitle"
      width="600px"
      @close="handleDialogClose"
    >
      <el-form
        ref="formRef"
        :model="formData"
        :rules="rules"
        label-width="120px"
      >
        <el-form-item label="姓名" prop="name">
          <el-input v-model="formData.name" placeholder="请输入姓名" />
        </el-form-item>
        <el-form-item label="手机号" prop="phone">
          <el-input v-model="formData.phone" placeholder="请输入手机号" />
        </el-form-item>
        <el-form-item label="邮箱" prop="email">
          <el-input v-model="formData.email" placeholder="请输入邮箱" />
        </el-form-item>
        <el-form-item label="紧急联系人" prop="emergencyContact">
          <el-input v-model="formData.emergencyContact" placeholder="请输入紧急联系人" />
        </el-form-item>
        <el-form-item label="紧急联系电话" prop="emergencyPhone">
          <el-input v-model="formData.emergencyPhone" placeholder="请输入紧急联系电话" />
        </el-form-item>
        <el-form-item label="标签" prop="tagIds">
          <el-select
            v-model="formData.tagIds"
            multiple
            filterable
            clearable
            placeholder="选择标签（可在「系统设置 › 标签字典」维护）"
            style="width: 100%"
          >
            <el-option v-for="tag in tagOptions" :key="tag.id" :label="tag.name" :value="tag.id" />
          </el-select>
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitLoading" @click="handleSubmit">
          确定
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted,watch } from 'vue';
import { useRoute } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { MoreFilled } from '@element-plus/icons-vue';
import ResourcePanel from '@/components/common/ResourcePanel.vue';
import ManagementMetrics from '@/components/common/ManagementMetrics.vue';
import ExportCurrent from '@/components/common/ExportCurrent.vue';
import ResourceDrawer from '@/components/common/ResourceDrawer.vue';
import type { FormInstance, FormRules } from 'element-plus';
import { getTenants, createTenant, updateTenant, deleteTenant } from '@/api/tenants';
import { getTags, type Tag } from '@/api/tags';
import type { Tenant } from '@/types';
import { formatMoney, formatDateOnly } from '@/utils/table';

const loading = ref(false);
const route=useRoute();
const loadError=ref('');const detailVisible=ref(false);const detailId=ref('');
function openDetail(row:Tenant){detailId.value=row.id;detailVisible.value=true;}
const submitLoading = ref(false);
const dialogVisible = ref(false);
const dialogTitle = ref('新增租客');
const formRef = ref<FormInstance>();
const tableData = ref<Tenant[]>([]);
const currentEditId = ref<string>('');

const queryForm = reactive({
  name: '',
  phone: '',
  tagId: '',
});

/** 标签字典（T215）：筛选与表单共用，进入页面时加载一次 */
const tagOptions = ref<Tag[]>([]);
const loadTags = async () => {
  try {
    tagOptions.value = await getTags();
  } catch {
    tagOptions.value = [];
  }
};

/** 区分「系统暂无数据」与「筛选无结果」，避免用户误以为数据丢失 */
const emptyText = computed(() =>
  queryForm.name || queryForm.phone || queryForm.tagId
    ? '没有符合条件的租客，试试调整姓名、手机号或标签'
    : '暂无租客，点击右上角「新增租客」开始录入',
);

const pagination = reactive({
  page: 1,
  limit: 20,
  total: 0,
});

const formData = reactive({
  name: '',
  phone: '',
  email: '',
  idNumber: '',
  emergencyContact: '',
  emergencyPhone: '',
  tagIds: [] as string[],
});

const rules: FormRules = {
  name: [{ required: true, message: '请输入姓名', trigger: 'blur' }],
  phone: [
    { required: true, message: '请输入手机号', trigger: 'blur' },
    { pattern: /^1[3-9]\d{9}$/, message: '请输入正确的手机号', trigger: 'blur' },
  ],
  email: [
    { type: 'email', message: '请输入正确的邮箱', trigger: 'blur' },
  ],
};

const fetchData = async () => {
  loading.value = true;
  loadError.value='';
  try {
    const params = {
      page: pagination.page,
      limit: pagination.limit,
      ...queryForm,
      // 空标签不参与筛选，避免后端收到 tagId=
      tagId: queryForm.tagId || undefined,
    };
    const response = await getTenants(params);
    // 派生可排序的时间串（与表格显示格式一致，避免与 ISO 原值不一致）
    tableData.value = (response.data as Tenant[]).map((t) => ({
      ...t,
      createdAtSort: t.createdAt ? String(t.createdAt).replace('T', ' ').slice(0, 19) : '',
    })) as Tenant[];
    pagination.total = response.meta.total;
  } catch (error) {
    loadError.value='租客列表未能更新，已保留上一次记录。请重试。';
  } finally {
    loading.value = false;
  }
};

const handleQuery = () => {
  pagination.page = 1;
  fetchData();
};

/** 每页条数变化：回到第 1 页再拉取（页码变化不走这里，避免翻页被重置） */
const handleSizeChange = () => {
  pagination.page = 1;
  fetchData();
};

const handleReset = () => {
  queryForm.name = '';
  queryForm.phone = '';
  queryForm.tagId = '';
  handleQuery();
};

const handleCreate = () => {
  handleDialogClose();
  dialogTitle.value = '新增租客';
  currentEditId.value = '';
  dialogVisible.value = true;
};

const handleEdit = (row: Tenant) => {
  dialogTitle.value = '编辑租客';
  currentEditId.value = row.id;
  Object.assign(formData, {
    name: row.name,
    phone: row.phone,
    email: row.email,
    idNumber: '',
    emergencyContact: row.emergencyContact || '',
    emergencyPhone: row.emergencyPhone || '',
    tagIds: (row.tags || []).map((tag) => tag.id),
  });
  dialogVisible.value = true;
};

const handleDelete = async (row: Tenant) => {
  try {
    await ElMessageBox.confirm(
      `确定删除租客「${row.name || row.id}」吗？\n若其名下仍有合同或账单，删除会被后端拒绝。`,
      '删除租客',
      { type: 'warning', confirmButtonText: '确定删除', cancelButtonText: '取消' },
    );
    await deleteTenant(row.id);
    ElMessage.success('删除成功');
    fetchData();
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error('删除失败');
    }
  }
};

function handleTenantCommand(command: string, row: Tenant) {
  if (command === 'edit') handleEdit(row);
  else if (command === 'delete') void handleDelete(row);
}

const handleSubmit = async () => {
  if (!formRef.value) return;

  await formRef.value.validate(async (valid) => {
    if (!valid) return;

    submitLoading.value = true;
    try {
      const { idNumber: _unsupported, tagIds, ...data }: any = formData;
      // 标签以 tagIds 单独提交（T215）；空数组表示清空标签
      data.tagIds = tagIds;
      if(!data.email)delete data.email;

      if (currentEditId.value) {
        await updateTenant(currentEditId.value, data);
        ElMessage.success('更新成功');
      } else {
        await createTenant(data);
        ElMessage.success('创建成功');
      }

      dialogVisible.value = false;
      fetchData();
    } catch (error) {
      ElMessage.error('操作失败');
    } finally {
      submitLoading.value = false;
    }
  });
};

const handleDialogClose = () => {
  formRef.value?.resetFields();
  Object.assign(formData, {
    name: '',
    phone: '',
    email: '',
    idNumber: '',
    emergencyContact: '',
    emergencyPhone: '',
    tagIds: [],
  });
};

onMounted(() => {
  loadTags();
  fetchData();
  if(typeof route.query.detail==='string'){detailId.value=route.query.detail;detailVisible.value=true;}
});
watch(()=>route.query.detail,id=>{if(typeof id==='string'){detailId.value=id;detailVisible.value=true;}});
</script>

<style scoped>
.tenants-page {
  padding: 0;
}

.tenant-lease strong,
.tenant-balance strong {
  display: block;
  overflow: hidden;
  color: var(--text-primary);
  font-size: 12px;
  font-weight: 650;
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tenant-lease small {
  display: block;
  margin-top: 4px;
  overflow: hidden;
  color: var(--text-muted);
  font-size: var(--font-micro);
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tenant-tags {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  margin-top: 5px;
}
.tenant-tags :deep(.el-tag) {
  height: 18px;
  padding: 0 5px;
  font-size: var(--font-micro);
}
.tenant-tag-more {
  color: var(--text-muted);
  font-size: var(--font-micro);
  line-height: 18px;
}
.tenant-tag-empty {
  display: block;
  margin-top: 5px;
  color: var(--text-muted);
  font-size: var(--font-micro);
  line-height: 1.35;
}
</style>
