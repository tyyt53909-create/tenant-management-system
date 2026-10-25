<template>
  <el-dialog
    v-model="visible"
    title="电子收款收据凭单"
    width="760px"
    destroy-on-close
    append-to-body
    class="receipt-dialog-wrapper"
  >
    <div v-loading="loading" class="receipt-content-box">
      <div v-if="receipt" id="printable-receipt" class="receipt-paper">
        <!-- 票据抬头 -->
        <div class="receipt-header">
          <div class="header-main">房屋租赁收款收据</div>
          <div class="header-sub">RENT PAYMENT RECEIPT</div>
        </div>

        <!-- 票据元信息 -->
        <div class="receipt-meta-grid">
          <div class="meta-item">
            <span class="meta-label">收据编号：</span>
            <span class="meta-value">{{ receipt.receiptNumber }}</span>
          </div>
          <div class="meta-item">
            <span class="meta-label">开具日期：</span>
            <span class="meta-value">{{ formatDate(receipt.issuedAt) }}</span>
          </div>
          <div class="meta-item">
            <span class="meta-label">交款租客：</span>
            <span class="meta-value"><b>{{ receipt.payerName }}</b> ({{ receipt.payerPhone || '无电话' }})</span>
          </div>
          <div class="meta-item">
            <span class="meta-label">房屋房号：</span>
            <span class="meta-value"><b>{{ receipt.buildingName }} {{ receipt.roomNumber }}</b></span>
          </div>
        </div>

        <!-- 票据明细表格 -->
        <table class="receipt-table">
          <thead>
            <tr>
              <th style="width: 140px">收款项目</th>
              <th style="width: 100px">账期</th>
              <th style="width: 100px; text-align: right">账单本金</th>
              <th style="width: 100px; text-align: right">确认滞纳金</th>
              <th style="width: 110px; text-align: right">已收金额</th>
              <th>收款方式 / 流水号</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><b>{{ receipt.billTypeLabel }}</b></td>
              <td>{{ receipt.period }}</td>
              <td style="text-align: right">{{ formatMoney(receipt.principalAmount) }}</td>
              <td style="text-align: right">{{ formatMoney(receipt.confirmedLateFee) }}</td>
              <td style="text-align: right" class="paid-cell">{{ formatMoney(receipt.totalPaid) }}</td>
              <td>
                <div v-for="p in receipt.payments" :key="p.id" class="pay-sub-line">
                  <span>{{ methodLabel[p.paymentMethod] || p.paymentMethod }}</span>
                  <small v-if="p.transactionNumber">({{ p.transactionNumber }})</small>
                </div>
                <span v-if="!receipt.payments || receipt.payments.length === 0">-</span>
              </td>
            </tr>
          </tbody>
        </table>

        <!-- 大写与金额合计行 -->
        <div class="receipt-total-bar">
          <div class="chinese-amount-wrap">
            <span class="total-label">收款金额大写：</span>
            <span class="chinese-amount"><b>{{ receipt.amountInChinese }}</b></span>
          </div>
          <div class="number-amount-wrap">
            <span class="total-label">实收合计：</span>
            <span class="number-amount">{{ formatMoney(receipt.totalPaid) }}</span>
          </div>
        </div>

        <div v-if="receipt.unpaid > 0" class="unpaid-reminder">
          注：本账单尚有未缴清本金 {{ formatMoney(receipt.unpaid) }} 元。
        </div>

        <!-- 票据底部签章与说明 -->
        <div class="receipt-footer">
          <div class="footer-sign">
            <span>经手收款人：</span>
            <span class="sign-underline"></span>
          </div>
          <div class="footer-sign">
            <span>租客确认签字：</span>
            <span class="sign-underline"></span>
          </div>
          <div class="stamp-box">
            <div class="stamp-circle">
              <span>财务专用章</span>
              <small>{{ receipt.buildingName || '物业管理' }}</small>
            </div>
          </div>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="dialog-action-bar">
        <span class="print-tip">打印时将自动调用系统标准 A4 / 单据打印格式</span>
        <div>
          <el-button @click="visible = false">关闭</el-button>
          <el-button type="primary" :disabled="!receipt" @click="handlePrint">
            打印收据
          </el-button>
        </div>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import request from '@/utils/request';
