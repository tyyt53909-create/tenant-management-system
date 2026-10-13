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
        <el-table-column label="操作" width="240" fixed="right">
          <template #default="{ row }">
            <el-button type="success" link :disabled="!row.isActive" @click="handleReading(row)">读数</el-button>
            <el-button type="primary" link @click="handleViewReadings(row)">记录</el-button>
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

    <!-- 讀數登記 -->
    <el-dialog v-model="readingDialogVisible" title="登记读数" width="520px">
      <el-descriptions :column="2" border size="small" style="margin-bottom: 16px">
        <el-descriptions-item label="表号">{{ currentMeter?.meterNumber }}</el-descriptions-item>
        <el-descriptions-item label="单价">
          ¥{{ ((currentMeter?.unitPrice || 0) / 100).toFixed(2) }}/{{ unitMap[currentMeter?.meterType || ''] || '' }}
        </el-descriptions-item>
      </el-descriptions>

      <el-alert
        v-if="readingResultText"
        :title="readingResultText"
        :type="readingResultType"
        show-icon
        :closable="false"
        style="margin-bottom: 16px"
      />

      <el-form ref="readingFormRef" :model="readingForm" :rules="readingRules" label-width="100px">
        <el-form-item label="当前读数" prop="currentReading">
          <el-input-number v-model="readingForm.currentReading" :min="0" :precision="2" :step="10" />
        </el-form-item>
        <el-form-item label="读数时间">
          <el-date-picker
            v-model="readingForm.readingTime"
            type="datetime"
            placeholder="缺省为当前时间"
            value-format="YYYY-MM-DDTHH:mm:ss"
          />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="readingForm.notes" placeholder="选填" />
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="readingDialogVisible = false">关闭</el-button>
        <el-button type="primary" :loading="readingSubmitLoading" @click="handleReadingSubmit">确定</el-button>
      </template>
    </el-dialog>

    <!-- 讀數記錄 -->
    <el-dialog v-model="readingsDialogVisible" title="读数记录" width="680px">
      <el-table :data="readings" v-loading="readingsLoading" size="small" border>
        <el-table-column label="读数时间" width="160">
          <template #default="{ row }">{{ formatDateTime(row.readingTime) }}</template>
        </el-table-column>
        <el-table-column label="上次读数" width="100">
          <template #default="{ row }">{{ Number(row.previousReading).toFixed(2) }}</template>
        </el-table-column>
        <el-table-column label="本次读数" width="100">
          <template #default="{ row }">{{ Number(row.currentReading).toFixed(2) }}</template>
        </el-table-column>
        <el-table-column label="用量" width="90">
          <template #default="{ row }">{{ Number(row.usage).toFixed(2) }}</template>
        </el-table-column>
        <el-table-column prop="notes" label="备注" show-overflow-tooltip />
      </el-table>
      <div style="margin-top: 16px; text-align: right">
        <el-pagination
          v-model:current-page="readingsPagination.page"
          v-model:page-size="readingsPagination.limit"
          :total="readingsPagination.total"
          layout="total, prev, pager, next"
          @current-change="loadReadings"
        />
      </div>
      <template #footer>
        <el-button @click="readingsDialogVisible = false">关闭</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import type { FormInstance } from 'element-plus';
import {
  getMeters,
  createMeter,
  updateMeter,
  deleteMeter,
  createMeterReading,
  getMeterReadings,
} from '@/api/meters';
import type { MeterReading } from '@/api/meters';
import type { Meter } from '@/types';

const loading = ref(false);
const submitLoading = ref(false);
const dialogVisible = ref(false);
const dialogTitle = ref('新增水电表');
const formRef = ref<FormInstance>();
const tableData = ref<Meter[]>([]);
const currentEditId = ref('');

// ── 讀數登記（T137）──
const readingDialogVisible = ref(false);
const readingSubmitLoading = ref(false);
const readingFormRef = ref<FormInstance>();
const currentMeter = ref<Meter | null>(null);
const readingResultText = ref('');
const readingResultType = ref<'success' | 'warning'>('success');
const readingForm = reactive({ currentReading: 0, readingTime: '', notes: '' });
const readingRules = {
  currentReading: [{ required: true, message: '请输入当前读数', trigger: 'blur' }],
};

// ── 讀數記錄 ──
const readingsDialogVisible = ref(false);
const readingsLoading = ref(false);
const readings = ref<MeterReading[]>([]);
const readingsPagination = reactive({ page: 1, limit: 20, total: 0 });

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
    await ElMessageBox.confirm(
      `确定删除水电表「${row.meterNumber || row.id}」吗？其历史读数将一并删除，不可恢复。`,
      '删除水电表',
      { type: 'warning', confirmButtonText: '确定删除', cancelButtonText: '取消' },
    );
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

const formatDateTime = (value: string) => (value ? value.replace('T', ' ').slice(0, 19) : '-');

// ── 讀數登記 ──

const handleReading = (row: Meter) => {
  currentMeter.value = row;
  readingForm.currentReading = 0;
  readingForm.readingTime = '';
  readingForm.notes = '';
  readingResultText.value = '';
  readingDialogVisible.value = true;
};

const handleReadingSubmit = async () => {
  const meter = currentMeter.value;
  if (!readingFormRef.value || !meter) return;
  await readingFormRef.value.validate(async (valid) => {
    if (!valid) return;
    readingSubmitLoading.value = true;
    try {
      const result = await createMeterReading(meter.id, {
        currentReading: readingForm.currentReading,
        readingTime: readingForm.readingTime || undefined,
        notes: readingForm.notes || undefined,
      });
      const usage = Number(result.reading.usage).toFixed(2);
      const deduction = result.deduction;
      if (!deduction.applied) {
        readingResultText.value = `用量 ${usage}；未扣费：${deduction.reason}`;
        readingResultType.value = 'warning';
      } else if (deduction.shortfall > 0) {
        readingResultText.value = `用量 ${usage}；已扣费 ¥${(deduction.deducted / 100).toFixed(2)}；余额不足，已生成补缴账单 ¥${(deduction.shortfall / 100).toFixed(2)}`;
        readingResultType.value = 'warning';
      } else {
        readingResultText.value = `用量 ${usage}；已扣费 ¥${(deduction.deducted / 100).toFixed(2)}`;
        readingResultType.value = 'success';
      }
      ElMessage.success('读数登记成功');
    } catch {
      // 请求拦截器已弹出错误提示
    } finally {
      readingSubmitLoading.value = false;
    }
  });
};

// ── 讀數記錄 ──

const handleViewReadings = (row: Meter) => {
  currentMeter.value = row;
  readingsPagination.page = 1;
  readingsDialogVisible.value = true;
  loadReadings();
};

const loadReadings = async () => {
  const meter = currentMeter.value;
  if (!meter) return;
  readingsLoading.value = true;
  try {
    const response = await getMeterReadings(meter.id, {
      page: readingsPagination.page,
      limit: readingsPagination.limit,
    });
    readings.value = response.data;
    readingsPagination.total = response.meta.total;
  } catch {
    // 请求拦截器已弹出错误提示
  } finally {
    readingsLoading.value = false;
  }
};

onMounted(fetchData);
</script>

<style scoped>
.meters-page { padding: 0; }
</style>
