<template>
  <el-dialog
    :model-value="modelValue"
    title="登记收款"
    width="620px"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <el-alert
      v-if="outstandingLateFeeCents > 0"
      type="warning"
      :closable="false"
      show-icon
      style="margin-bottom: 12px"
      :title="'本单有未核销滞纳金 ' + formatMoney(outstandingLateFeeCents) + '，收款将先冲抵本金，余额按确认先后核销滞纳金'"
    />
    <el-descriptions v-loading="lateFeeLoading" :column="3" border size="small" style="margin-bottom: 16px">
      <el-descriptions-item label="账单编号">{{ currentBill?.billNumber }}</el-descriptions-item>
      <el-descriptions-item label="应付金额">
        {{ formatMoney(currentBill?.amount) }}
      </el-descriptions-item>
      <el-descriptions-item label="已付金额">
        {{ formatMoney(currentBill?.paidAmount) }}
      </el-descriptions-item>
      <el-descriptions-item label="未缴本金">¥{{ remainingYuan.toFixed(2) }}</el-descriptions-item>
      <el-descriptions-item label="未核销滞纳金">{{ formatMoney(outstandingLateFeeCents) }}</el-descriptions-item>
      <el-descriptions-item label="应收合计">
        <span class="total-amount">¥{{ totalReceivableYuan.toFixed(2) }}</span>
      </el-descriptions-item>
    </el-descriptions>

    <el-form ref="formRef" :model="form" :rules="rules" label-width="90px">
      <el-form-item label="收款金额" prop="amount">
        <el-input-number
          v-model="form.amount"
          :min="totalReceivableYuan > 0 ? 0.01 : 0"
          :max="totalReceivableYuan"
          :precision="2"
          :step="100"
        />
        <span class="payment-hint">
          元（最多可收 ¥{{ totalReceivableYuan.toFixed(2) }} ＝ 未缴本金 ¥{{ remainingYuan.toFixed(2) }} +
          滞纳金 {{ formatMoney(outstandingLateFeeCents) }}）
        </span>
      </el-form-item>
      <el-form-item label="收款方式" prop="paymentMethod">
        <el-select v-model="form.paymentMethod">
          <el-option
            v-for="(label, value) in paymentMethodMap"
            :key="value"
            :label="label"
            :value="value"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="交易号">
        <el-input v-model="form.transactionNumber" placeholder="选填；同一账单内不可重复" />
      </el-form-item>
      <el-form-item label="收款时间">
        <el-date-picker
          v-model="form.paidAt"
          type="datetime"
          placeholder="缺省为当前时间"
          value-format="YYYY-MM-DDTHH:mm:ss"
        />
      </el-form-item>
      <el-form-item label="备注">
        <el-input v-model="form.notes" placeholder="选填" />
      </el-form-item>
    </el-form>

    <el-divider content-position="left">收款记录</el-divider>
    <el-table :data="paymentRecords" size="small" v-loading="loadingRecords" border>
      <el-table-column label="收款时间" width="160">
        <template #default="{ row }">{{ formatDateTime(row.paidAt) }}</template>
      </el-table-column>
      <el-table-column label="金额" width="100">
        <template #default="{ row }">{{ formatMoney(row.amount) }}</template>
      </el-table-column>
      <el-table-column label="方式" width="90">
        <template #default="{ row }">{{ paymentMethodMap[row.paymentMethod] || row.paymentMethod }}</template>
      </el-table-column>
      <el-table-column prop="transactionNumber" label="交易号" show-overflow-tooltip />
    </el-table>

    <template #footer>
      <el-button @click="$emit('update:modelValue', false)">关闭</el-button>
      <el-button
        type="primary"
        :loading="submitLoading"
        :disabled="!currentBill || !canReceive(currentBill)"
        @click="handleSubmit"
      >
        确认收款
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch } from 'vue';
import { ElMessage } from 'element-plus';
import type { FormInstance } from 'element-plus';
import { getPayments, addPayment, getLateFees } from '@/api/bills';
import type { PaymentRecordItem, PaymentMethod } from '@/api/bills';
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
const loadingRecords = ref(false);
const lateFeeLoading = ref(false);
const submitLoading = ref(false);
const paymentRecords = ref<PaymentRecordItem[]>([]);
const lateFeeRecords = ref<LateFee[]>([]);
const currentBill = ref<Bill | null>(null);
const idempotencyKey = ref('');

