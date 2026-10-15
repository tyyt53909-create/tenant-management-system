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
        <el-table-column prop="name" label="租客" min-width="215" sortable><template #default="{row}"><button class="record-cell" @click="openDetail(row)"><span class="record-avatar">{{ row.name?.slice(0,1) }}</span><span><strong>{{ row.name }}</strong><small>{{ row.phone || '尚未填写电话' }}</small></span></button></template></el-table-column>
        <el-table-column label="关联房源" min-width="145"><template #default="{row}"><strong>{{ row.contracts?.[0]?.room?.roomNumber || '暂无生效租约' }}</strong><small class="table-subline">{{ row.contracts?.[0]?.contractNumber || '可查看历史合同' }}</small></template></el-table-column>
        <el-table-column label="入住 / 到期" width="150"><template #default="{row}">{{ row.contracts?.[0]?.startDate?.slice(0,10) || '—' }}<small class="table-subline">{{ row.contracts?.[0]?.endDate?.slice(0,10) || '未记录当前租期' }}</small></template></el-table-column>
        <el-table-column label="预付余额合计" width="140"><template #default="{row}"><strong>{{ row.prepayAccounts?.length ? formatMoney(row.prepayAccounts.reduce((sum:number,account:any)=>sum+account.balanceCache,0)) : '未开通账户' }}</strong><small class="table-subline">{{ row.prepayAccounts?.length ? `${row.prepayAccounts.length} 个账户` : '不显示为零元' }}</small></template></el-table-column>
        <el-table-column label="档案 / 租约" width="115"><template #default="{row}"><el-tag :type="row.isActive ? 'success' : 'info'">{{ row.isActive ? '启用' : '停用' }}</el-tag><small class="table-subline">{{ row.contracts?.length ? '关联生效租约' : '暂无生效租约' }}</small></template></el-table-column>
        <el-table-column prop="createdAt" sort-by="createdAtSort" label="创建时间" width="180" sortable>
          <template #default="{ row }">
            {{ formatDate(row.createdAt) }}
          </template>
        </el-table-column>
        <el-table-column label="操作" width="140" fixed="right">
          <template #default="{ row }">
            <el-button type="primary" link @click="openDetail(row)">查看档案</el-button><el-dropdown><el-button text aria-label="更多租客操作">···</el-button><template #dropdown><el-dropdown-menu><el-dropdown-item @click="handleEdit(row)">编辑资料</el-dropdown-item><el-dropdown-item @click="handleDelete(row)">删除档案</el-dropdown-item></el-dropdown-menu></template></el-dropdown>
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
import ResourcePanel from '@/components/common/ResourcePanel.vue';
import ManagementMetrics from '@/components/common/ManagementMetrics.vue';
import ExportCurrent from '@/components/common/ExportCurrent.vue';
import ResourceDrawer from '@/components/common/ResourceDrawer.vue';
import type { FormInstance, FormRules } from 'element-plus';
import { getTenants, createTenant, updateTenant, deleteTenant } from '@/api/tenants';
import type { Tenant } from '@/types';
import { formatMoney } from '@/utils/table';

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
});

/** 区分「系统暂无数据」与「筛选无结果」，避免用户误以为数据丢失 */
const emptyText = computed(() =>
  queryForm.name || queryForm.phone
    ? '没有符合条件的租客，试试调整姓名或手机号'
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

const formatDate = (date: string) => {
  return new Date(date).toLocaleString('zh-CN');
};

const fetchData = async () => {
  loading.value = true;
  loadError.value='';
  try {
    const params = {
      page: pagination.page,
      limit: pagination.limit,
      ...queryForm,
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

const handleSubmit = async () => {
  if (!formRef.value) return;

  await formRef.value.validate(async (valid) => {
    if (!valid) return;

    submitLoading.value = true;
    try {
      const { idNumber: _unsupported, ...data }: any = formData;
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
  });
};

onMounted(() => {
  fetchData();
  if(typeof route.query.detail==='string'){detailId.value=route.query.detail;detailVisible.value=true;}
});
watch(()=>route.query.detail,id=>{if(typeof id==='string'){detailId.value=id;detailVisible.value=true;}});
</script>

<style scoped>
.tenants-page {
  padding: 0;
}
</style>
