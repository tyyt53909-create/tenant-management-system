<template>
  <div class="bills-page">
    <ManagementMetrics resource="bills" />
    <ResourcePanel title="账单与收款" :count="pagination.total" :loading="loading" :error="loadError || undefined" @retry="fetchData">
      <template #actions>
        <ExportCurrent resource="bills" :rows="tableData" />
        <el-button type="success" plain @click="voucherModalVisible = true">
          <el-icon><Ticket /></el-icon> 单据识别入账
        </el-button>
        <el-button type="primary" @click="handleCreate">＋ 新增账单</el-button>
      </template>

      <div class="resource-tabs">
        <button
          v-for="tab in [
            { value: '', label: '全部账单' },
            { value: 'PENDING', label: '待缴付' },
            { value: 'PARTIAL', label: '部分缴纳' },
            { value: 'OVERDUE', label: '逾期' },
            { value: 'PAID', label: '已缴清' },
          ]"
          :key="tab.value"
          :class="{ active: tab.value === 'OVERDUE' ? queryForm.overdue === 'true' : queryForm.status === tab.value }"
          @click="selectTab(tab.value)"
        >
          {{ tab.label }}
        </button>
      </div>

      <el-form :inline="true" :model="queryForm">
        <el-form-item label="类型">
          <el-select v-model="queryForm.billType" placeholder="请选择类型" clearable>
            <el-option label="租金" value="RENT" />
            <el-option label="水电费" value="UTILITY" />
            <el-option label="其他" value="OTHER" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="handleQuery">查询</el-button>
          <el-button @click="handleReset">重置</el-button>
          <el-button :loading="exporting" @click="handleExportCsv">导出全部</el-button>
        </el-form-item>
      </el-form>

      <el-table
        :data="tableData"
        v-loading="loading"
        @row-dblclick="openDetail"
        :empty-text="emptyText"
        :default-sort="{ prop: 'dueDate', order: 'descending' }"
      >
        <el-table-column prop="billNumber" label="账单 / 房源" min-width="235" sortable>
          <template #default="{ row }">
            <button class="record-cell bill-identity" @click="openDetail(row as Bill)">
              <span class="record-glyph"><el-icon><Wallet /></el-icon></span>
              <span class="bill-identity-text">
                <strong :title="`${row.contract?.room?.roomNumber || billTypeMap[row.billType]} · ${row.contract?.tenant?.name || '未关联租客'}`">
                  {{ row.contract?.room?.roomNumber || billTypeMap[row.billType] }} · {{ row.contract?.tenant?.name || '未关联租客' }}
                </strong>
                <span class="bill-identity-meta">
                  <span class="bill-number" :title="row.billNumber">{{ row.billNumber }}</span>
                  <el-tag size="small" effect="plain">{{ billTypeMap[row.billType] }}</el-tag>
                </span>
              </span>
            </button>
          </template>
        </el-table-column>

        <el-table-column prop="dueDate" label="账期 / 到期" width="118" sortable>
          <template #default="{ row }">
            <div class="bill-period">
              <strong>{{ row.period }}</strong>
              <small :class="{ 'is-overdue': showOverdue(row as Bill) }">
                <template v-if="showOverdue(row as Bill)">{{ formatMonthDay(row.dueDate) }} · 逾期 {{ overdueDaysOf(row as Bill) }} 天</template>
                <template v-else-if="overdueDaysOf(row as Bill) === null && ['PENDING', 'PARTIAL'].includes(row.status)">到期 {{ formatMonthDay(row.dueDate) }} · 逾期待确认</template>
                <template v-else>到期 {{ formatMonthDay(row.dueDate) }}</template>
              </small>
            </div>
          </template>
        </el-table-column>

        <el-table-column prop="amount" sort-by="amount" label="金额" width="150" sortable align="right">
          <template #default="{ row }">
            <div class="bill-amount">
              <strong>{{ formatMoney(row.amount) }}</strong>
              <small :class="{ 'is-clear': unpaidOf(row as Bill) <= 0 }" :title="paymentTitle(row as Bill)">
                {{ paymentSummary(row as Bill) }}
              </small>
            </div>
          </template>
        </el-table-column>

        <el-table-column label="状态 / 滞纳金" width="120">
          <template #default="{ row }">
            <div class="bill-status">
              <el-tag v-if="showOverdue(row as Bill)" type="danger" size="small">逾期 {{ row.currentOverdueDays }} 天</el-tag>
              <el-tag :type="statusTypeMap[row.status]" size="small">{{ statusMap[row.status] }}</el-tag>
              <button
                v-if="showLateFee(row as Bill)"
                type="button"
                class="late-fee-link"
                :class="lateFeeClassOf(row as Bill)"
                :title="lateFeeTitleOf(row as Bill)"
                @click.stop="handleLateFee(row as Bill)"
              >
                {{ lateFeeTextOf(row as Bill) }}
              </button>
            </div>
          </template>
        </el-table-column>

        <el-table-column label="操作" width="192" fixed="right">
          <template #default="{ row }">
            <div class="bill-actions">
              <el-button class="row-action row-action--primary" :disabled="!canReceive(row as Bill)" @click="handlePayment(row as Bill)">收款</el-button>
              <el-button class="row-action" @click="openDetail(row as Bill)">详情</el-button>
              <el-dropdown trigger="click" @command="handleMoreCommand($event, row as Bill)">
                <el-button class="row-action row-action--more">更多<el-icon :size="12"><ArrowDown /></el-icon></el-button>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item command="lateFee" :disabled="!canOpenLateFee(row as Bill)">滞纳金</el-dropdown-item>
                    <el-dropdown-item command="receipt" :disabled="row.paidAmount <= 0">收据</el-dropdown-item>
                    <el-dropdown-item command="edit">编辑</el-dropdown-item>
                    <el-dropdown-item command="delete" divided style="color: var(--error-text)">删除</el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
            </div>
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

    <ResourceDrawer v-model="detailVisible" resource="bills" :id="detailId" @edit="handleEdit($event as any)" />

    <!-- 账单表单对话框 -->
    <BillFormDialog v-model="dialogVisible" :bill="editBill" @success="fetchData" />

    <!-- 收款登记对话框 -->
    <BillPaymentDialog v-model="paymentDialogVisible" :bill="currentBill" @success="handlePaymentSuccess" />

    <!-- 滞纳金对话框 -->
    <BillLateFeeDialog v-model="lateFeeDialogVisible" :bill="lateFeeBill" @success="handleLateFeeSuccess" />

    <!-- 电子收款收据模态框 -->
    <ReceiptModal v-model="receiptVisible" :bill-id="receiptBillId" />

    <!-- 单据识别入账模态框 -->
    <VoucherRecognitionModal v-model="voucherModalVisible" @settled="onVoucherSettled" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { formatMoney } from '@/utils/table';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Wallet, Ticket, ArrowDown } from '@element-plus/icons-vue';
