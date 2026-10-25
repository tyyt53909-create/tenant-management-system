<template>
  <el-dialog
    v-model="visible"
    title="批量抄表录入工作台"
    width="1000px"
    top="5vh"
    destroy-on-close
    :close-on-click-modal="false"
  >
    <div class="batch-reading-container">
      <!-- 顶部筛选与统计栏 -->
      <div class="filter-summary-bar">
        <el-form :inline="true" size="small">
          <el-form-item label="水电表类型">
            <el-select v-model="filterType" placeholder="全部类型" clearable style="width: 140px">
              <el-option label="全部" value="" />
              <el-option label="电表" value="ELECTRICITY" />
              <el-option label="水表" value="WATER" />
              <el-option label="燃气表" value="GAS" />
            </el-select>
          </el-form-item>
          <el-form-item label="房号/租客搜索">
            <el-input
              v-model="searchKeyword"
              placeholder="搜索房号或租客姓名"
              clearable
              style="width: 180px"
            />
          </el-form-item>
          <el-form-item>
            <el-button type="primary" :loading="loading" @click="fetchSheet">刷新底表</el-button>
          </el-form-item>
        </el-form>

        <div class="summary-cards">
          <div class="stat-pill">
            总表数: <b>{{ filteredList.length }}</b>
          </div>
          <div class="stat-pill highlight">
            已填报: <b>{{ filledCount }}</b>
          </div>
          <div class="stat-pill">
            预计总用量: <b>{{ totalUsage.toFixed(2) }}</b>
          </div>
          <div class="stat-pill cost">
            预计扣费: <b>{{ formatMoney(totalCost) }}</b>
          </div>
        </div>
      </div>

      <!-- 快速录入工作表格 -->
      <el-table
        :data="filteredList"
        v-loading="loading"
        border
        size="small"
        height="480"
        stripe
        class="batch-table"
      >
        <el-table-column prop="roomNumber" label="房号" width="90" fixed>
          <template #default="{ row }">
            <b>{{ row.roomNumber || '公区' }}</b>
          </template>
        </el-table-column>
        <el-table-column prop="meterType" label="类型" width="85">
          <template #default="{ row }">
            <el-tag size="small" :type="meterTypeTag[row.meterType]">
              {{ meterTypeLabel[row.meterType] }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="meterNumber" label="表号" width="130" show-overflow-tooltip />
        <el-table-column label="租客" width="110">
          <template #default="{ row }">
            <span v-if="row.tenantName">{{ row.tenantName }}</span>
            <el-tag v-else size="small" type="info">空置/公区</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="上次读数" width="100" align="right">
          <template #default="{ row }">
            <span>{{ Number(row.lastReading).toFixed(2) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="单价" width="95" align="right">
          <template #default="{ row }">
            {{ formatMoney(row.unitPrice) }}
          </template>
        </el-table-column>
        <el-table-column label="本次读数" min-width="160">
          <template #default="{ row, $index }">
            <div class="reading-input-wrap">
              <el-input-number
                :ref="(el: any) => setInputRef(el, $index)"
                v-model="inputValues[row.meterId]"
                :min="0"
                :precision="2"
                :controls="false"
                placeholder="回车下一行"
                class="reading-num-input"
                :class="{
                  'input-invalid': isRowInvalid(row as BatchSheetItem),
                  'input-surge': isRowSurge(row as BatchSheetItem),
                }"
                @keydown.enter.prevent="focusNextRow($index)"
                @keydown.down.prevent="focusNextRow($index)"
                @keydown.up.prevent="focusPrevRow($index)"
              />
              <span v-if="isRowInvalid(row as BatchSheetItem)" class="warning-tag error">倒退</span>
              <span v-else-if="isRowSurge(row as BatchSheetItem)" class="warning-tag surge">突增</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="本次用量" width="100" align="right">
          <template #default="{ row }">
            <span v-if="hasInput(row.meterId)" :class="{ 'text-danger': isRowInvalid(row as BatchSheetItem) }">
              {{ computeUsage(row as BatchSheetItem).toFixed(2) }}
            </span>
            <span v-else class="text-placeholder">-</span>
          </template>
        </el-table-column>
        <el-table-column label="预估费用" width="100" align="right">
          <template #default="{ row }">
            <span v-if="hasInput(row.meterId) && !isRowInvalid(row as BatchSheetItem)">
              {{ formatMoney(computeCost(row as BatchSheetItem)) }}
            </span>
            <span v-else class="text-placeholder">-</span>
          </template>
        </el-table-column>
        <el-table-column label="预付余额" width="110">
          <template #default="{ row }">
            <template v-if="row.prepayBalance !== null">
              <el-tag
                size="small"
                :type="row.prepayBalance >= computeCost(row as BatchSheetItem) ? 'success' : 'warning'"
              >
                {{ formatMoney(row.prepayBalance) }}
              </el-tag>
            </template>
            <span v-else class="text-placeholder">-</span>
          </template>
        </el-table-column>
      </el-table>

      <!-- 快捷操作与确认 -->
      <div class="dialog-footer">
        <div class="footer-left">
          <el-button size="small" @click="handleClearInputs">清空本次填写</el-button>
          <span class="tip-text">提示：输入读数后按 <b>Enter</b> 或 <b>↓</b> 键可直接切换到下一行</span>
        </div>
        <div class="footer-right">
          <el-button @click="visible = false">取消</el-button>
          <el-button
            type="primary"
            :loading="submitting"
            :disabled="filledCount === 0 || hasInvalidRows"
            @click="handleSubmitBatch"
          >
            提交抄表 ({{ filledCount }} 间)
          </el-button>
        </div>
      </div>
    </div>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { getBatchSheet, submitBatchReadings } from '@/api/meters';
import type { BatchSheetItem, BatchReadingSubmitItem } from '@/api/meters';
import { formatMoney } from '@/utils/money';
import { notifyApiError } from '@/utils/notify';

const props = defineProps<{
  modelValue: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', val: boolean): void;
  (e: 'success'): void;
}>();

const visible = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val),
});

