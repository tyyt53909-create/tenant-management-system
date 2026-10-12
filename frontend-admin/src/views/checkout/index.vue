<template>
  <div class="checkout-page">
    <el-card>
      <el-form :inline="true" :model="queryForm">
        <el-form-item label="状态">
          <el-select v-model="queryForm.status" placeholder="请选择状态" clearable>
            <el-option label="草稿" value="DRAFT" />
            <el-option label="处理中" value="PROCESSING" />
            <el-option label="已完成" value="COMPLETED" />
            <el-option label="已取消" value="CANCELLED" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="handleQuery">查询</el-button>
          <el-button @click="handleReset">重置</el-button>
          <el-button type="primary" @click="handleCreate">新增退租记录</el-button>
        </el-form-item>
      </el-form>

      <el-table :data="tableData" v-loading="loading" border stripe>
        <el-table-column prop="contractId" label="合同ID" width="180" show-overflow-tooltip />
        <el-table-column prop="roomId" label="房间ID" width="180" show-overflow-tooltip />
        <el-table-column prop="checkoutDate" label="退租日期" width="120">
          <template #default="{ row }">
            {{ row.checkoutDate.split('T')[0] }}
          </template>
        </el-table-column>
        <el-table-column prop="totalRefund" label="退款金额" width="120">
          <template #default="{ row }">
            ¥{{ (row.totalRefund / 100).toFixed(2) }}
          </template>
        </el-table-column>
        <el-table-column prop="status" label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="statusTypeMap[row.status]">
              {{ statusMap[row.status] }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="processedBy" label="处理人ID" width="180" show-overflow-tooltip />
        <el-table-column prop="notes" label="备注" min-width="200" show-overflow-tooltip />
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
          @current-change="handleQuery"
        />
      </div>
    </el-card>

    <el-dialog v-model="dialogVisible" :title="dialogTitle" width="600px">
      <el-form ref="formRef" :model="formData" :rules="rules" label-width="100px">
        <el-form-item label="合同ID" prop="contractId">
          <el-input v-model="formData.contractId" placeholder="请输入合同ID" />
        </el-form-item>
        <el-form-item label="房间ID" prop="roomId">
          <el-input v-model="formData.roomId" placeholder="请输入房间ID" />
        </el-form-item>
        <el-form-item label="退租日期" prop="checkoutDate">
          <el-date-picker v-model="formData.checkoutDate" type="date" placeholder="选择日期" value-format="YYYY-MM-DD" />
        </el-form-item>
        <el-form-item label="退款金额(元)" prop="totalRefund">
          <el-input-number v-model="formData.totalRefund" :min="0" :precision="2" />
        </el-form-item>
        <el-form-item label="处理人ID" prop="processedBy">
          <el-input v-model="formData.processedBy" placeholder="请输入处理人ID" />
        </el-form-item>
        <el-form-item label="状态" prop="status">
          <el-select v-model="formData.status">
            <el-option label="草稿" value="DRAFT" />
            <el-option label="处理中" value="PROCESSING" />
            <el-option label="已完成" value="COMPLETED" />
            <el-option label="已取消" value="CANCELLED" />
          </el-select>
        </el-form-item>
        <el-form-item label="备注" prop="notes">
          <el-input v-model="formData.notes" type="textarea" :rows="3" placeholder="请输入备注" />
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
import { getCheckoutRecords, createCheckout, updateCheckout, deleteCheckout } from '@/api/checkout';
import type { CheckoutRecord } from '@/types';

const loading = ref(false);
const submitLoading = ref(false);
const dialogVisible = ref(false);
const dialogTitle = ref('新增退租记录');
const formRef = ref<FormInstance>();
const tableData = ref<CheckoutRecord[]>([]);
const currentEditId = ref('');

const queryForm = reactive({ status: '' });
const pagination = reactive({ page: 1, limit: 20, total: 0 });
const formData = reactive({
  contractId: '',
  roomId: '',
  checkoutDate: '',
  totalRefund: 0,
  processedBy: '',
  status: 'DRAFT',
  notes: '',
});

const rules = {
  contractId: [{ required: true, message: '请输入合同ID', trigger: 'blur' }],
  roomId: [{ required: true, message: '请输入房间ID', trigger: 'blur' }],
  checkoutDate: [{ required: true, message: '请选择退租日期', trigger: 'change' }],
  totalRefund: [{ required: true, message: '请输入退款金额', trigger: 'blur' }],
  processedBy: [{ required: true, message: '请输入处理人ID', trigger: 'blur' }],
};

const statusMap: Record<string, string> = {
  DRAFT: '草稿',
  PROCESSING: '处理中',
  COMPLETED: '已完成',
  CANCELLED: '已取消',
};

const statusTypeMap: Record<string, any> = {
  DRAFT: 'info',
  PROCESSING: 'warning',
  COMPLETED: 'success',
  CANCELLED: 'danger',
};

const fetchData = async () => {
  loading.value = true;
  try {
    const response = await getCheckoutRecords({ page: pagination.page, limit: pagination.limit, ...queryForm });
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

const handleCreate = () => {
  dialogTitle.value = '新增退租记录';
  currentEditId.value = '';
  dialogVisible.value = true;
};

const handleEdit = (row: CheckoutRecord) => {
  dialogTitle.value = '编辑退租记录';
  currentEditId.value = row.id;
  Object.assign(formData, {
    contractId: row.contractId,
    roomId: row.roomId,
    checkoutDate: row.checkoutDate.split('T')[0],
    totalRefund: row.totalRefund / 100,
    processedBy: row.processedBy,
    status: row.status,
    notes: row.notes || '',
  });
  dialogVisible.value = true;
};

const handleDelete = async (row: CheckoutRecord) => {
  try {
    await ElMessageBox.confirm('确定要删除吗？', '提示', { type: 'warning' });
    await deleteCheckout(row.id);
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
      const data: any = {
        ...formData,
        totalRefund: Math.round(formData.totalRefund * 100),
      };
      if (currentEditId.value) {
        await updateCheckout(currentEditId.value, data);
        ElMessage.success('更新成功');
      } else {
        await createCheckout(data);
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
.checkout-page { padding: 0; }
</style>
