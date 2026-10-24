<template>
  <el-dialog
    :model-value="modelValue"
    title="滞纳金"
    width="680px"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <el-descriptions :column="3" border size="small" style="margin-bottom: 16px">
      <el-descriptions-item label="账单编号">{{ currentBill?.billNumber }}</el-descriptions-item>
      <el-descriptions-item label="应付金额">{{ formatMoney(currentBill?.amount) }}</el-descriptions-item>
      <el-descriptions-item label="未缴本金">{{ formatMoney(unpaidPrincipalCents) }}</el-descriptions-item>
      <el-descriptions-item label="到期日期">{{ lateFeeDueDateText }}</el-descriptions-item>
      <el-descriptions-item label="逾期天数">{{ lateFeeOverdueDaysText }}</el-descriptions-item>
      <el-descriptions-item label="账单状态">
        <el-tag size="small" :type="currentBill ? statusTypeMap[currentBill.status] : 'info'">
          {{ currentBill ? statusMap[currentBill.status] : '-' }}
        </el-tag>
      </el-descriptions-item>
    </el-descriptions>

    <div v-loading="loading" class="late-fee-body">
      <template v-if="!loading">
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
          :title="'系统建议值 ' + formatMoney(currentLateFee.suggestedAmount) + '（未确认，尚未入账）'"
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
            {{ formatMoney(currentLateFee.calculation.baseAmount) }}
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
            {{ formatMoney(currentLateFee.calculation.rawAmount) }}
          </el-descriptions-item>
          <el-descriptions-item label="封顶">{{ lateFeeCapText }}</el-descriptions-item>
        </el-descriptions>

        <el-descriptions
          v-if="currentLateFee && isLateFeeConfirmed(currentLateFee)"
          :column="2"
          border
          size="small"
          style="margin-top: 12px"
        >
          <el-descriptions-item label="确认时间">
            {{ formatDateTime(currentLateFee.confirmedAt || '') }}
          </el-descriptions-item>
          <el-descriptions-item label="已核销金额">{{ formatMoney(currentLateFee.settledAmount) }}</el-descriptions-item>
          <el-descriptions-item label="备注" :span="2">{{ currentLateFee.notes || '—' }}</el-descriptions-item>
        </el-descriptions>

        <el-form
          v-if="canConfirmLateFee"
          ref="formRef"
          :model="form"
          :rules="rules"
          label-width="100px"
          style="margin-top: 16px"
        >
          <el-form-item label="确认金额" prop="amountYuan">
            <el-input-number v-model="form.amountYuan" :min="0" :precision="2" :step="10" />
            <span class="field-hint">元（默认＝系统建议值；填 0 表示减免，不入账）</span>
          </el-form-item>
          <el-form-item label="备注">
            <el-input
              v-model="form.notes"
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
      <el-button @click="$emit('update:modelValue', false)">关闭</el-button>
      <el-button v-if="canConfirmLateFee" :loading="suggestLoading" @click="handleGenerateSuggested">
        {{ currentLateFee ? '刷新建议值' : '生成建议值' }}
      </el-button>
      <el-button v-if="canConfirmLateFee" type="primary" :loading="submitLoading" @click="handleConfirmLateFee">
        确认入账
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import type { FormInstance } from 'element-plus';
import { getLateFees, addLateFee } from '@/api/bills';
import type { Bill, LateFee } from '@/types';
import { centsToYuan, formatMoney } from '@/utils/money';

const props = defineProps<{
  modelValue: boolean;
  bill: Bill | null;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', val: boolean): void;
  (e: 'success'): void;
}>();

const formRef = ref<FormInstance>();
const loading = ref(false);
const suggestLoading = ref(false);
const submitLoading = ref(false);
const currentBill = ref<Bill | null>(null);
const lateFeeRecords = ref<LateFee[]>([]);

const form = reactive({
  amountYuan: 0,
  notes: '',
});

const rules = {
  amountYuan: [
    { required: true, message: '请输入确认金额', trigger: 'blur' },
    { type: 'number', min: 0, message: '确认金额不能为负数', trigger: 'blur' },
  ],
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

const formatDateTime = (value: string) => (value ? value.replace('T', ' ').slice(0, 19) : '-');

const overdueDaysOf = (bill: Bill) => {
  const due = new Date(bill.dueDate);
  const dueDay = Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate());
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.max(0, Math.floor((today - dueDay) / 86400000));
};

const isOverdueByDate = (bill: Bill) => overdueDaysOf(bill) > 0;

const unpaidPrincipalCents = computed(() => {
  const bill = currentBill.value;
  if (!bill) return 0;
  return Math.max(0, bill.amount - bill.paidAmount);
});

const lateFeeDueDateText = computed(() =>
  currentBill.value ? currentBill.value.dueDate.split('T')[0] : '-'
);

const lateFeeOverdueDaysText = computed(() => {
  const days = currentLateFee.value?.overdueDays ?? (currentBill.value ? overdueDaysOf(currentBill.value) : 0);
  return days > 0 ? days + ' 天' : '未逾期';
});

const currentLateFee = computed<LateFee | null>(() => lateFeeRecords.value[0] ?? null);

const isLateFeeConfirmed = (fee: LateFee | null): boolean =>
  !!fee && fee.confirmedAmount !== null && fee.confirmedAmount !== undefined;

const outstandingOf = (fee: LateFee | null) => {
  if (!fee || fee.confirmedAmount === null || fee.confirmedAmount === undefined) return 0;
  return Math.max(0, fee.confirmedAmount - (fee.settledAmount ?? 0));
};

