<template>
  <div class="bills-page">
    <el-card>
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
        </el-form-item>
      </el-form>

      <el-table :data="tableData" v-loading="loading" border stripe>
        <el-table-column prop="billNumber" label="账单编号" width="170" />
        <el-table-column prop="billType" label="类型" width="80">
          <template #default="{ row }">
            <el-tag>{{ billTypeMap[row.billType] }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="period" label="账期" width="90" />
        <el-table-column prop="amount" label="应付金额" width="105">
          <template #default="{ row }">
            ¥{{ (row.amount / 100).toFixed(2) }}
          </template>
        </el-table-column>
        <el-table-column prop="paidAmount" label="已付金额" width="105">
          <template #default="{ row }">
            ¥{{ (row.paidAmount / 100).toFixed(2) }}
          </template>
        </el-table-column>
        <el-table-column prop="dueDate" label="到期日期" width="110">
          <template #default="{ row }">
            {{ row.dueDate.split('T')[0] }}
          </template>
        </el-table-column>
        <el-table-column prop="status" label="状态" width="90">
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
            <span v-if="lateFeeLoadingMap[row.id]" class="late-fee-cell">
              <el-icon class="is-loading"><Loading /></el-icon>
            </span>
            <span v-else-if="lateFeeOf(row)" class="late-fee-cell">
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
        <el-table-column label="操作" width="240" fixed="right">
          <template #default="{ row }">
            <el-button type="success" link :disabled="!canReceive(row)" @click="handlePayment(row)">收款</el-button>
            <el-tooltip placement="top" :disabled="canOpenLateFee(row)" :content="lateFeeDisabledReason(row)">
              <span class="op-wrap">
                <el-button type="warning" link :disabled="!canOpenLateFee(row)" @click="handleLateFee(row)">
                  滞纳金
                </el-button>
              </span>
            </el-tooltip>
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
      <el-form ref="formRef" :model="formData" :rules="rules" label-width="100px">
        <el-form-item label="合同ID" prop="contractId">
          <el-input v-model="formData.contractId" placeholder="请输入合同ID" />
        </el-form-item>
        <el-form-item label="账单类型" prop="billType">
          <el-select v-model="formData.billType">
            <el-option label="租金" value="RENT" />
            <el-option label="水电费" value="UTILITY" />
            <el-option label="其他" value="OTHER" />
          </el-select>
        </el-form-item>
        <el-form-item label="账期" prop="period">
          <el-input v-model="formData.period" placeholder="例如：2026-01" />
        </el-form-item>
        <el-form-item label="金额(元)" prop="amount">
          <el-input-number v-model="formData.amount" :min="0" :precision="2" />
        </el-form-item>
        <el-form-item label="到期日期" prop="dueDate">
          <el-date-picker v-model="formData.dueDate" type="date" placeholder="选择日期" value-format="YYYY-MM-DD" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitLoading" @click="handleSubmit">确定</el-button>
      </template>
    </el-dialog>

    <!-- 收款登记对话框（含滞纳金核销，T135/T141） -->
    <el-dialog v-model="paymentDialogVisible" title="登记收款" width="620px">
      <el-alert
        v-if="outstandingLateFeeCents > 0"
        type="warning"
        :closable="false"
        show-icon
        style="margin-bottom: 12px"
        :title="'本单有未核销滞纳金 ' + formatYuan(outstandingLateFeeCents) + '，收款将先冲抵本金，余额按确认先后核销滞纳金'"
      />
      <el-descriptions v-loading="paymentLateFeeLoading" :column="3" border size="small" style="margin-bottom: 16px">
        <el-descriptions-item label="账单编号">{{ currentBill?.billNumber }}</el-descriptions-item>
        <el-descriptions-item label="应付金额">
          ¥{{ ((currentBill?.amount || 0) / 100).toFixed(2) }}
        </el-descriptions-item>
        <el-descriptions-item label="已付金额">
          ¥{{ ((currentBill?.paidAmount || 0) / 100).toFixed(2) }}
        </el-descriptions-item>
        <el-descriptions-item label="未缴本金">¥{{ remainingYuan.toFixed(2) }}</el-descriptions-item>
        <el-descriptions-item label="未核销滞纳金">¥{{ (outstandingLateFeeCents / 100).toFixed(2) }}</el-descriptions-item>
        <el-descriptions-item label="应收合计">
          <span class="total-amount">¥{{ totalReceivableYuan.toFixed(2) }}</span>
        </el-descriptions-item>
      </el-descriptions>

      <el-form ref="paymentFormRef" :model="paymentForm" :rules="paymentRules" label-width="90px">
        <el-form-item label="收款金额" prop="amount">
          <el-input-number
            v-model="paymentForm.amount"
            :min="totalReceivableYuan > 0 ? 0.01 : 0"
            :max="totalReceivableYuan"
            :precision="2"
            :step="100"
          />
          <span class="payment-hint">
            元（最多可收 ¥{{ totalReceivableYuan.toFixed(2) }} ＝ 未缴本金 ¥{{ remainingYuan.toFixed(2) }} +
            滞纳金 ¥{{ (outstandingLateFeeCents / 100).toFixed(2) }}）
          </span>
        </el-form-item>
        <el-form-item label="收款方式" prop="paymentMethod">
          <el-select v-model="paymentForm.paymentMethod">
            <el-option
              v-for="(label, value) in paymentMethodMap"
              :key="value"
              :label="label"
              :value="value"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="交易号">
          <el-input v-model="paymentForm.transactionNumber" placeholder="选填；同一账单内不可重复" />
        </el-form-item>
        <el-form-item label="收款时间">
          <el-date-picker
            v-model="paymentForm.paidAt"
            type="datetime"
            placeholder="缺省为当前时间"
            value-format="YYYY-MM-DDTHH:mm:ss"
          />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="paymentForm.notes" placeholder="选填" />
        </el-form-item>
      </el-form>

      <el-divider content-position="left">收款记录</el-divider>
      <el-table :data="paymentRecords" size="small" v-loading="paymentLoading" border>
        <el-table-column label="收款时间" width="160">
          <template #default="{ row }">{{ formatDateTime(row.paidAt) }}</template>
        </el-table-column>
        <el-table-column label="金额" width="100">
          <template #default="{ row }">¥{{ (row.amount / 100).toFixed(2) }}</template>
        </el-table-column>
        <el-table-column label="方式" width="90">
          <template #default="{ row }">{{ paymentMethodMap[row.paymentMethod] || row.paymentMethod }}</template>
        </el-table-column>
        <el-table-column prop="transactionNumber" label="交易号" show-overflow-tooltip />
      </el-table>

      <template #footer>
        <el-button @click="paymentDialogVisible = false">关闭</el-button>
        <el-button
          type="primary"
          :loading="paymentSubmitLoading"
          :disabled="!currentBill || !canReceive(currentBill)"
          @click="handlePaymentSubmit"
        >
          确认收款
        </el-button>
      </template>
    </el-dialog>

    <!-- 滞纳金对话框（T151）：查看系统建议值 → 管理者确认入账 -->
    <el-dialog v-model="lateFeeDialogVisible" title="滞纳金" width="680px">
      <el-descriptions :column="3" border size="small" style="margin-bottom: 16px">
        <el-descriptions-item label="账单编号">{{ lateFeeBill?.billNumber }}</el-descriptions-item>
        <el-descriptions-item label="应付金额">{{ formatYuan(lateFeeBill?.amount) }}</el-descriptions-item>
        <el-descriptions-item label="未缴本金">{{ formatYuan(unpaidPrincipalCents) }}</el-descriptions-item>
        <el-descriptions-item label="到期日期">{{ lateFeeDueDateText }}</el-descriptions-item>
        <el-descriptions-item label="逾期天数">{{ lateFeeOverdueDaysText }}</el-descriptions-item>
        <el-descriptions-item label="账单状态">
          <el-tag size="small" :type="lateFeeBill ? statusTypeMap[lateFeeBill.status] : 'info'">
            {{ lateFeeBill ? statusMap[lateFeeBill.status] : '-' }}
          </el-tag>
        </el-descriptions-item>
      </el-descriptions>

      <div v-loading="lateFeeLoading" class="late-fee-body">
        <template v-if="!lateFeeLoading">
          <el-alert
            v-if="!currentLateFee"
            type="info"
            :closable="false"
            show-icon
            title="尚未生成系统建议值"
            description="系统按合同滞纳金规则（宽限期 / 日费率 / 封顶）计算建议值，仅作参考，不会自动入账。"
          />
          <el-alert
            v-else-if="!isLateFeeConfirmed(currentLateFee)"
            type="warning"
            :closable="false"
            show-icon
            :title="'系统建议值 ' + formatYuan(currentLateFee.suggestedAmount) + '（未确认，尚未入账）'"
            description="确认后该金额才计入本账单应收；未确认时不影响收款。可在下方调整金额，填 0 表示减免。"
          />
          <el-alert
            v-else
            type="success"
            :closable="false"
            show-icon
            :title="lateFeeConfirmedTitle"
            :description="lateFeeConfirmedDescription"
          />

          <el-descriptions
            v-if="currentLateFee && currentLateFee.calculation"
            :column="2"
            border
            size="small"
            style="margin-top: 16px"
          >
            <el-descriptions-item label="计费基数">
              {{ formatYuan(currentLateFee.calculation.baseAmount) }}
            </el-descriptions-item>
            <el-descriptions-item label="逾期天数">
              {{ currentLateFee.calculation.overdueDays }} 天
            </el-descriptions-item>
            <el-descriptions-item label="计费天数">
              {{ currentLateFee.calculation.effectiveDays }} 天（宽限
              {{ currentLateFee.calculation.rule.graceDays }} 天）
            </el-descriptions-item>
            <el-descriptions-item label="计算规则">{{ lateFeeRuleText }}</el-descriptions-item>
            <el-descriptions-item label="封顶前金额">
              {{ formatYuan(currentLateFee.calculation.rawAmount) }}
            </el-descriptions-item>
            <el-descriptions-item label="封顶">{{ lateFeeCapText }}</el-descriptions-item>
          </el-descriptions>

          <el-descriptions v-if="currentLateFee && isLateFeeConfirmed(currentLateFee)" :column="2" border size="small" style="margin-top: 12px">
            <el-descriptions-item label="确认时间">
              {{ formatDateTime(currentLateFee.confirmedAt || '') }}
            </el-descriptions-item>
            <el-descriptions-item label="已核销金额">{{ formatYuan(currentLateFee.settledAmount) }}</el-descriptions-item>
            <el-descriptions-item label="备注" :span="2">{{ currentLateFee.notes || '—' }}</el-descriptions-item>
          </el-descriptions>

          <el-form
            v-if="canConfirmLateFee"
            ref="lateFeeFormRef"
            :model="lateFeeForm"
            :rules="lateFeeRules"
            label-width="100px"
            style="margin-top: 16px"
          >
            <el-form-item label="确认金额" prop="amountYuan">
              <el-input-number v-model="lateFeeForm.amountYuan" :min="0" :precision="2" :step="10" />
              <span class="field-hint">元（默认＝系统建议值；填 0 表示减免，不入账）</span>
            </el-form-item>
            <el-form-item label="备注">
              <el-input
                v-model="lateFeeForm.notes"
                type="textarea"
                :rows="2"
                placeholder="选填：减免原因、审批单号等"
              />
            </el-form-item>
          </el-form>

          <el-alert
            v-else-if="lateFeeReadonlyReason"
            type="info"
            :closable="false"
            style="margin-top: 16px"
            :title="lateFeeReadonlyReason"
          />
        </template>
      </div>

      <template #footer>
        <el-button @click="lateFeeDialogVisible = false">关闭</el-button>
        <el-button v-if="canConfirmLateFee" :loading="lateFeeSuggestLoading" @click="handleGenerateSuggested">
          {{ currentLateFee ? '刷新建议值' : '生成建议值' }}
        </el-button>
        <el-button v-if="canConfirmLateFee" type="primary" :loading="lateFeeSubmitLoading" @click="handleConfirmLateFee">
          确认入账
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import type { FormInstance } from 'element-plus';
import {
  getBills,
  createBill,
  updateBill,
  deleteBill,
  getPayments,
  addPayment,
  getLateFees,
  addLateFee,
} from '@/api/bills';
import type { PaymentRecordItem, PaymentMethod } from '@/api/bills';
import type { Bill, LateFee } from '@/types';

const loading = ref(false);
const submitLoading = ref(false);
const dialogVisible = ref(false);
const dialogTitle = ref('新增账单');
const formRef = ref<FormInstance>();
const tableData = ref<Bill[]>([]);
const currentEditId = ref('');

// ── 收款登记（T135）──
const paymentDialogVisible = ref(false);
const paymentLoading = ref(false);
const paymentSubmitLoading = ref(false);
const paymentLateFeeLoading = ref(false);
const paymentFormRef = ref<FormInstance>();
const paymentRecords = ref<PaymentRecordItem[]>([]);
const currentBill = ref<Bill | null>(null);

const paymentForm = reactive({
  amount: 0,
  paymentMethod: 'CASH' as PaymentMethod,
  transactionNumber: '',
  paidAt: '',
  notes: '',
});

const paymentRules = {
  amount: [{ required: true, message: '请输入收款金额', trigger: 'blur' }],
  paymentMethod: [{ required: true, message: '请选择收款方式', trigger: 'change' }],
};

const queryForm = reactive({ status: '', billType: '' });
const pagination = reactive({ page: 1, limit: 20, total: 0 });
const formData = reactive({
  contractId: '',
  billType: 'RENT',
  period: '',
  amount: 0,
  dueDate: '',
});

const rules = {
  contractId: [{ required: true, message: '请输入合同ID', trigger: 'blur' }],
  billType: [{ required: true, message: '请选择账单类型', trigger: 'change' }],
  period: [{ required: true, message: '请输入账期', trigger: 'blur' }],
  amount: [{ required: true, message: '请输入金额', trigger: 'blur' }],
  dueDate: [{ required: true, message: '请选择到期日期', trigger: 'change' }],
};

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
  CANCELLED: '',
};