const paymentMethodMap: Record<string, string> = {
  CASH: '现金',
  BANK_TRANSFER: '银行转账',
  WECHAT: '微信',
  ALIPAY: '支付宝',
  OTHER: '其他',
};

const form = reactive({
  amount: 0,
  paymentMethod: 'CASH' as PaymentMethod,
  transactionNumber: '',
  paidAt: '',
  notes: '',
});

const rules = {
  amount: [{ required: true, message: '请输入收款金额', trigger: 'blur' }],
  paymentMethod: [{ required: true, message: '请选择收款方式', trigger: 'change' }],
};

const formatDateTime = (value: string) => (value ? value.replace('T', ' ').slice(0, 19) : '-');

const remainingYuan = computed(() => {
  if (!currentBill.value) return 0;
  return Math.max(0, centsToYuan(currentBill.value.amount - currentBill.value.paidAmount));
});

const outstandingLateFeeCents = computed(() => {
  return lateFeeRecords.value.reduce((sum, fee) => {
    if (!fee || fee.confirmedAmount === null || fee.confirmedAmount === undefined) return sum;
    return sum + Math.max(0, fee.confirmedAmount - (fee.settledAmount ?? 0));
  }, 0);
});

const totalReceivableYuan = computed(() => remainingYuan.value + centsToYuan(outstandingLateFeeCents.value));

const canReceive = (bill: Bill | null) =>
  !!bill && ['PENDING', 'PARTIAL', 'OVERDUE'].includes(bill.status);

watch(
  () => [props.modelValue, props.bill] as const,
  async ([visible, bill]) => {
    if (visible && bill) {
      currentBill.value = bill;
      paymentRecords.value = [];
      lateFeeRecords.value = [];
      form.paymentMethod = 'CASH';
      form.transactionNumber = '';
      form.paidAt = '';
      form.notes = '';

      lateFeeLoading.value = true;
      try {
        lateFeeRecords.value = await getLateFees(bill.id);
      } catch {
        // Handled by request interceptor
      } finally {
        lateFeeLoading.value = false;
      }

      form.amount = totalReceivableYuan.value > 0 ? totalReceivableYuan.value : 0;
      idempotencyKey.value = crypto.randomUUID();
      await loadPayments();
    }
  },
  { immediate: true }
);

async function loadPayments() {
  if (!currentBill.value) return;
  loadingRecords.value = true;
  try {
    paymentRecords.value = await getPayments(currentBill.value.id);
  } catch {
    // Handled by request interceptor
  } finally {
    loadingRecords.value = false;
  }
}

async function handleSubmit() {
  const bill = currentBill.value;
  if (!formRef.value || !bill) return;

  await formRef.value.validate(async (valid) => {
    if (!valid) return;
    submitLoading.value = true;
    try {
      await addPayment(bill.id, {
        amount: Math.round(form.amount * 100),
        paymentMethod: form.paymentMethod,
        transactionNumber: form.transactionNumber || undefined,
        paidAt: form.paidAt || undefined,
        notes: form.notes || undefined,
        idempotencyKey: idempotencyKey.value,
      });
      ElMessage.success('收款登记成功');
      emit('success');
      emit('update:modelValue', false);
    } catch {
      // Handled by request interceptor
    } finally {
      submitLoading.value = false;
    }
  });
}
</script>

<style scoped>
.payment-hint {
  margin-left: 8px;
  color: var(--text-muted);
  font-size: 12px;
}
.total-amount {
  font-weight: 600;
  color: var(--warning-text);
}
</style>
