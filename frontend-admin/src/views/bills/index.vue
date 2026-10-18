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
          :class="{ active: queryForm.status === tab.value }"
          @click="queryForm.status = tab.value; handleQuery()"
        >
          {{ tab.label }}
        </button>
      </div>

      <el-form :inline="true" :model="queryForm">
        <el-form-item label="状态">
          <el-select v-model="queryForm.status" placeholder="请选择状态" clearable>
            <el-option label="待支付" value="PENDING" />
            <el-option label="部分支付" value="PARTIAL" />
            <el-option label="已支付" value="PAID" />
            <el-option label="已逾期" value="OVERDUE" />
            <el-option label="已取消" value="CANCELLED" />
          </el-select>
        </el-form-item>
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
          <el-button type="primary" @click="handleCreate">新增账单</el-button>
          <el-button :loading="exporting" @click="handleExportCsv">导出 CSV</el-button>
        </el-form-item>
      </el-form>

      <el-table
        :data="tableData"
        v-loading="loading"
        @row-dblclick="openDetail"
        :empty-text="emptyText"
        :default-sort="{ prop: 'dueDate', order: 'descending' }"
      >
        <el-table-column prop="billNumber" label="账单 / 房源" min-width="250" sortable>
          <template #default="{ row }">
            <button class="record-cell" @click="openDetail(row)">
              <span class="record-glyph"><el-icon><Wallet /></el-icon></span>
              <span>
                <strong>{{ row.contract?.room?.roomNumber || billTypeMap[row.billType] }} · {{ row.period }}</strong>
                <small>{{ row.contract?.tenant?.name || '未关联租客' }} · {{ row.billNumber }}</small>
              </span>
            </button>
          </template>
        </el-table-column>
        <el-table-column prop="billType" label="类型" width="80">
          <template #default="{ row }">
            <el-tag>{{ billTypeMap[row.billType] }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="period" label="账期" width="95" sortable />
        <el-table-column prop="amount" sort-by="amount" label="应付金额" width="115" sortable>
          <template #default="{ row }">
            {{ formatMoney(row.amount) }}
          </template>
        </el-table-column>
        <el-table-column prop="paidAmount" sort-by="paidAmount" label="已付金额" width="115" sortable>
          <template #default="{ row }">
            {{ formatMoney(row.paidAmount) }}
          </template>
        </el-table-column>
        <el-table-column prop="dueDate" sort-by="dueDateOnly" label="到期日期" width="115" sortable>
          <template #default="{ row }">
            {{ formatDateOnly(row.dueDate) }}
          </template>
        </el-table-column>
        <el-table-column prop="status" label="状态" width="105">
          <template #default="{ row }">
            <el-tag :type="statusTypeMap[row.status]">
              {{ statusMap[row.status] }}
            </el-tag>
          </template>
        </el-table-column>
        <!-- 滞纳金（T151）：未确认仅展示系统建议值，确认后才入账 -->
        <el-table-column label="滞纳金" width="140">
          <template #header>
            <el-tooltip placement="top" content="系统建议值不会自动入账；管理者确认后才计入应收">
              <span class="late-fee-header">滞纳金<el-icon><QuestionFilled /></el-icon></span>
            </el-tooltip>
          </template>
          <template #default="{ row }">
            <span v-if="lateFeeOf(row)" class="late-fee-cell">
              <span class="late-fee-amount">
                <em v-if="!isLateFeeConfirmed(lateFeeOf(row))" class="late-fee-suggest">建议</em>
                {{ formatYuan(lateFeeDisplayAmount(lateFeeOf(row))) }}
              </span>
              <el-tooltip placement="top" :content="lateFeeStateOf(lateFeeOf(row)).tip">
                <el-tag size="small" effect="plain" :type="lateFeeStateOf(lateFeeOf(row)).type">
                  {{ lateFeeStateOf(lateFeeOf(row)).text }}
                </el-tag>
              </el-tooltip>
            </span>
            <el-tooltip
              v-else-if="isOverdueByDate(row)"
              placement="top"
              content="逾期账单：可点击「滞纳金」按合同规则生成系统建议值"
            >
              <el-tag size="small" type="warning" effect="plain">未计算</el-tag>
            </el-tooltip>
            <span v-else class="late-fee-cell late-fee-empty">—</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="320" fixed="right">
          <template #default="{ row }">
            <el-button type="primary" link @click="openDetail(row)">详情</el-button>
            <el-button type="success" link :disabled="!canReceive(row)" @click="handlePayment(row)">收款</el-button>
            <el-tooltip placement="top" :disabled="canOpenLateFee(row)" :content="lateFeeDisabledReason(row)">
              <span class="op-wrap">
                <el-button type="warning" link :disabled="!canOpenLateFee(row)" @click="handleLateFee(row)">
                  滞纳金
                </el-button>
              </span>
            </el-tooltip>
            <el-button type="info" link :disabled="row.paidAmount <= 0" @click="handleOpenReceipt(row)">收据</el-button>
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
import { formatMoney, formatDateOnly } from '@/utils/table';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Wallet, QuestionFilled, Ticket } from '@element-plus/icons-vue';
import ResourcePanel from '@/components/common/ResourcePanel.vue';
import ManagementMetrics from '@/components/common/ManagementMetrics.vue';
import ExportCurrent from '@/components/common/ExportCurrent.vue';
import ResourceDrawer from '@/components/common/ResourceDrawer.vue';
import ReceiptModal from '@/components/common/ReceiptModal.vue';
import VoucherRecognitionModal from '@/components/common/VoucherRecognitionModal.vue';
import BillFormDialog from './components/BillFormDialog.vue';
import BillPaymentDialog from './components/BillPaymentDialog.vue';
import BillLateFeeDialog from './components/BillLateFeeDialog.vue';
import { downloadCsv } from '@/utils/export';
import { getBills, deleteBill } from '@/api/bills';
import type { Bill, LateFee } from '@/types';
import { usePagedTable } from '@/composables';

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