const paymentMethodMap: Record<string, string> = {
  CASH: '现金',
  BANK_TRANSFER: '银行转账',
  WECHAT: '微信',
  ALIPAY: '支付宝',
  OTHER: '其他',
};

/** 分 → ¥1,234.00 文案 */
const formatYuan = (cents?: number | null) => '¥' + ((cents ?? 0) / 100).toFixed(2);

const formatDateTime = (value: string) => (value ? value.replace('T', ' ').slice(0, 19) : '-');

// 剩余未缴本金（元）
const remainingYuan = computed(() => {
  if (!currentBill.value) return 0;
  return Math.max(0, (currentBill.value.amount - currentBill.value.paidAmount) / 100);
});

// 仅 PENDING / PARTIAL / OVERDUE 可收款（docs/04-状态机.md）
const canReceive = (bill: Bill | null) =>
  !!bill && ['PENDING', 'PARTIAL', 'OVERDUE'].includes(bill.status);

// ── 滞纳金（T151）──
const lateFeeDialogVisible = ref(false);
const lateFeeLoading = ref(false);
const lateFeeSuggestLoading = ref(false);
const lateFeeSubmitLoading = ref(false);
const lateFeeFormRef = ref<FormInstance>();
const lateFeeBill = ref<Bill | null>(null);
const lateFeeRecords = ref<LateFee[]>([]);
/** 账单 ID → 滞纳金记录（列表接口不回传滞纳金，前端按行拉取后缓存） */
const lateFeeMap = ref<Record<string, LateFee[]>>({});
const lateFeeLoadingMap = ref<Record<string, boolean>>({});