const loading = ref(false);
const submitting = ref(false);
const filterType = ref('');
const searchKeyword = ref('');
const sheetList = ref<BatchSheetItem[]>([]);
const inputValues = reactive<Record<string, number | null>>({});
const inputRefs = ref<any[]>([]);

const meterTypeLabel: Record<string, string> = {
  ELECTRICITY: '电表',
  WATER: '水表',
  GAS: '燃气表',
};

const meterTypeTag: Record<string, any> = {
  ELECTRICITY: 'warning',
  WATER: 'primary',
  GAS: 'danger',
};

function setInputRef(el: any, index: number) {
  if (el) {
    inputRefs.value[index] = el;
  }
}

async function fetchSheet() {
  loading.value = true;
  try {
    const list = await getBatchSheet();
    sheetList.value = list;
  } catch (err: any) {
    notifyApiError(err, '获取抄表底表失败');
  } finally {
    loading.value = false;
  }
}

watch(visible, (val) => {
  if (val) {
    fetchSheet();
  } else {
    handleClearInputs();
  }
});

const filteredList = computed(() => {
  return sheetList.value.filter((item) => {
    if (filterType.value && item.meterType !== filterType.value) {
      return false;
    }
    if (searchKeyword.value) {
      const kw = searchKeyword.value.trim().toLowerCase();
      const matchRoom = (item.roomNumber || '').toLowerCase().includes(kw);
      const matchTenant = (item.tenantName || '').toLowerCase().includes(kw);
      const matchMeter = (item.meterNumber || '').toLowerCase().includes(kw);
      return matchRoom || matchTenant || matchMeter;
    }
    return true;
  });
});

function hasInput(meterId: string): boolean {
  return typeof inputValues[meterId] === 'number' && !isNaN(inputValues[meterId]!);
}

function computeUsage(row: BatchSheetItem): number {
  if (!hasInput(row.meterId)) return 0;
  const current = Number(inputValues[row.meterId]);
  const prev = Number(row.lastReading);
  return Math.round((current - prev) * 100) / 100;
}

function computeCost(row: BatchSheetItem): number {
  const usage = computeUsage(row);
  if (usage <= 0) return 0;
  return Math.round(usage * row.unitPrice);
}

function isRowInvalid(row: BatchSheetItem): boolean {
  if (!hasInput(row.meterId)) return false;
  return Number(inputValues[row.meterId]) < Number(row.lastReading);
}

function isRowSurge(row: BatchSheetItem): boolean {
  if (!hasInput(row.meterId) || isRowInvalid(row)) return false;
  const usage = computeUsage(row);
  return row.lastUsage > 0 && usage > row.lastUsage * 2.5;
}

const filledCount = computed(() => {
  return filteredList.value.filter((row) => hasInput(row.meterId)).length;
});

const hasInvalidRows = computed(() => {
  return filteredList.value.some((row) => isRowInvalid(row));
});