const billTypeMap: Record<string, string> = {
  RENT: '租金',
  UTILITY: '水电费',
  OTHER: '其他',
};

const statusMap: Record<string, string> = {
  PENDING: '待支付',
  PARTIAL: '部分支付',
  PAID: '已支付',
  OVERDUE: '已逾期',
  CANCELLED: '已取消',
};

const statusTypeMap: Record<string, any> = {
  PENDING: 'warning',
  PARTIAL: 'info',
  PAID: 'success',
  OVERDUE: 'danger',
  CANCELLED: 'info',
};

const formatYuan = (cents?: number | null) => '¥' + ((cents ?? 0) / 100).toFixed(2);

const isLateFeeConfirmed = (fee: LateFee | null): boolean =>
  !!fee && fee.confirmedAmount !== null && fee.confirmedAmount !== undefined;

const outstandingOf = (fee: LateFee | null) => {
  if (!fee || fee.confirmedAmount === null || fee.confirmedAmount === undefined) return 0;
  return Math.max(0, fee.confirmedAmount - (fee.settledAmount ?? 0));
};

const lateFeeOf = (bill: Bill): LateFee | null => lateFeeMap.value[bill.id]?.[0] ?? null;

const lateFeeDisplayAmount = (fee: LateFee | null) =>
  fee ? (fee.confirmedAmount ?? fee.suggestedAmount) : 0;

const overdueDaysOf = (bill: Bill) => {
  const due = new Date(bill.dueDate);
  const dueDay = Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate());
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.max(0, Math.floor((today - dueDay) / 86400000));
};

const isOverdueByDate = (bill: Bill) => overdueDaysOf(bill) > 0;

const lateFeeDisabledReason = (bill: Bill | null): string => {
  if (!bill) return '';
  if (bill.status === 'PAID') return '账单已缴清，不可新增滞纳金';
  if (bill.status === 'CANCELLED') return '账单已取消，不可新增滞纳金';
  if (!isOverdueByDate(bill)) return '账单尚未逾期，无需计算滞纳金';
  if (bill.amount - bill.paidAmount <= 0) return '账单已缴清，无需计算滞纳金';
  return '';
};

const canManageLateFee = (bill: Bill | null) => !!bill && lateFeeDisabledReason(bill) === '';
const canOpenLateFee = (bill: Bill) => !!lateFeeOf(bill) || canManageLateFee(bill);
const canReceive = (bill: Bill | null) =>
  !!bill && ['PENDING', 'PARTIAL', 'OVERDUE'].includes(bill.status);

const lateFeeStateOf = (fee: LateFee | null): { text: string; type: 'info' | 'warning' | 'success'; tip: string } => {
  if (!fee) return { text: '—', type: 'info', tip: '暂无滞纳金' };
  if (!isLateFeeConfirmed(fee)) {
    return { text: '未确认', type: 'info', tip: '系统建议值，尚未入账；管理者确认后才计入应收' };
  }
  if (fee.confirmedAmount === 0) {
    return { text: '已减免', type: 'info', tip: '管理者已确认减免，滞纳金不入账' };
  }
  if (outstandingOf(fee) <= 0) {
    return { text: '已核销', type: 'success', tip: '已确认 ' + formatYuan(fee.confirmedAmount) + '，收款时已全额核销' };
  }
  return {
    text: '已确认',
    type: 'warning',
    tip: '已确认入账 ' + formatYuan(fee.confirmedAmount) + '，未核销 ' + formatYuan(outstandingOf(fee)),
  };
};

const summaryToLateFee = (bill: Bill): LateFee | null => {
  const s = bill.lateFeeSummary;
  if (!s || s.status === 'none') return null;
  const confirmed = s.status !== 'suggested';
  return {
    id: 'summary-' + bill.id,
    billId: bill.id,
    suggestedAmount: s.suggestedAmount,
    confirmedAmount: confirmed ? s.amount : null,
    overdueDays: s.overdueDays,
    calculation: null,
    notes: null,
    confirmedAt: null,
    confirmedBy: null,
    settledAmount: s.settledAmount,
    settledAt: null,
    settledBy: null,
    createdAt: '',
  } as unknown as LateFee;
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
} = usePagedTable<Bill, { status: string; billType: string }>({
  fetchApi: async (params) => {
    const p: Record<string, any> = { page: params.page, limit: params.limit };
    if (params.status) p.status = params.status;
    if (params.billType) p.billType = params.billType;
    const res = await getBills(p);
    return {
      data: (res.data as Bill[]).map((b) => ({
        ...b,
        dueDateOnly: b.dueDate ? String(b.dueDate).split('T')[0] : '',
      })),
      meta: res.meta,
    };
  },
  defaultQuery: { status: '', billType: '' },
  onSuccess: (data) => {
    applySummaries(data);
  },
});

const emptyText = computed(() =>
  queryForm.status || queryForm.billType
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
    await downloadCsv('/bills/export', queryForm, `bills-export-${dateStr}.csv`);
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
    if (error !== 'cancel') ElMessage.error('删除失败');
  }
};

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
.op-wrap {
  display: inline-block;
  margin: 0 12px;
}
.late-fee-header {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  cursor: help;
}
.late-fee-cell {
  display: inline-flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
}
.late-fee-amount { font-size: 13px; }
.late-fee-suggest {
  margin-right: 2px;
  font-style: normal;
  color: var(--text-muted);
}
.late-fee-empty { color: var(--text-muted); }
</style>