const lateFeeForm = reactive({ amountYuan: 0, notes: '' });

const lateFeeRules = {
  amountYuan: [
    { required: true, message: '请输入确认金额', trigger: 'blur' },
    { type: 'number', min: 0, message: '确认金额不能为负数', trigger: 'blur' },
  ],
};

/** 逾期天数（自然日，与后端 LateFeeUtil.overdueDays 同口径：到期日当天不算逾期） */
const overdueDaysOf = (bill: Bill) => {
  const due = new Date(bill.dueDate);
  const dueDay = Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate());
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.max(0, Math.floor((today - dueDay) / 86400000));
};

const isOverdueByDate = (bill: Bill) => overdueDaysOf(bill) > 0;

/** 未缴本金（分） */
const unpaidPrincipalCents = computed(() => {
  const bill = lateFeeBill.value;
  if (!bill) return 0;
  return Math.max(0, bill.amount - bill.paidAmount);
});

const lateFeeDueDateText = computed(() =>
  lateFeeBill.value ? lateFeeBill.value.dueDate.split('T')[0] : '-'
);

const lateFeeOverdueDaysText = computed(() => {
  const days = currentLateFee.value?.overdueDays ?? (lateFeeBill.value ? overdueDaysOf(lateFeeBill.value) : 0);
  return days > 0 ? days + ' 天' : '未逾期';
});

