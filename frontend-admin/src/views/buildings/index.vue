<template>
  <div class="buildings-page">
    <el-card>
      <el-form :inline="true">
        <el-form-item>
          <el-button type="primary" @click="handleCreate">新增楼栋</el-button>
        </el-form-item>
      </el-form>

      <el-table :data="tableData" v-loading="loading" border stripe>
        <el-table-column prop="name" label="楼栋名称" width="200" />
        <el-table-column prop="address" label="地址" min-width="300" />
        <el-table-column prop="totalFloors" label="总楼层" width="100" />
        <el-table-column prop="isActive" label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="row.isActive ? 'success' : 'danger'">
              {{ row.isActive ? '启用' : '停用' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="createdAt" label="创建时间" width="180">
          <template #default="{ row }">
            {{ new Date(row.createdAt).toLocaleString('zh-CN') }}
          </template>
        </el-table-column>
        <el-table-column label="操作" width="180" fixed="right">
          <template #default="{ row }">
            <el-button type="primary" link @click="handleEdit(row)">编辑</el-button>
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
    </el-card>

    <el-dialog v-model="dialogVisible" :title="dialogTitle" width="500px">
      <el-form ref="formRef" :model="formData" :rules="rules" label-width="100px">
        <el-form-item label="楼栋名称" prop="name">
          <el-input v-model="formData.name" placeholder="请输入楼栋名称" />
        </el-form-item>
        <el-form-item label="地址" prop="address">
          <el-input v-model="formData.address" placeholder="请输入地址" />
        </el-form-item>
        <el-form-item label="总楼层" prop="totalFloors">
          <el-input-number v-model="formData.totalFloors" :min="1" />
        </el-form-item>
        <el-form-item label="状态" prop="isActive">
          <el-switch v-model="formData.isActive" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitLoading" @click="handleSubmit">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import type { FormInstance } from 'element-plus';
import { getBuildings, createBuilding, updateBuilding, deleteBuilding } from '@/api/buildings';
import type { Building } from '@/types';

const loading = ref(false);
const submitLoading = ref(false);
const dialogVisible = ref(false);
const dialogTitle = ref('新增楼栋');
const formRef = ref<FormInstance>();
const tableData = ref<Building[]>([]);
const currentEditId = ref('');

const pagination = reactive({ page: 1, limit: 20, total: 0 });
const formData = reactive({ name: '', address: '', totalFloors: 1, isActive: true });
const rules = {
  name: [{ required: true, message: '请输入楼栋名称', trigger: 'blur' }],
  address: [{ required: true, message: '请输入地址', trigger: 'blur' }],
  totalFloors: [{ required: true, message: '请输入总楼层', trigger: 'blur' }],
};

const fetchData = async () => {
  loading.value = true;
  try {
    const response = await getBuildings({ page: pagination.page, limit: pagination.limit });
    tableData.value = response.data;
    pagination.total = response.meta.total;
  } catch (error) {
    ElMessage.error('获取数据失败');
  } finally {
    loading.value = false;
  }
};

const handleCreate = () => {
  dialogTitle.value = '新增楼栋';
  currentEditId.value = '';
  dialogVisible.value = true;
};

const handleEdit = (row: Building) => {
  dialogTitle.value = '编辑楼栋';
  currentEditId.value = row.id;
  Object.assign(formData, row);
  dialogVisible.value = true;
};

const handleDelete = async (row: Building) => {
  try {
    await ElMessageBox.confirm(
      `确定删除楼栋「${row.name || row.id}」吗？删除后不可恢复。\n若该楼栋下仍有房源，删除会被后端拒绝。`,
      '删除楼栋',
      { type: 'warning', confirmButtonText: '确定删除', cancelButtonText: '取消' },
    );
    await deleteBuilding(row.id);
    ElMessage.success('删除成功');
    fetchData();
  } catch (error: any) {
    if (error !== 'cancel') ElMessage.error('删除失败');
  }
};

const handleSubmit = async () => {
  if (!formRef.value) return;
  await formRef.value.validate(async (valid) => {
    if (!valid) return;
    submitLoading.value = true;
    try {
      if (currentEditId.value) {
        await updateBuilding(currentEditId.value, formData);
        ElMessage.success('更新成功');
      } else {
        await createBuilding(formData);
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

onMounted(fetchData);
</script>

<style scoped>
.buildings-page { padding: 0; }
</style>