import { formatMoney } from '@/utils/money';
import { notifyApiError } from '@/utils/notify';

const props = defineProps<{
  modelValue: boolean;
  billId: string;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', val: boolean): void;
}>();

const visible = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val),
});

const loading = ref(false);
const receipt = ref<any>(null);

const methodLabel: Record<string, string> = {
  WECHAT: '微信支付',
  ALIPAY: '支付宝',
  BANK_TRANSFER: '银行转账',
  CASH: '现金',
  OTHER: '其他',
};

function formatDate(dateStr?: string) {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

async function fetchReceipt() {
  if (!props.billId) return;
  loading.value = true;
  try {
    const data = await request.get(`/bills/${props.billId}/receipt`);
    receipt.value = data;
  } catch (err: any) {
    notifyApiError(err, '获取电子收据详情失败');
  } finally {
    loading.value = false;
  }
}

watch(visible, (val) => {
  if (val) {
    fetchReceipt();
  } else {
    receipt.value = null;
  }
});

function handlePrint() {
  window.print();
}
</script>

<style scoped>
.receipt-content-box {
  background-color: #f1f5f9;
  padding: 16px;
  border-radius: 6px;
}

.receipt-paper {
  background-color: #ffffff;
  padding: 30px 36px;
  border-radius: 4px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.06);
  position: relative;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang SC', sans-serif;
  color: #1e293b;
}

.receipt-header {
  text-align: center;
  border-bottom: 2px solid #0f172a;
  padding-bottom: 12px;
  margin-bottom: 16px;
}

.header-main {
  font-size: 22px;
  font-weight: 700;
  letter-spacing: 2px;
  color: #0f172a;
}

.header-sub {
  font-size: 11px;
  color: #64748b;
  letter-spacing: 1px;
  margin-top: 2px;
}

.receipt-meta-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  row-gap: 8px;
  column-gap: 20px;
  font-size: 13px;
  margin-bottom: 16px;
}

.meta-label {
  color: #64748b;
}

.meta-value {
  color: #0f172a;
}

.receipt-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
  margin-bottom: 14px;
}

.receipt-table th,
.receipt-table td {
  border: 1px solid #cbd5e1;
  padding: 8px 10px;
}

.receipt-table th {
  background-color: #f8fafc;
  color: #475569;
  font-weight: 600;
}

.paid-cell {
  font-weight: 600;
  color: var(--success-text);
}

.pay-sub-line {
  font-size: 12px;
  color: #475569;
}

.receipt-total-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border: 1px solid #cbd5e1;
  padding: 10px 14px;
  background-color: #f8fafc;
  margin-bottom: 10px;
}

.total-label {
  font-size: 13px;
  color: #475569;
}

.chinese-amount {
  font-size: 15px;
  letter-spacing: 1px;
  color: #0f172a;
}

.number-amount {
  font-size: 18px;
  font-weight: 700;
  color: var(--success-text);
}

.unpaid-reminder {
  font-size: 12px;
  color: var(--warning-text);
  margin-bottom: 16px;
}

.receipt-footer {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  margin-top: 24px;
  padding-top: 16px;
  position: relative;
}

.footer-sign {
  display: flex;
  align-items: center;
  font-size: 13px;
  color: #334155;
}

.sign-underline {
  display: inline-block;
  width: 120px;
  border-bottom: 1px solid var(--text-muted);
  margin-left: 6px;
}

.stamp-box {
  position: absolute;
  right: 20px;
  bottom: -10px;
  pointer-events: none;
}

.stamp-circle {
  width: 90px;
  height: 90px;
  border: 2px dashed var(--error-text);
  border-radius: 50%;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  color: var(--error-text);
  transform: rotate(-15deg);
  opacity: 0.85;
}

.stamp-circle span {
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 1px;
}

.stamp-circle small {
  font-size: 9px;
  margin-top: 2px;
}

.dialog-action-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
}

.print-tip {
  font-size: 12px;
  color: var(--text-muted);
}

@media print {
  body * {
    visibility: hidden;
  }
  #printable-receipt,
  #printable-receipt * {
    visibility: visible;
  }
  #printable-receipt {
    position: absolute;
    left: 0;
    top: 0;
    width: 100%;
    box-shadow: none;
    padding: 0;
  }
}
</style>