const lateFeeDisabledReason = (bill: Bill | null): string => {
  if (!bill) return '';
  if (bill.status === 'PAID') return '账单已缴清，不可新增滞纳金';
  if (bill.status === 'CANCELLED') return '账单已取消，不可新增滞纳金';
  if (!isOverdueByDate(bill)) return '账单尚未逾期，无需计算滞纳金';
  if (bill.amount - bill.paidAmount <= 0) return '账单已缴清，无需计算滞纳金';
  return '';
};

const canManageLateFee = (bill: Bill | null) => !!bill && lateFeeDisabledReason(bill) === '';

const canConfirmLateFee = computed(
  () => canManageLateFee(currentBill.value) && !isLateFeeConfirmed(currentLateFee.value)
);

const lateFeeReadonlyReason = computed(() => {
  const bill = currentBill.value;
  if (!bill) return '';
  if (isLateFeeConfirmed(currentLateFee.value)) return '该笔滞纳金已确认入账，不可重复确认；如需调整请走账务调整流程。';
  const reason = lateFeeDisabledReason(bill);
  return reason ? '当前不可确认滞纳金：' + reason : '';
});

const lateFeeRuleText = computed(() => {
  const rule = currentLateFee.value?.calculation?.rule;
  if (!rule) return '—';
  if (rule.dailyRate && rule.dailyRate > 0) return '按未缴金额 × ' + (rule.dailyRate * 100).toFixed(2) + '%/天';
  if (rule.fixedDaily && rule.fixedDaily > 0) return '固定 ' + formatMoney(rule.fixedDaily) + '/天';
  return '合同未配置计费规则（建议值为 0）';
});

const lateFeeCapText = computed(() => {
  const calc = currentLateFee.value?.calculation;
  if (!calc) return '—';
  if (calc.rule.cap === null) return '不封顶';
  return calc.capped ? '已触发封顶 ' + formatMoney(calc.rule.cap) : '未触发（上限 ' + formatMoney(calc.rule.cap) + '）';
});

const lateFeeConfirmedTitle = computed(() => {
  const fee = currentLateFee.value;
  if (!fee) return '';
  if (fee.confirmedAmount === 0) return '已确认减免：滞纳金 ¥0.00 不入账';
  const outstanding = outstandingOf(fee);
  return '已确认入账 ' + formatMoney(fee.confirmedAmount) + (outstanding > 0 ? '（未核销 ' + formatMoney(outstanding) + '）' : '（已核销）');
});

const lateFeeConfirmedDescription = computed(() => {
  const fee = currentLateFee.value;
  if (!fee) return '';
  const parts = ['确认时间 ' + formatDateTime(fee.confirmedAt || '')];
  if (fee.confirmedAmount === 0) parts.push('无应收，直接视为结清');
  if (fee.notes) parts.push('备注：' + fee.notes);
  return parts.join('；');
});

watch(
  () => [props.modelValue, props.bill] as const,
  async ([visible, bill]) => {
    if (visible && bill) {
      currentBill.value = bill;
      lateFeeRecords.value = [];
      form.amountYuan = 0;
      form.notes = '';
      loading.value = true;
      try {
        const records = await getLateFees(bill.id);
        lateFeeRecords.value = records;
        const target = records.find((item) => !isLateFeeConfirmed(item)) ?? records[0];
        if (target) {
          form.amountYuan = isLateFeeConfirmed(target) ? 0 : centsToYuan(target.suggestedAmount);
          form.notes = target.notes ?? '';
        }
      } catch {
        // Handled by request interceptor
      } finally {
        loading.value = false;
      }
    }
  },
  { immediate: true }
);

const handleGenerateSuggested = async () => {
  const bill = currentBill.value;
  if (!bill) return;
  suggestLoading.value = true;
  try {
    const result = await addLateFee(bill.id, form.notes ? { notes: form.notes } : {});
    lateFeeRecords.value = [result];
    form.amountYuan = centsToYuan(result.suggestedAmount);
    try {
      lateFeeRecords.value = await getLateFees(bill.id);
    } catch {
      // Handled by request interceptor
    }
    ElMessage.success('已生成系统建议值（尚未入账，确认后才计入应收）');
    emit('success');
  } catch {
    // Handled by request interceptor
  } finally {
    suggestLoading.value = false;
  }
};

const handleConfirmLateFee = async () => {
  const bill = currentBill.value;
  if (!formRef.value || !bill) return;

  await formRef.value.validate(async (valid) => {
    if (!valid) return;
    const cents = Math.round(form.amountYuan * 100);
    const suggested = currentLateFee.value?.suggestedAmount ?? 0;
    const adjusted = cents !== suggested ? '（系统建议值 ' + formatMoney(suggested) + '，已调整）' : '';
    const actionText =
      cents === 0
        ? '确认将滞纳金减免为 ¥0.00（不入账）'
        : '确认滞纳金 ' + formatMoney(cents) + ' 入账';

    try {
      await ElMessageBox.confirm(
        actionText + adjusted + '？确认后该金额计入本账单应收，可在登记收款时一并核销。',
        '确认滞纳金',
        { type: 'warning', confirmButtonText: '确认入账', cancelButtonText: '取消' }
      );
    } catch {
      return;
    }

    submitLoading.value = true;
    try {
      const result = await addLateFee(bill.id, {
        confirmedAmount: cents,
        notes: form.notes || undefined,
      });
      lateFeeRecords.value = [result];
      ElMessage.success(cents === 0 ? '已确认减免，滞纳金不入账' : '滞纳金已确认入账');
      emit('success');
      emit('update:modelValue', false);
    } catch {
      // Handled by request interceptor
    } finally {
      submitLoading.value = false;
    }
  });
};
</script>

<style scoped>
.field-hint {
  margin-left: 8px;
  color: var(--text-muted);
  font-size: 12px;
}
.late-fee-body {
  min-height: 80px;
}
</style>
