<template>
  <div class="meters-page">
    <el-card>
      <el-form :inline="true" :model="queryForm">
        <el-form-item label="类型">
          <el-select v-model="queryForm.meterType" placeholder="请选择类型" clearable>
            <el-option label="电表" value="ELECTRICITY" />
            <el-option label="水表" value="WATER" />
            <el-option label="燃气表" value="GAS" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="handleQuery">查询</el-button>
          <el-button @click="handleReset">重置</el-button>
          <el-button type="primary" @click="handleCreate">新增水电表</el-button>
        </el-form-item>
      </el-form>

      <el-table :data="tableData" v-loading="loading" border stripe>
        <el-table-column prop="meterNumber" label="表号" width="150" />
        <el-table-column prop="meterType" label="类型" width="100">
          <template #default="{ row }">
            <el-tag :type="meterTypeColorMap[row.meterType]">
              {{ meterTypeMap[row.meterType] }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="roomId" label="房间ID" width="180" show-overflow-tooltip />
        <el-table-column prop="unitPrice" label="单价" width="120">
          <template #default="{ row }">
            ¥{{ (row.unitPrice / 100).toFixed(2) }}/{{ unitMap[row.meterType] }}
          </template>
        </el-table-column>
        <el-table-column prop="priceEffectiveDate" label="价格生效日期" width="140">
          <template #default="{ row }">
            {{ row.priceEffectiveDate.split('T')[0] }}
          </template>
        </el-table-column>
        <el-table-column prop="isActive" label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="row.isActive ? 'success' : 'info'">
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
          @current-change="handleQuery"
        />
      </div>
    </el-card>

    <el-dialog v-model="dialogVisible" :title="dialogTitle" width="500px">
      <el-form ref="formRef" :model="formData" :rules="rules" label-width="120px">
        <el-form-item label="楼栋ID" prop="buildingId">
          <el-input v-model="formData.buildingId" placeholder="building-001" />
        </el-form-item>
        <el-form-item label="房间ID" prop="roomId">
          <el-input v-model="formData.roomId" placeholder="可选，公共区域可不填" />
        </el-form-item>
        <el-form-item label="表类型" prop="meterType">
          <el-select v-model="formData.meterType">
            <el-option label="电表" value="ELECTRICITY" />
            <el-option label="水表" value="WATER" />
            <el-option label="燃气表" value="GAS" />
          </el-select>
        </el-form-item>
        <el-form-item label="表号" prop="meterNumber">
          <el-input v-model="formData.meterNumber" placeholder="请输入表号" />
        </el-form-item>
        <el-form-item label="单价(元)" prop="unitPrice">
          <el-input-number v-model="formData.unitPrice" :min="0" :precision="2" />
        </el-form-item>
        <el-form-item label="价格生效日期" prop="priceEffectiveDate">
          <el-date-picker v-model="formData.priceEffectiveDate" type="date" placeholder="选择日期" value-format="YYYY-MM-DD" />
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
import { getMeters, createMeter, updateMeter, deleteMeter } from '@/api/meters';
import type { Meter } from '@/types';

const loading = ref(false);
const submitLoading = ref(false);
const dialogVisible = ref(false);
const dialogTitle = ref('新增水电表');
const formRef = ref<FormInstance>();
const tableData = ref<Meter[]>([]);
const currentEditId = ref('');

const queryForm = reactive({ meterType: '' });
const pagination = reactive({ page: 1, limit: 20, total: 0 });
const formData = reactive({
  buildingId: 'building-001',
  roomId: '',
  meterType: 'ELECTRICITY',
  meterNumber: '',
  unitPrice: 0,
  priceEffectiveDate: '',
  isActive: true,
});

const rules = {
  buildingId: [{ required: true, message: '请输入楼栋ID', trigger: 'blur' }],
  meterType: [{ required: true, message: '请选择表类型', trigger: 'change' }],
  meterNumber: [{ required: true, message: '请输入表号', trigger: 'blur' }],
  unitPrice: [{ required: true, message: '请输入单价', trigger: 'blur' }],
  priceEffectiveDate: [{ required: true, message: '请选择生效日期', trigger: 'change' }],
};

const meterTypeMap: Record<string, string> = {
  ELECTRICITY: '电表',
  WATER: '水表',
  GAS: '燃气表',
};

const meterTypeColorMap: Record<string, any> = {
  ELECTRICITY: 'warning',
  WATER: 'primary',
  GAS: 'success',
};

const unitMap: Record<string, string> = {
  ELECTRICITY: '度',
  WATER: '吨',
  GAS: '立方米',
};

const fetchData = async () => {
  loading.value = true;
  try {
    const response = await getMeters({ page: pagination.page, limit: pagination.limit, ...queryForm });
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
  queryForm.meterType = '';
  handleQuery();
};

const handleCreate = () => {
  dialogTitle.value = '新增水电表';
  currentEditId.value = '';
  dialogVisible.value = true;
};

const handleEdit = (row: Meter) => {
  dialogTitle.value = '编辑水电表';
  currentEditId.value = row.id;
  Object.assign(formData, {
    buildingId: row.buildingId,
    roomId: row.roomId || '',
    meterType: row.meterType,
    meterNumber: row.meterNumber,
    unitPrice: row.unitPrice / 100,
    priceEffectiveDate: row.priceEffectiveDate.split('T')[0],
    isActive: row.isActive,
  });
  dialogVisible.value = true;
};

const handleDelete = async (row: Meter) => {
  try {
    await ElMessageBox.confirm('确定要删除吗？', '提示', { type: 'warning' });
    await deleteMeter(row.id);
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
        unitPrice: Math.round(formData.unitPrice * 100),
      };
      if (currentEditId.value) {
        await updateMeter(currentEditId.value, data);
        ElMessage.success('更新成功');
      } else {
        await createMeter(data);
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
.meters-page { padding: 0; }
</style>
