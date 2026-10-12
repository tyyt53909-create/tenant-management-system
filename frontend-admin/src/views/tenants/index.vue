<template>
  <div class="tenants-page">
    <el-card>
      <!-- 搜索区域 -->
      <el-form :inline="true" :model="queryForm">
        <el-form-item label="姓名">
          <el-input v-model="queryForm.name" placeholder="请输入姓名" clearable />
        </el-form-item>
        <el-form-item label="手机号">
          <el-input v-model="queryForm.phone" placeholder="请输入手机号" clearable />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="handleQuery">查询</el-button>
          <el-button @click="handleReset">重置</el-button>
          <el-button type="primary" @click="handleCreate">新增租客</el-button>
        </el-form-item>
      </el-form>

      <!-- 表格 -->
      <el-table :data="tableData" v-loading="loading" border stripe>
        <el-table-column prop="name" label="姓名" width="120" />
        <el-table-column prop="phone" label="手机号" width="140" />
        <el-table-column prop="email" label="邮箱" width="200" />
        <el-table-column prop="idNumber" label="身份证号" width="180">
          <template #default="{ row }">
            {{ maskIdNumber(row.idNumber) }}
          </template>
        </el-table-column>
        <el-table-column prop="emergencyContact" label="紧急联系人" width="120" />
        <el-table-column prop="emergencyPhone" label="紧急联系电话" width="140" />
        <el-table-column prop="createdAt" label="创建时间" width="180">
          <template #default="{ row }">
            {{ formatDate(row.createdAt) }}
          </template>
        </el-table-column>
        <el-table-column label="操作" width="180" fixed="right">
          <template #default="{ row }">
            <el-button type="primary" link @click="handleEdit(row)">编辑</el-button>
            <el-button type="danger" link @click="handleDelete(row)">删除</el-button>
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
          @size-change="handleQuery"
          @current-change="handleQuery"
        />
      </div>
    </el-card>

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
        <el-form-item label="身份证号" prop="idNumber">
          <el-input v-model="formData.idNumber" placeholder="请输入身份证号" />
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
import { ref, reactive, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import type { FormInstance, FormRules } from 'element-plus';
import { getTenants, createTenant, updateTenant, deleteTenant } from '@/api/tenants';
import type { Tenant } from '@/types';

const loading = ref(false);
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
    { required: true, message: '请输入邮箱', trigger: 'blur' },
    { type: 'email', message: '请输入正确的邮箱', trigger: 'blur' },
  ],
  idNumber: [
    { required: true, message: '请输入身份证号', trigger: 'blur' },
    { pattern: /^[1-9]\d{5}(18|19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\d{3}[\dXx]$/, message: '请输入正确的身份证号', trigger: 'blur' },
  ],
};

const maskIdNumber = (idNumber: string) => {
  if (!idNumber) return '';
  return idNumber.replace(/(\d{6})\d{8}(\d{4})/, '$1********$2');
};

const formatDate = (date: string) => {
  return new Date(date).toLocaleString('zh-CN');
};

const fetchData = async () => {
  loading.value = true;
  try {
    const params = {
      page: pagination.page,
      limit: pagination.limit,
      ...queryForm,
    };
    const response = await getTenants(params);
    tableData.value = response.data;
    pagination.total = response.meta.total;
  } catch (error) {
    ElMessage.error('获取数据失败');
  } finally {
    loading.value = false;
  }
};

const handleQuery = () => {
  pagination.page = 1;
  fetchData();
};

const handleReset = () => {
  queryForm.name = '';
  queryForm.phone = '';
  handleQuery();
};

const handleCreate = () => {
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
    idNumber: row.idNumber,
    emergencyContact: row.emergencyContact || '',
    emergencyPhone: row.emergencyPhone || '',
  });
  dialogVisible.value = true;
};

const handleDelete = async (row: Tenant) => {
  try {
    await ElMessageBox.confirm('确定要删除这个租客吗？', '提示', {
      type: 'warning',
    });
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
      const data: any = { ...formData };

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
});
</script>

<style scoped>
.tenants-page {
  padding: 0;
}
</style>
