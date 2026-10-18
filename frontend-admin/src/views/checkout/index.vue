<template>
  <div class="checkout-page">
    <ManagementMetrics resource="checkout" />
    <ResourcePanel title="退租记录" :count="pagination.total" :loading="loading" :error="loadError || undefined" @retry="fetchData">
      <template #actions>
        <ExportCurrent resource="checkout" :rows="tableData" />
        <el-button type="primary" @click="handleCreate">＋ 新增退租</el-button>
      </template>

      <div class="resource-tabs">
        <button
          v-for="tab in [
            { value: '', label: '全部记录' },
            { value: 'DRAFT', label: '草稿' },
            { value: 'PENDING', label: '待处理' },
            { value: 'COMPLETED', label: '已完成' },
            { value: 'CANCELLED', label: '已取消' },
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
            <el-option label="草稿" value="DRAFT" />
            <el-option label="待处理" value="PENDING" />
            <el-option label="已完成" value="COMPLETED" />
            <el-option label="已取消" value="CANCELLED" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="handleQuery">查询</el-button>
          <el-button @click="handleReset">重置</el-button>
          <el-button type="primary" @click="handleCreate">新增退租记录</el-button>
          <el-button :loading="exporting" @click="handleExportCsv">导出 CSV</el-button>
        </el-form-item>
      </el-form>

      <el-table
        ref="tableRef"
        :data="tableData"
        v-loading="loading"
        :empty-text="emptyText"
        row-key="id"
        @expand-change="handleExpandChange"
      >
        <el-table-column type="expand" width="48">
          <template #default="{ row }">
            <div class="items-panel">
              <div class="items-panel__inner">
                <div class="items-panel__head">
                  <span>
                    <strong>结算明细</strong>
                    <span v-if="itemsOf(row).length">（共 {{ itemsOf(row).length }} 项）</span>
                  </span>
                  <span v-if="itemsOf(row).length" class="items-panel__summary">
                    退还合计：<span class="amount-refund">¥{{ formatMoney(refundTotalOf(row)) }}</span>
                    &nbsp;|&nbsp;
                    扣除合计：<span class="amount-deduction">¥{{ formatMoney(deductionTotalOf(row)) }}</span>
                  </span>
                </div>
                <el-table
                  v-if="itemsOf(row).length"
                  :data="itemsOf(row)"
                  size="small"
                  border
                  v-loading="detailLoading[row.id]"
                >
                  <el-table-column label="类别" width="140">
                    <template #default="{ row: item }">
                      <el-tag :type="itemTypeMeta(item.itemType).tagType" size="small">
                        {{ itemTypeMeta(item.itemType).label }}
                      </el-tag>
                    </template>
                  </el-table-column>
                  <el-table-column label="金额(元)" width="120">
                    <template #default="{ row: item }">
                      <span :class="itemTypeMeta(item.itemType).isDeduction ? 'amount-deduction' : 'amount-refund'">
                        {{ itemTypeMeta(item.itemType).isDeduction ? '-' : '+' }}¥{{ formatMoney(item.amount) }}
                      </span>
                    </template>
                  </el-table-column>
                  <el-table-column prop="description" label="说明" min-width="220" show-overflow-tooltip />
                </el-table>
                <el-empty
                  v-else
                  :image-size="40"
                  description="暂无结算明细（未录入押金扣除或退还项）"
                  v-loading="detailLoading[row.id]"
                />
              </div>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="关联合同" width="140" show-overflow-tooltip>
          <template #default="{ row }">{{ row.contract?.contractNumber || '—' }}</template>
        </el-table-column>
        <el-table-column label="退租房源" width="120" show-overflow-tooltip>
          <template #default="{ row }">{{ row.room?.roomNumber ? `${row.room.roomNumber} 室` : '—' }}</template>
        </el-table-column>
        <el-table-column prop="checkoutDate" label="退租日期" width="120">
          <template #default="{ row }">
            {{ row.checkoutDate ? row.checkoutDate.split('T')[0] : '-' }}
          </template>
        </el-table-column>
        <el-table-column prop="totalRefund" label="退款金额" width="120">
          <template #default="{ row }">
            ¥{{ formatMoney(row.totalRefund) }}
          </template>
        </el-table-column>
        <el-table-column label="明细项数" width="110">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="toggleDetail(row)">
              {{ itemsOf(row).length ? `${itemsOf(row).length} 项明细` : '查看明细' }}
            </el-button>
          </template>
        </el-table-column>
        <el-table-column prop="processedBy" label="处理人" width="140" show-overflow-tooltip />
        <el-table-column prop="status" label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="statusTypeMap[row.status]">
              {{ statusMap[row.status] }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="notes" label="备注" min-width="150" show-overflow-tooltip />
        <el-table-column label="操作" width="190" fixed="right">
          <template #default="{ row }">
            <el-button type="info" link @click="handleOpenVoucher(row)">结算单</el-button>
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

    <!-- 弹窗表单组件 -->
    <CheckoutFormDialog
      v-model="dialogVisible"
      :edit-record="currentEditRecord"
      @success="handleDialogSuccess"
    />

    <!-- 结算单凭单弹窗 -->
    <SettlementVoucherModal
      v-model="voucherVisible"
      :checkout-id="voucherCheckoutId"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import type { TableInstance } from 'element-plus';
import ResourcePanel from '@/components/common/ResourcePanel.vue';
import ManagementMetrics from '@/components/common/ManagementMetrics.vue';
import ExportCurrent from '@/components/common/ExportCurrent.vue';
import SettlementVoucherModal from '@/components/common/SettlementVoucherModal.vue';
import CheckoutFormDialog from './components/CheckoutFormDialog.vue';
import { deleteCheckout, getCheckoutById, getCheckoutRecords } from '@/api/checkout';
import { downloadCsv } from '@/utils/export';
import { usePagedTable } from '@/composables';
import type { CheckoutItem, CheckoutItemType, CheckoutRecord } from '@/types';

interface ItemTypeMeta {
  label: string;
  tagType: 'primary' | 'success' | 'warning' | 'danger' | 'info';
  isDeduction: boolean;
}

const ITEM_TYPE_META: Record<CheckoutItemType, ItemTypeMeta> = {
  RENT_REFUND: { label: '租金退还', tagType: 'success', isDeduction: false },
  DEPOSIT_REFUND: { label: '押金退还', tagType: 'primary', isDeduction: false },
  DEPOSIT_DEDUCTION: { label: '押金扣除', tagType: 'danger', isDeduction: true },
  UTILITY_REFUND: { label: '水电余额退还', tagType: 'success', isDeduction: false },
  OTHER_FEE: { label: '其他费用', tagType: 'warning', isDeduction: true },
  OTHER_REFUND: { label: '其他退款', tagType: 'info', isDeduction: false },
};

const statusMap: Record<string, string> = {
  DRAFT: '草稿',
  PENDING: '待处理',
  COMPLETED: '已完成',
  CANCELLED: '已取消',
};

const statusTypeMap: Record<string, any> = {
  DRAFT: 'info',
  PENDING: 'warning',
  COMPLETED: 'success',
  CANCELLED: 'danger',
};

const tableRef = ref<TableInstance>();
const exporting = ref(false);
const voucherVisible = ref(false);
const voucherCheckoutId = ref('');
const dialogVisible = ref(false);
const currentEditRecord = ref<CheckoutRecord | null>(null);

const detailMap = ref<Record<string, CheckoutRecord>>({});
const detailLoading = ref<Record<string, boolean>>({});

const {
  loading,
  loadError,
  tableData,
  pagination,
  queryForm,
  fetchData,
  handleQuery,
  handleReset,
} = usePagedTable<CheckoutRecord, { status: string }>({
  fetchApi: (params) =>
    getCheckoutRecords({
      page: params.page,
      limit: params.limit,
      ...(params.status ? { status: params.status } : {}),
    }),
  defaultQuery: { status: '' },
});

const emptyText = computed(() =>
  queryForm.status ? '没有符合条件的退租记录，试试调整状态筛选' : '暂无退租记录',
);

const formatMoney = (cents?: number | null) =>
  ((typeof cents === 'number' && !Number.isNaN(cents) ? cents : 0) / 100).toFixed(2);

const itemTypeMeta = (itemType: CheckoutItemType): ItemTypeMeta =>
  ITEM_TYPE_META[itemType] ?? { label: String(itemType), tagType: 'info', isDeduction: false };

const isDeduction = (itemType: CheckoutItemType | '') =>
  !!itemType && ITEM_TYPE_META[itemType as CheckoutItemType]?.isDeduction === true;

const itemsOf = (row: CheckoutRecord): CheckoutItem[] => detailMap.value[row.id]?.items ?? [];

const sumByKind = (items: CheckoutItem[], deduction: boolean) =>
  items.reduce(
    (acc, item) => (isDeduction(item.itemType) === deduction ? acc + (Number(item.amount) || 0) : acc),
    0,
  );

const refundTotalOf = (row: CheckoutRecord) => sumByKind(itemsOf(row), false);
const deductionTotalOf = (row: CheckoutRecord) => sumByKind(itemsOf(row), true);

const fetchDetail = async (id: string): Promise<CheckoutRecord | null> => {
  detailLoading.value[id] = true;
  try {
    const detail = await getCheckoutById(id);
    if (detail) detailMap.value[id] = detail;
    return detail ?? null;
  } catch {
    return null;
  } finally {
    detailLoading.value[id] = false;
  }
};

const loadDetail = async (row: CheckoutRecord) => {
  if (detailMap.value[row.id] || detailLoading.value[row.id]) return;
  await fetchDetail(row.id);
};

const handleExpandChange = (row: CheckoutRecord, expanded: unknown) => {
  const isExpanded = Array.isArray(expanded)
    ? expanded.some((item: CheckoutRecord) => item.id === row.id)
    : expanded === true;
  if (isExpanded) void loadDetail(row);
};

const toggleDetail = (row: CheckoutRecord) => {
  tableRef.value?.toggleRowExpansion(row, true);
};

const handleOpenVoucher = (row: CheckoutRecord) => {
  voucherCheckoutId.value = row.id;
  voucherVisible.value = true;
};

const handleExportCsv = async () => {
  exporting.value = true;
  try {
    await downloadCsv(
      '/checkout-records/export',
      queryForm.status ? { status: queryForm.status } : {},
      `退租结算记录_${new Date().toISOString().split('T')[0]}.csv`,
    );
    ElMessage.success('导出成功');
  } catch {
    ElMessage.error('导出失败');
  } finally {
    exporting.value = false;
  }
};

const handleCreate = () => {
  currentEditRecord.value = null;
  dialogVisible.value = true;
};

const handleEdit = (row: CheckoutRecord) => {
  currentEditRecord.value = row;
  dialogVisible.value = true;
};

const handleDialogSuccess = (createdRecord?: CheckoutRecord) => {
  if (createdRecord?.id) {
    detailMap.value[createdRecord.id] = createdRecord;
  } else if (currentEditRecord.value?.id) {
    delete detailMap.value[currentEditRecord.value.id];
  }
  fetchData();
};

const handleDelete = async (row: CheckoutRecord) => {
  try {
    await ElMessageBox.confirm('确定要删除吗？', '提示', { type: 'warning' });
    await deleteCheckout(row.id);
    delete detailMap.value[row.id];
    ElMessage.success('删除成功');
    fetchData();
  } catch (error: any) {
    if (error !== 'cancel') ElMessage.error('删除失败');
  }
};

onMounted(fetchData);
</script>

<style scoped>
.checkout-page {
  padding: 0;
}

.items-panel {
  padding: 8px 12px 4px 12px;
  background-color: #fafafa;
}

.items-panel__inner {
  position: sticky;
  left: 0;
  max-width: 820px;
}

.items-panel__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
  color: #606266;
}

.amount-deduction {
  color: var(--error-text);
  font-weight: 600;
}

.amount-refund {
  color: var(--success-text);
  font-weight: 600;
}
</style>