/** 当前弹窗账单的最新一条滞纳金记录（GET 按 createdAt 倒序） */
const currentLateFee = computed<LateFee | null>(() => lateFeeRecords.value[0] ?? null);

const isLateFeeConfirmed = (fee: LateFee | null): boolean =>
  !!fee && fee.confirmedAmount !== null && fee.confirmedAmount !== undefined;

/** 未核销金额（分）：未确认的滞纳金不计入应收 */
const outstandingOf = (fee: LateFee | null) => {
  if (!fee || fee.confirmedAmount === null || fee.confirmedAmount === undefined) return 0;
  return Math.max(0, fee.confirmedAmount - (fee.settledAmount ?? 0));
};

const lateFeeOf = (bill: Bill): LateFee | null => lateFeeMap.value[bill.id]?.[0] ?? null;

const lateFeeDisplayAmount = (fee: LateFee | null) =>
  fee ? (fee.confirmedAmount ?? fee.suggestedAmount) : 0;

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

/** 账单是否可新增 / 确认滞纳金（与后端 addLateFee 校验一致） */
const lateFeeDisabledReason = (bill: Bill | null): string => {
  if (!bill) return '';
  if (bill.status === 'PAID') return '账单已缴清，不可新增滞纳金';
  if (bill.status === 'CANCELLED') return '账单已取消，不可新增滞纳金';
  if (!isOverdueByDate(bill)) return '账单尚未逾期，无需计算滞纳金';
  if (bill.amount - bill.paidAmount <= 0) return '账单已缴清，无需计算滞纳金';
  return '';
};