const totalUsage = computed(() => {
  return filteredList.value
    .filter((row) => hasInput(row.meterId) && !isRowInvalid(row))
    .reduce((sum, row) => sum + computeUsage(row), 0);
});

const totalCost = computed(() => {
  return filteredList.value
    .filter((row) => hasInput(row.meterId) && !isRowInvalid(row))
    .reduce((sum, row) => sum + computeCost(row), 0);
});

function focusNextRow(currentIndex: number) {
  const nextIndex = currentIndex + 1;
  if (nextIndex < inputRefs.value.length && inputRefs.value[nextIndex]) {
    inputRefs.value[nextIndex]?.focus?.();
  }
}

function focusPrevRow(currentIndex: number) {
  const prevIndex = currentIndex - 1;
  if (prevIndex >= 0 && inputRefs.value[prevIndex]) {
    inputRefs.value[prevIndex]?.focus?.();
  }
}

function handleClearInputs() {
  for (const key of Object.keys(inputValues)) {
    delete inputValues[key];
  }
}

async function handleSubmitBatch() {
  const toSubmit: BatchReadingSubmitItem[] = [];
  for (const row of filteredList.value) {
    if (hasInput(row.meterId) && !isRowInvalid(row)) {
      toSubmit.push({
        meterId: row.meterId,
        currentReading: Number(inputValues[row.meterId]),
      });
    }
  }

  if (toSubmit.length === 0) {
    ElMessage.warning('请至少填报一条有效的抄表读数');
    return;
  }

  try {
    await ElMessageBox.confirm(
      `确定提交本次填报的 ${toSubmit.length} 间水电表读数？系统将自动核算用量并从预付账户扣费（不足生成补缴账单）。`,
      '批量抄表确认',
      {
        confirmButtonText: '确定提交',
        cancelButtonText: '取消',
        type: 'info',
      }
    );
  } catch {
    return;
  }

  submitting.value = true;
  try {
    const res = await submitBatchReadings(toSubmit);
    if (res.failureCount === 0) {
      ElMessage.success(`批量抄表成功！共登记 ${res.successCount} 条读数并扣费`);
      visible.value = false;
      emit('success');
    } else {
      ElMessageBox.alert(
        `批量抄表完成：成功 ${res.successCount} 间，失败 ${res.failureCount} 间。\n失败详情可在控制台或界面查看。`,
        '处理结果',
        { type: 'warning' }
      );
      // 清空成功项，保留失败项供排查
      for (const item of res.results) {
        if (item.success) {
          delete inputValues[item.meterId];
        }
      }
      fetchSheet();
      emit('success');
    }
  } catch (err: any) {
    notifyApiError(err, '批量提交失败');
  } finally {
    submitting.value = false;
  }
}
</script>

<style scoped>
.batch-reading-container {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.filter-summary-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  background-color: #f8fafc;
  padding: 10px 14px;
  border-radius: 6px;
  border: 1px solid #e2e8f0;
}

.summary-cards {
  display: flex;
  gap: 12px;
  font-size: 13px;
  color: #475569;
}

.stat-pill {
  background: #ffffff;
  padding: 4px 10px;
  border-radius: 4px;
  border: 1px solid #cbd5e1;
}

.stat-pill.highlight {
  border-color: var(--info-text);
  color: #1d4ed8;
}

.stat-pill.cost {
  border-color: var(--success-text);
  color: #047857;
}

.batch-table {
  width: 100%;
}

.reading-input-wrap {
  display: flex;
  align-items: center;
  gap: 6px;
}

.reading-num-input {
  width: 110px;
}

.reading-num-input.input-invalid :deep(.el-input__wrapper) {
  border: 1px solid var(--error-text) !important;
  box-shadow: 0 0 0 1px var(--error-text) inset !important;
}

.reading-num-input.input-surge :deep(.el-input__wrapper) {
  border: 1px solid #f59e0b !important;
}

.warning-tag {
  font-size: 11px;
  padding: 1px 4px;
  border-radius: 3px;
}

.warning-tag.error {
  background-color: #fee2e2;
  color: #b91c1c;
}

.warning-tag.surge {
  background-color: #fef3c7;
  color: #b45309;
}

.text-danger {
  color: var(--error-text);
  font-weight: bold;
}

.text-placeholder {
  color: var(--text-muted);
}

.dialog-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 14px;
  padding-top: 10px;
  border-top: 1px solid #f1f5f9;
}

.footer-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.tip-text {
  font-size: 12px;
  color: #64748b;
}
</style>
