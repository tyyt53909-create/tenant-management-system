<template>
  <div class="maintenance-page">
    <el-card>
      <el-form :inline="true" :model="queryForm">
        <el-form-item label="状态">
          <el-select v-model="queryForm.status" placeholder="请选择状态" clearable>
            <el-option label="已提交" value="SUBMITTED" />
            <el-option label="已分配" value="ASSIGNED" />
            <el-option label="处理中" value="IN_PROGRESS" />
            <el-option label="已解决" value="RESOLVED" />
            <el-option label="已关闭" value="CLOSED" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="handleQuery">查询</el-button>
          <el-button @click="handleReset">重置</el-button>
        </el-form-item>
      </el-form>

      <el-table :data="tableData" v-loading="loading" border stripe>
        <el-table-column prop="title" label="标题" width="200" />
        <el-table-column prop="category" label="类别" width="100">
          <template #default="{ row }">
            {{ categoryMap[row.category] }}
          </template>
        </el-table-column>
        <el-table-column prop="priority" label="优先级" width="100">
          <template #default="{ row }">
            <el-tag :type="priorityTypeMap[row.priority]">
              {{ priorityMap[row.priority] }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="status" label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="statusTypeMap[row.status]">
              {{ statusMap[row.status] }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="description" label="描述" min-width="200" show-overflow-tooltip />
        <el-table-column prop="createdAt" label="创建时间" width="180">
          <template #default="{ row }">
            {{ new Date(row.createdAt).toLocaleString('zh-CN') }}
          </template>
        </el-table-column>
        <el-table-column label="操作" width="180" fixed="right">
          <template #default="{ row }">
            <el-button type="primary" link @click="handleEdit(row)">处理</el-button>
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
          @current-change="handleQuery"
        />
      </div>
    </el-card>

    <el-dialog v-model="dialogVisible" title="处理报修" width="500px">
      <el-form :model="formData" label-width="100px">
        <el-form-item label="状态">
          <el-select v-model="formData.status">
            <el-option label="已分配" value="ASSIGNED" />
            <el-option label="处理中" value="IN_PROGRESS" />
            <el-option label="已解决" value="RESOLVED" />
            <el-option label="已关闭" value="CLOSED" />
          </el-select>
        </el-form-item>
        <el-form-item label="处理人">
          <el-input v-model="formData.assignedTo" placeholder="请输入处理人ID" />
        </el-form-item>
        <el-form-item label="解决方案">
          <el-input v-model="formData.resolution" type="textarea" :rows="4" placeholder="请输入解决方案" />
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
import { getMaintenanceList, updateMaintenance, deleteMaintenance } from '@/api/maintenance';
import type { Maintenance } from '@/types';

const loading = ref(false);
const submitLoading = ref(false);
const dialogVisible = ref(false);
const tableData = ref<Maintenance[]>([]);
const currentEditId = ref('');

const queryForm = reactive({ status: '' });
const pagination = reactive({ page: 1, limit: 20, total: 0 });
const formData = reactive({
  status: '',
  assignedTo: '',
  resolution: '',
});

const categoryMap: Record<string, string> = {
  PLUMBING: '水管',
  ELECTRICAL: '电路',
  APPLIANCE: '家电',
  FURNITURE: '家具',
  DOOR_WINDOW: '门窗',
  OTHER: '其他',
};

const priorityMap: Record<string, string> = {
  LOW: '低',
  NORMAL: '普通',
  URGENT: '紧急',
};

const priorityTypeMap: Record<string, any> = {
  LOW: 'info',
  NORMAL: '',
  URGENT: 'danger',
};

const statusMap: Record<string, string> = {
  SUBMITTED: '已提交',
  ASSIGNED: '已分配',
  IN_PROGRESS: '处理中',
  RESOLVED: '已解决',
  CLOSED: '已关闭',
};

const statusTypeMap: Record<string, any> = {
  SUBMITTED: 'warning',
  ASSIGNED: 'info',
  IN_PROGRESS: '',
  RESOLVED: 'success',
  CLOSED: 'info',
};

const fetchData = async () => {
  loading.value = true;
  try {
    const response = await getMaintenanceList({ page: pagination.page, limit: pagination.limit, ...queryForm });
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
  queryForm.status = '';
  handleQuery();
};

const handleEdit = (row: Maintenance) => {
  currentEditId.value = row.id;
  formData.status = row.status;
  formData.assignedTo = row.assignedTo || '';
  formData.resolution = row.resolution || '';
  dialogVisible.value = true;
};

const handleDelete = async (row: Maintenance) => {
  try {
    await ElMessageBox.confirm('确定要删除吗？', '提示', { type: 'warning' });
    await deleteMaintenance(row.id);
    ElMessage.success('删除成功');
    fetchData();
  } catch (error: any) {
    if (error !== 'cancel') ElMessage.error('删除失败');
  }
};

const handleSubmit = async () => {
  submitLoading.value = true;
  try {
    const data: any = { ...formData };
    await updateMaintenance(currentEditId.value, data);
    ElMessage.success('更新成功');
    dialogVisible.value = false;
    fetchData();
  } catch (error) {
    ElMessage.error('操作失败');
  } finally {
    submitLoading.value = false;
  }
};

onMounted(fetchData);
</script>

<style scoped>
.maintenance-page { padding: 0; }
</style>