const canManageLateFee = (bill: Bill | null) => !!bill && lateFeeDisabledReason(bill) === '';

/** 有记录即可查看；可管理时也可打开 */
const canOpenLateFee = (bill: Bill) => !!lateFeeOf(bill) || canManageLateFee(bill);

const canConfirmLateFee = computed(
  () => canManageLateFee(lateFeeBill.value) && !isLateFeeConfirmed(currentLateFee.value)
);

const lateFeeReadonlyReason = computed(() => {
  const bill = lateFeeBill.value;
  if (!bill) return '';
  if (isLateFeeConfirmed(currentLateFee.value)) return '该笔滞纳金已确认入账，不可重复确认；如需调整请走账务调整流程。';
  const reason = lateFeeDisabledReason(bill);
  return reason ? '当前不可确认滞纳金：' + reason : '';
});

const lateFeeRuleText = computed(() => {
  const rule = currentLateFee.value?.calculation?.rule;
  if (!rule) return '—';
  if (rule.dailyRate && rule.dailyRate > 0) return '按未缴金额 × ' + (rule.dailyRate * 100).toFixed(2) + '%/天';
  if (rule.fixedDaily && rule.fixedDaily > 0) return '固定 ' + formatYuan(rule.fixedDaily) + '/天';
  return '合同未配置计费规则（建议值为 0）';
});

