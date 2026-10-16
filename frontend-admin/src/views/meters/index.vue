<template>
  <div class="meters-page">
    <ManagementMetrics resource="meters" />
    <ResourcePanel title="水电表档案" :count="pagination.total" :loading="loading" :error="loadError || undefined" @retry="fetchData">
      <template #actions>
        <ExportCurrent resource="meters" :rows="tableData" />
        <el-button type="primary" @click="handleCreate">＋ 新增水电表</el-button>
      </template>

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
          <el-button type="success" @click="batchDialogVisible = true">批量抄表</el-button>
          <el-button type="warning" plain @click="simulatorDialogVisible = true">⚡ 虚拟表模拟器</el-button>
          <el-button :loading="exporting" @click="handleExportCsv">导出台账</el-button>
        </el-form-item>
      </el-form>

      <el-table :data="tableData" v-loading="loading" :empty-text="emptyText">
        <el-table-column prop="meterNumber" label="表号" width="150" />
        <el-table-column prop="meterType" label="类型" width="100">
          <template #default="{ row }">
            <el-tag :type="meterTypeColorMap[row.meterType]">
              {{ meterTypeMap[row.meterType] }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="房源" min-width="160">
          <template #default="{ row }">{{ row.room?.roomNumber || '公共区域' }}</template>
        </el-table-column>
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
        <el-table-column label="操作" width="280" fixed="right">
          <template #default="{ row }">
            <el-button type="success" link :disabled="!row.isActive" @click="handleReading(row)">读数</el-button>
            <el-button type="warning" link :disabled="!row.isActive" @click="handleOpenSettle(row)">结算</el-button>
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
    </ResourcePanel>

    <!-- 新增 / 编辑水电表组件 -->
    <MeterFormDialog
      v-model="dialogVisible"
      :meter="currentEditMeter"
      @success="fetchData"
    />

    <!-- 读数登记组件 -->
    <MeterReadingDialog
      v-model="readingDialogVisible"
      :meter="currentMeter"
      @success="fetchData"
    />

    <!-- 周期结算对话框 -->
    <el-dialog v-model="settleDialogVisible" title="水电周期结算" width="560px">
      <div v-loading="settleDataLoading">
        <el-alert
          title="将累计结算上次结算或初始底数至今的未计费度数，从租客预付账户扣费或生成差额补缴账单。"
          type="info"
          :closable="false"
          style="margin-bottom: 16px"
        />
        <el-descriptions :column="2" border size="small" style="margin-bottom: 16px">
          <el-descriptions-item label="表号">{{ currentMeter?.meterNumber }}</el-descriptions-item>
          <el-descriptions-item label="类型">{{ meterTypeMap[currentMeter?.meterType || ''] }}</el-descriptions-item>
          <el-descriptions-item label="房源">{{ unsettledInfo?.roomNumber || '公共区域' }}</el-descriptions-item>
          <el-descriptions-item label="签约租客">{{ unsettledInfo?.tenantName || '无生效合同' }}</el-descriptions-item>
          <el-descriptions-item label="单价">¥{{ ((currentMeter?.unitPrice || 0) / 100).toFixed(2) }}/{{ unitMap[currentMeter?.meterType || ''] || '' }}</el-descriptions-item>
          <el-descriptions-item label="预付余额">
            <span v-if="unsettledInfo?.prepayBalance !== null" :style="{ color: unsettledInfo.prepayBalance < (unsettledInfo.estimatedAmount || 0) ? '#F56C6C' : '#67C23A', fontWeight: 'bold' }">
              ¥{{ (unsettledInfo.prepayBalance / 100).toFixed(2) }}
            </span>
            <span v-else style="color: #909399">无预付账户</span>
          </el-descriptions-item>
          <el-descriptions-item label="起步结算底数">{{ unsettledInfo?.lastSettledReading ?? '-' }}</el-descriptions-item>
          <el-descriptions-item label="当前最新读数">{{ unsettledInfo?.currentReading ?? '-' }}</el-descriptions-item>
          <el-descriptions-item label="待结算用量">
            <span style="font-size: 15px; font-weight: bold; color: #409EFF">
              {{ unsettledInfo?.unsettledUsage ?? 0 }} {{ unitMap[currentMeter?.meterType || ''] || '' }}
            </span>
          </el-descriptions-item>
          <el-descriptions-item label="预估结算金额">
            <span style="font-size: 15px; font-weight: bold; color: #E6A23C">
              ¥{{ ((unsettledInfo?.estimatedAmount || 0) / 100).toFixed(2) }}
            </span>
          </el-descriptions-item>
        </el-descriptions>

        <el-form label-width="80px">
          <el-form-item label="结算备注">
            <el-input v-model="settleNotes" placeholder="例如：2026年10月结账" />
          </el-form-item>
        </el-form>
      </div>

      <template #footer>
        <el-button @click="settleDialogVisible = false">取消</el-button>
        <el-button
          type="primary"
          :loading="settleSubmitLoading"
          :disabled="!unsettledInfo || unsettledInfo.unsettledUsage <= 0"
          @click="handleConfirmSettle"
        >
          立即结算
        </el-button>
      </template>
    </el-dialog>

    <!-- 读数记录 -->
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

    <!-- 批量抄表工作台组件 -->
    <BatchReadingDialog v-model="batchDialogVisible" @success="fetchData" />

    <!-- 虚拟水电表模拟器组件（方案 A） -->
    <MeterSimulatorDialog
      v-model:visible="simulatorDialogVisible"
      :meters="tableData"
      @success="fetchData"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import ResourcePanel from '@/components/common/ResourcePanel.vue';
import ManagementMetrics from '@/components/common/ManagementMetrics.vue';
import ExportCurrent from '@/components/common/ExportCurrent.vue';
import BatchReadingDialog from './BatchReadingDialog.vue';
import MeterSimulatorDialog from './MeterSimulatorDialog.vue';
import MeterFormDialog from './components/MeterFormDialog.vue';
import MeterReadingDialog from './components/MeterReadingDialog.vue';
import { downloadCsv } from '@/utils/export';
import {
  getMeters,
  deleteMeter,
  getMeterReadings,
  getUnsettledUsage,
  settleMeter,
  type MeterReading,
} from '@/api/meters';
import type { Meter } from '@/types';
import { usePagedTable } from '@/composables';

const exporting = ref(false);
const dialogVisible = ref(false);
const currentEditMeter = ref<Meter | null>(null);

const readingDialogVisible = ref(false);
const currentMeter = ref<Meter | null>(null);

const batchDialogVisible = ref(false);
const simulatorDialogVisible = ref(false);

const readingsDialogVisible = ref(false);
const readingsLoading = ref(false);
const readings = ref<MeterReading[]>([]);
const readingsPagination = reactive({
  page: 1,
  limit: 10,
  total: 0,
});

const settleDialogVisible = ref(false);
const settleDataLoading = ref(false);
const settleSubmitLoading = ref(false);
const settleNotes = ref('');
const unsettledInfo = ref<any>(null);

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

const {
  loading,
  loadError,
  tableData,
  pagination,
  queryForm,
  fetchData,
  handleQuery,
  handleReset,
} = usePagedTable<Meter, { meterType: string }>({
  fetchApi: (params) =>
    getMeters({
      page: params.page,
      limit: params.limit,
      meterType: params.meterType || undefined,
    }),
  defaultQuery: { meterType: '' },
});

const emptyText = computed(() =>
  queryForm.meterType
    ? '没有符合条件的水电表，试试调整类型筛选'
    : '暂无水电表，点击右上角「新增水电表」开始录入',
);

const handleExportCsv = async () => {
  exporting.value = true;
  try {
    await downloadCsv(
      '/meters/export',
      queryForm.meterType ? { meterType: queryForm.meterType } : {},
      `meters-export-${new Date().toISOString().slice(0, 10)}.csv`,
    );
  } finally {
    exporting.value = false;
  }
};

const handleCreate = () => {
  currentEditMeter.value = null;
  dialogVisible.value = true;
};

const handleEdit = (row: Meter) => {
  currentEditMeter.value = row;
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

const formatDateTime = (value: string) => (value ? value.replace('T', ' ').slice(0, 19) : '-');

const handleReading = (row: Meter) => {
  currentMeter.value = row;
  readingDialogVisible.value = true;
};

const handleOpenSettle = async (row: Meter) => {
  currentMeter.value = row;
  settleNotes.value = '';
  unsettledInfo.value = null;
  settleDialogVisible.value = true;
  settleDataLoading.value = true;
  try {
    const res = await getUnsettledUsage(row.id);
    unsettledInfo.value = res;
  } catch (err: any) {
    ElMessage.error(err?.response?.data?.message || err?.message || '获取未结算用量失败');
  } finally {
    settleDataLoading.value = false;
  }
};

const handleConfirmSettle = async () => {
  const meter = currentMeter.value;
  if (!meter) return;
  settleSubmitLoading.value = true;
  try {
    const res = await settleMeter(meter.id, { notes: settleNotes.value || undefined });
    if (!res.settled) {
      ElMessage.info(res.reason || '无待结算用量');
    } else {
      ElMessage.success(`周期结算成功！结算用量 ${res.usage}，金额 ¥${(res.amount / 100).toFixed(2)}`);
    }
    settleDialogVisible.value = false;
    fetchData();
  } catch (err: any) {
    ElMessage.error(err?.response?.data?.message || err?.message || '结算失败');
  } finally {
    settleSubmitLoading.value = false;
  }
};

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
    // Handled by request interceptor
  } finally {
    readingsLoading.value = false;
  }
};

onMounted(fetchData);
</script>

<style scoped>
.meters-page { padding: 0; }
</style>