import ResourcePanel from '@/components/common/ResourcePanel.vue';
import ManagementMetrics from '@/components/common/ManagementMetrics.vue';
import ExportCurrent from '@/components/common/ExportCurrent.vue';
import ResourceDrawer from '@/components/common/ResourceDrawer.vue';
import ReceiptModal from '@/components/common/ReceiptModal.vue';
import VoucherRecognitionModal from '@/components/common/VoucherRecognitionModal.vue';
import BillFormDialog from './components/BillFormDialog.vue';
import BillPaymentDialog from './components/BillPaymentDialog.vue';
import BillLateFeeDialog from './components/BillLateFeeDialog.vue';
import { downloadCsvFromServer } from '@/utils/csv';
import { getBills, deleteBill } from '@/api/bills';
import type { Bill, LateFee } from '@/types';
import { usePagedTable } from '@/composables';
import { notifyApiError } from '@/utils/notify';
import {
  BILL_STATUS_LABEL as statusMap,
  BILL_STATUS_TAG as statusTypeMap,
  BILL_TYPE_LABEL as billTypeMap,
  canReceive,
  formatMonthDay,
  lateFeeDisabledReason,
  isLateFeeConfirmed,
  lateFeeDisplayAmount,
  lateFeeStateOf,
  overdueDaysOf,
  paymentSummary,
  paymentTitle,
  showOverdue,
  summaryToLateFee,
  unpaidOf,
} from '@/utils/billRow';

const detailVisible = ref(false);
const detailId = ref('');
function openDetail(row: Bill) {
  detailId.value = row.id;
  detailVisible.value = true;
}

const receiptVisible = ref(false);
const receiptBillId = ref('');
const exporting = ref(false);