const lateFeeCapText = computed(() => {
  const calc = currentLateFee.value?.calculation;
  if (!calc) return '—';
  if (calc.rule.cap === null) return '不封顶';
  return calc.capped ? '已触发封顶 ' + formatYuan(calc.rule.cap) : '未触发（上限 ' + formatYuan(calc.rule.cap) + '）';
});

const lateFeeConfirmedTitle = computed(() => {
  const fee = currentLateFee.value;
  if (!fee) return '';
  if (fee.confirmedAmount === 0) return '已确认减免：滞纳金 ¥0.00 不入账';
  const outstanding = outstandingOf(fee);
  return '已确认入账 ' + formatYuan(fee.confirmedAmount) + (outstanding > 0 ? '（未核销 ' + formatYuan(outstanding) + '）' : '（已核销）');
});

const lateFeeConfirmedDescription = computed(() => {
  const fee = currentLateFee.value;
  if (!fee) return '';
  const parts = ['确认时间 ' + formatDateTime(fee.confirmedAt || '')];
  if (fee.confirmedAmount === 0) parts.push('无应收，直接视为结清');
  if (fee.notes) parts.push('备注：' + fee.notes);
  return parts.join('；');
});

// 收款弹窗：未核销滞纳金合计（分）
const outstandingLateFeeCents = computed(() => {
  const bill = currentBill.value;
  if (!bill) return 0;
  return (lateFeeMap.value[bill.id] ?? []).reduce((sum, fee) => sum + outstandingOf(fee), 0);
});

// 应收合计 = 未缴本金 + 未核销滞纳金（T141 核销上限）
const totalReceivableYuan = computed(() => remainingYuan.value + outstandingLateFeeCents.value / 100);

const applyLateFeeRecords = (billId: string, records: LateFee[]) => {
  lateFeeRecords.value = records;
  lateFeeMap.value = { ...lateFeeMap.value, [billId]: records };
};

const refreshBillLateFees = async (billId: string): Promise<LateFee[]> => {
  const records = await getLateFees(billId);
  lateFeeMap.value = { ...lateFeeMap.value, [billId]: records };
  return records;
};

/**
 * 列表行滞纳金：直接使用列表接口随行返回的 lateFeeSummary（T157），
 * 不再对当前页每行发 GET /bills/:id/late-fees（原为 20 次/页的 N+1）。
 *
 * 摘要只含 4 个字段，而列表单元格只需要「金额 + 状态」，
 * 因此这里把摘要适配成 LateFee 的最小形状喂给既有展示函数，
 * 打开弹窗时再拉取完整明细覆盖（见 openLateFeeDialog）。
 */
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
    // 已有完整明细（弹窗打开过）时不覆盖，避免把完整数据降级成摘要
    if (next[bill.id] && next[bill.id].length && !String(next[bill.id][0].id).startsWith('summary-')) {
      return;
    }
    const adapted = summaryToLateFee(bill);
    if (adapted) next[bill.id] = [adapted];
    else delete next[bill.id];
  });
  lateFeeMap.value = next;
};

const fetchData = async (_options: { refreshLateFees?: boolean } = {}) => {
  loading.value = true;
  try {
    // 空字符串筛选项会被后端 @IsEnum 校验拒绝（400），仅在选中时才传
    const params: Record<string, any> = { page: pagination.page, limit: pagination.limit };
    if (queryForm.status) params.status = queryForm.status;
    if (queryForm.billType) params.billType = queryForm.billType;
    const response = await getBills(params);
    tableData.value = response.data;
    pagination.total = response.meta.total;
    // 列表已带滞纳金摘要，直接适配，无需逐行请求
    applySummaries(tableData.value);
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
  queryForm.billType = '';
  handleQuery();
};

const handleCreate = () => {
  dialogTitle.value = '新增账单';
  currentEditId.value = '';
  dialogVisible.value = true;
};

const handleEdit = (row: Bill) => {
  dialogTitle.value = '编辑账单';
  currentEditId.value = row.id;
  Object.assign(formData, {
    contractId: row.contractId,
    billType: row.billType,
    period: row.period,
    amount: row.amount / 100,
    dueDate: row.dueDate.split('T')[0],
  });
  dialogVisible.value = true;
};

const handleDelete = async (row: Bill) => {
  try {
    await ElMessageBox.confirm('确定要删除吗？', '提示', { type: 'warning' });
    await deleteBill(row.id);
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
        amount: Math.round(formData.amount * 100),
      };
      if (currentEditId.value) {
        await updateBill(currentEditId.value, data);
        ElMessage.success('更新成功');
      } else {
        await createBill(data);
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

// ── 收款登记（T135）+ 滞纳金核销（T141）──

const handlePayment = async (row: Bill) => {
  currentBill.value = row;
  paymentRecords.value = [];
  paymentForm.paymentMethod = 'CASH';
  paymentForm.transactionNumber = '';
  paymentForm.paidAt = '';
  paymentForm.notes = '';
  paymentDialogVisible.value = true;

  // 先取到未核销滞纳金，才能给出含滞纳金的应收总额
  paymentLateFeeLoading.value = true;
  try {
    await refreshBillLateFees(row.id);
  } catch {
    // 请求拦截器已提示
  } finally {
    paymentLateFeeLoading.value = false;
  }

  paymentForm.amount = totalReceivableYuan.value > 0 ? totalReceivableYuan.value : 0;
  await loadPayments();
};

const loadPayments = async () => {
  if (!currentBill.value) return;
  paymentLoading.value = true;
  try {
    paymentRecords.value = await getPayments(currentBill.value.id);
  } catch {
    // 请求拦截器已弹出错误提示
  } finally {
    paymentLoading.value = false;
  }
};

const handlePaymentSubmit = async () => {
  const bill = currentBill.value;
  if (!paymentFormRef.value || !bill) return;
  await paymentFormRef.value.validate(async (valid) => {
    if (!valid) return;
    paymentSubmitLoading.value = true;
    try {
      await addPayment(bill.id, {
        amount: Math.round(paymentForm.amount * 100),
        paymentMethod: paymentForm.paymentMethod,
        transactionNumber: paymentForm.transactionNumber || undefined,
        paidAt: paymentForm.paidAt || undefined,
        notes: paymentForm.notes || undefined,
      });
      ElMessage.success('收款登记成功');
      await fetchData({ refreshLateFees: false });
      try {
        await refreshBillLateFees(bill.id);
      } catch {
        // 请求拦截器已提示
      }
      const latest = tableData.value.find((item) => item.id === bill.id);
      if (latest) currentBill.value = latest;
      await loadPayments();
      paymentForm.amount = totalReceivableYuan.value > 0 ? totalReceivableYuan.value : 0;
    } catch {
      // 请求拦截器已弹出错误提示（含超额、交易号重复等业务信息）
    } finally {
      paymentSubmitLoading.value = false;
    }
  });
};

// ── 滞纳金（T151）──

const handleLateFee = async (row: Bill) => {
  lateFeeBill.value = row;
  lateFeeRecords.value = [];
  lateFeeForm.amountYuan = 0;
  lateFeeForm.notes = '';
  lateFeeDialogVisible.value = true;
  lateFeeLoading.value = true;
  try {
    const records = await getLateFees(row.id);
    applyLateFeeRecords(row.id, records);
    const target = records.find((item) => !isLateFeeConfirmed(item)) ?? records[0];
    if (target) {
      lateFeeForm.amountYuan = isLateFeeConfirmed(target) ? 0 : target.suggestedAmount / 100;
      lateFeeForm.notes = target.notes ?? '';
    }
  } catch {
    // 请求拦截器已提示
  } finally {
    lateFeeLoading.value = false;
  }
};

/** 生成 / 刷新系统建议值（不传 confirmedAmount，不生效、不入账） */
const handleGenerateSuggested = async () => {
  const bill = lateFeeBill.value;
  if (!bill) return;
  lateFeeSuggestLoading.value = true;
  try {
    const result = await addLateFee(bill.id, lateFeeForm.notes ? { notes: lateFeeForm.notes } : {});
    applyLateFeeRecords(bill.id, [result]);
    lateFeeForm.amountYuan = result.suggestedAmount / 100;
    try {
      applyLateFeeRecords(bill.id, await refreshBillLateFees(bill.id));
    } catch {
      // 请求拦截器已提示
    }
    ElMessage.success('已生成系统建议值（尚未入账，确认后才计入应收）');
  } catch {
    // 请求拦截器已提示
  } finally {
    lateFeeSuggestLoading.value = false;
  }
};

/** 管理者确认入账（传 confirmedAmount，单位分，可为 0 表示减免） */
const handleConfirmLateFee = async () => {
  const bill = lateFeeBill.value;
  if (!lateFeeFormRef.value || !bill) return;

  await lateFeeFormRef.value.validate(async (valid) => {
    if (!valid) return;

    const cents = Math.round(lateFeeForm.amountYuan * 100);
    const suggested = currentLateFee.value?.suggestedAmount ?? 0;
    const adjusted = cents !== suggested ? '（系统建议值 ' + formatYuan(suggested) + '，已调整）' : '';
    const actionText =
      cents === 0
        ? '确认将滞纳金减免为 ¥0.00（不入账）'
        : '确认滞纳金 ' + formatYuan(cents) + ' 入账';

    try {
      await ElMessageBox.confirm(
        actionText + adjusted + '？确认后该金额计入本账单应收，可在登记收款时一并核销。',
        '确认滞纳金',
        { type: 'warning', confirmButtonText: '确认入账', cancelButtonText: '取消' }
      );
    } catch {
      return; // 用户取消
    }

    lateFeeSubmitLoading.value = true;
    try {
      const result = await addLateFee(bill.id, {
        confirmedAmount: cents,
        notes: lateFeeForm.notes || undefined,
      });
      applyLateFeeRecords(bill.id, [result]);
      ElMessage.success(cents === 0 ? '已确认减免，滞纳金不入账' : '滞纳金已确认入账');
      await fetchData({ refreshLateFees: false });
      try {
        applyLateFeeRecords(bill.id, await refreshBillLateFees(bill.id));
      } catch {
        // 请求拦截器已提示
      }
      const latest = tableData.value.find((item) => item.id === bill.id);
      if (latest) lateFeeBill.value = latest;
    } catch {
      // 请求拦截器已提示（未逾期 / 已确认 409 等）
    } finally {
      lateFeeSubmitLoading.value = false;
    }
  });
};

onMounted(fetchData);
</script>

<style scoped>
.bills-page { padding: 0; }

.payment-hint,
.field-hint {
  margin-left: 8px;
  color: #909399;
  font-size: 12px;
}

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
  color: #909399;
}

.late-fee-empty { color: #c0c4cc; }

.late-fee-body { min-height: 80px; }

.total-amount {
  font-weight: 600;
  color: #e6a23c;
}
</style>