const dialogVisible = ref(false);
const editBill = ref<Bill | null>(null);

const paymentDialogVisible = ref(false);
const currentBill = ref<Bill | null>(null);

const lateFeeDialogVisible = ref(false);
const lateFeeBill = ref<Bill | null>(null);
const lateFeeMap = ref<Record<string, LateFee[]>>({});

const lateFeeOf = (bill: Bill): LateFee | null => lateFeeMap.value[bill.id]?.[0] ?? null;
const canManageLateFee = (bill: Bill | null) => lateFeeDisabledReason(bill) === '';
const canOpenLateFee = (bill: Bill) => !!lateFeeOf(bill) || canManageLateFee(bill);

const isOverdueByDate = (bill: Bill) => (overdueDaysOf(bill) ?? 0) > 0;
const showLateFee = (bill: Bill) =>
  !!lateFeeOf(bill) || (isOverdueByDate(bill) && canManageLateFee(bill));

const lateFeeClassOf = (bill: Bill) => {
  const fee = lateFeeOf(bill);
  if (!fee) return 'is-pending';
  if (!isLateFeeConfirmed(fee)) return 'is-pending';
  return `is-${lateFeeStateOf(fee).type}`;
};

const lateFeeTextOf = (bill: Bill) => {
  const fee = lateFeeOf(bill);
  if (!fee) return '未计算';
  const amount = lateFeeDisplayAmount(fee);
  if (!isLateFeeConfirmed(fee)) return amount > 0 ? `建议 ${formatMoney(amount)}` : '未计算';
  const state = lateFeeStateOf(fee);
  if (state.text === '已减免') return '已减免';
  return `${state.text} ${formatMoney(amount)}`;
};

const lateFeeTitleOf = (bill: Bill) => {
  const fee = lateFeeOf(bill);
  return fee ? lateFeeStateOf(fee).tip : '逾期账单：点击计算滞纳金';
};

const applySummaries = (bills: Bill[]) => {
  const next: Record<string, LateFee[]> = { ...lateFeeMap.value };
  bills.forEach((bill) => {
    if (next[bill.id] && next[bill.id].length && !String(next[bill.id][0].id).startsWith('summary-')) {
      return;
    }
    const adapted = summaryToLateFee(bill);
    if (adapted) next[bill.id] = [adapted];
    else delete next[bill.id];
  });
  lateFeeMap.value = next;
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
} = usePagedTable<Bill, { status: string; billType: string; overdue: string }>({
  fetchApi: async (params) => {
    const p: Record<string, any> = { page: params.page, limit: params.limit };
    if (params.status) p.status = params.status;
    if (params.billType) p.billType = params.billType;
    if (params.overdue === 'true') p.overdue = true;
    const res = await getBills(p);
    return {
      data: (res.data as Bill[]).map((b) => ({
        ...b,
        dueDateOnly: b.dueDate ? String(b.dueDate).split('T')[0] : '',
      })),
      meta: res.meta,
    };
  },
  defaultQuery: { status: '', billType: '', overdue: '' },
  onSuccess: (data) => {
    applySummaries(data);
    if (lateFeeDialogVisible.value && lateFeeBill.value) {
      lateFeeBill.value = data.find((bill) => bill.id === lateFeeBill.value?.id)
        ?? { ...lateFeeBill.value, currentOverdueDays: undefined };
    }
  },
});

const selectTab = (value: string) => {
  if (value === 'OVERDUE') {
    queryForm.status = '';
    queryForm.overdue = 'true';
  } else {
    queryForm.status = value;
    queryForm.overdue = '';
  }
  handleQuery();
};

const emptyText = computed(() =>
  queryForm.status || queryForm.billType || queryForm.overdue
    ? '没有符合条件的账单，试试调整状态或类型'
    : '暂无账单，点击右上角「新增账单」开始录入'
);

function handleOpenReceipt(row: Bill) {
  receiptBillId.value = row.id;
  receiptVisible.value = true;
}

async function handleExportCsv() {
  exporting.value = true;
  try {
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    await downloadCsvFromServer('/bills/export', queryForm, `bills-export-${dateStr}.csv`);
  } finally {
    exporting.value = false;
  }
}

function handleCreate() {
  editBill.value = null;
  dialogVisible.value = true;
}

function handleEdit(row: Bill) {
  editBill.value = row;
  dialogVisible.value = true;
}

function handlePayment(row: Bill) {
  currentBill.value = row;
  paymentDialogVisible.value = true;
}

function handlePaymentSuccess() {
  fetchData();
}

function handleLateFee(row: Bill) {
  lateFeeBill.value = row;
  lateFeeDialogVisible.value = true;
}

function handleLateFeeSuccess() {
  fetchData();
}

const handleDelete = async (row: Bill) => {
  try {
    await ElMessageBox.confirm(
      `确定删除账单「${row.billNumber || row.id}」吗？删除后不可恢复。`,
      '删除账单',
      { type: 'warning', confirmButtonText: '确定删除', cancelButtonText: '取消' },
    );
    await deleteBill(row.id);
    ElMessage.success('删除成功');
    fetchData();
  } catch (error: any) {
    if (error !== 'cancel') notifyApiError(error, '删除失败');
  }
};

function handleMoreCommand(command: string, row: Bill) {
  if (command === 'lateFee') handleLateFee(row);
  else if (command === 'receipt') handleOpenReceipt(row);
  else if (command === 'edit') handleEdit(row);
  else if (command === 'delete') void handleDelete(row);
}

const voucherModalVisible = ref(false);
function onVoucherSettled() {
  void fetchData();
}
function handleBillSettledEvent() {
  void fetchData();
}

onMounted(() => {
  void fetchData();
  window.addEventListener('bill-settled', handleBillSettledEvent);
});
onUnmounted(() => {
  window.removeEventListener('bill-settled', handleBillSettledEvent);
});
</script>

<style scoped>
.bills-page { padding: 0; }

.bill-identity {
  width: 100%;
  gap: 10px;
}
.bill-identity-text {
  display: block;
  min-width: 0;
}
.bill-identity strong {
  max-width: none;
  font-size: 12px;
  line-height: 1.4;
}
.bill-identity-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  margin-top: 4px;
}
.bill-number {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-muted);
  font-size: var(--font-micro);
}
.bill-identity-meta :deep(.el-tag) {
  flex-shrink: 0;
  height: 18px;
  padding: 0 5px;
  font-size: var(--font-micro);
}

.bill-period strong,
.bill-amount strong {
  display: block;
  color: var(--text-primary);
  font-size: 12px;
  font-weight: 650;
  line-height: 1.4;
}
.bill-period small,
.bill-amount small {
  display: block;
  margin-top: 4px;
  overflow: hidden;
  color: var(--text-muted);
  font-size: var(--font-micro);
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bill-period small.is-overdue {
  color: var(--error-text);
  font-weight: 600;
}
.bill-amount {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.bill-amount small.is-clear {
  color: var(--success-text);
  font-weight: 600;
}

.bill-status {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
}
.bill-status :deep(.el-tag) {
  height: 18px;
  padding: 0 5px;
  font-size: var(--font-micro);
}
.late-fee-link {
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--warning-text);
  font-size: var(--font-micro);
  font-weight: 600;
  line-height: 1.3;
  text-align: left;
  white-space: nowrap;
  cursor: pointer;
}
.late-fee-link:hover { text-decoration: underline; }
.late-fee-link:focus-visible,
.row-action:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
}
.late-fee-link.is-pending { color: var(--warning-text); }
.late-fee-link.is-info { color: var(--text-muted); }
.late-fee-link.is-success { color: var(--success-text); }
.late-fee-link.is-warning { color: var(--warning-text); }

.bill-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
}
.bill-actions :deep(.el-button + .el-button) { margin-left: 0; }
.bill-actions :deep(.el-button.row-action) {
  height: 28px;
  min-height: 28px;
}
.row-action {
  height: 28px;
  padding: 0 9px;
  border: 1px solid #a49c8c;
  border-radius: 7px;
  background: #fffefa;
  color: var(--text-primary);
  font-size: var(--font-small);
  font-weight: 600;
  line-height: 1;
}
.row-action:hover {
  border-color: #8f8878;
  background: #f1eee8;
  color: var(--text-primary);
}
.row-action--primary {
  border-color: var(--primary);
  background: var(--primary);
  color: #fffefa;
}
.row-action--primary:hover {
  border-color: var(--primary-dark);
  background: var(--primary-dark);
  color: #fffefa;
}
.row-action--more {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.row-action.is-disabled,
.row-action:disabled { opacity: .55; }
</style>
