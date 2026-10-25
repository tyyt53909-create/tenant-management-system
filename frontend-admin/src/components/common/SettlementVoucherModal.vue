<template>
  <el-dialog
    v-model="visible"
    title="电子退租结算清算单"
    width="780px"
    destroy-on-close
    append-to-body
    class="voucher-dialog-wrapper"
  >
    <div v-loading="loading" class="voucher-content-box">
      <div v-if="voucher" id="printable-voucher" class="voucher-paper">
        <!-- 单据抬头 -->
        <div class="voucher-header">
          <div class="header-main">退租交接与押金结算单</div>
          <div class="header-sub">CHECKOUT & DEPOSIT SETTLEMENT STATEMENT</div>
        </div>

        <!-- 基本信息 -->
        <div class="voucher-meta-grid">
          <div class="meta-item">
            <span class="meta-label">单据编号：</span>
            <span class="meta-value">{{ voucher.voucherNumber }}</span>
          </div>
          <div class="meta-item">
            <span class="meta-label">退租交接日：</span>
            <span class="meta-value">{{ voucher.checkoutDate }}</span>
          </div>
          <div class="meta-item">
            <span class="meta-label">租客姓名：</span>
            <span class="meta-value"><b>{{ voucher.tenantName }}</b> ({{ voucher.tenantPhone || '无电话' }})</span>
          </div>
          <div class="meta-item">
            <span class="meta-label">退租房屋：</span>
            <span class="meta-value"><b>{{ voucher.buildingName }} {{ voucher.roomNumber }}</b></span>
          </div>
          <div class="meta-item">
            <span class="meta-label">原合同租期：</span>
            <span class="meta-value">{{ voucher.contractStart }} ~ {{ voucher.contractEnd }}</span>
          </div>
          <div class="meta-item">
            <span class="meta-label">原始押金：</span>
            <span class="meta-value">{{ formatMoney(voucher.depositAmount) }}</span>
          </div>
        </div>

        <!-- 结算扣除与清算明细表格 -->
        <table class="voucher-table">
          <thead>
            <tr>
              <th style="width: 140px">款项类型</th>
              <th>说明与依据</th>
              <th style="width: 130px; text-align: right">结算金额</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><b>押金基数</b></td>
              <td>原租赁合同履约保证金退还基数</td>
              <td style="text-align: right; color: var(--success-text)">
                +{{ formatMoney(voucher.depositAmount) }}
              </td>
            </tr>
            <tr v-for="item in voucher.items" :key="item.id">
              <td>
                <el-tag size="small" :type="isDeduction(item.itemType) ? 'danger' : 'success'">
                  {{ itemTypeMap[item.itemType] || item.itemType }}
                </el-tag>
              </td>
              <td>
                {{ item.description }}
                <small v-if="item.adjustReason" style="color: #64748b">（调整原因: {{ item.adjustReason }}）</small>
              </td>
              <td
                style="text-align: right"
                :class="isDeduction(item.itemType) ? 'text-deduction' : 'text-refund'"
              >
                {{ isDeduction(item.itemType) ? '-' : '+' }}{{ formatMoney(item.amount) }}
              </td>
            </tr>
            <tr v-if="!voucher.items || voucher.items.length === 0">
              <td colspan="3" style="text-align: center; color: var(--text-muted)">无额外扣款或补偿项</td>
            </tr>
          </tbody>
        </table>

        <!-- 汇总核算条 -->
        <div class="voucher-total-bar">
          <div class="chinese-total">
            <span class="total-label">清算净额大写：</span>
            <span class="chinese-amount"><b>{{ voucher.netRefundInChinese }}</b></span>
          </div>
          <div class="number-total">
            <span class="total-label">实退还租客净额：</span>
            <span class="number-amount">{{ formatMoney(voucher.netRefund) }}</span>
          </div>
        </div>

        <div v-if="voucher.notes" class="voucher-notes">
          <b>交接备注：</b>{{ voucher.notes }}
        </div>

        <!-- 底部签章确认 -->
        <div class="voucher-footer">
          <div class="footer-sign">
            <span>退租人确认签字：</span>
            <span class="sign-underline"></span>
          </div>
          <div class="footer-sign">
            <span>经办管家签字：</span>
            <span class="sign-underline"></span>
          </div>
          <div class="stamp-box">
            <div class="stamp-circle">
              <span>退租清算</span>
              <small>{{ voucher.buildingName || '物业管理' }}</small>
            </div>
          </div>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="dialog-action-bar">
        <span class="print-tip">打印时已自动优化为标准 A4 / 单据排版</span>
        <div>
          <el-button @click="visible = false">关闭</el-button>
          <el-button type="primary" :disabled="!voucher" @click="handlePrint">
            打印结算单
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
  checkoutId: string;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', val: boolean): void;
}>();

const visible = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val),
});

const loading = ref(false);
const voucher = ref<any>(null);

// T207：与后端 CheckoutItemType 严格对齐（原先这四类扣款名在枚举里都不存在，
// 导致标签退化成原始枚举名、且扣款被显示成 "+¥"）
const itemTypeMap: Record<string, string> = {
  DEPOSIT_DEDUCTION: '押金扣除',
  OTHER_FEE: '其他费用',
  RENT_REFUND: '租金退还',
  DEPOSIT_REFUND: '押金退还',
  UTILITY_REFUND: '水电余额退还',
  OTHER_REFUND: '其他退款',
};

function isDeduction(type: string): boolean {
  return type === 'DEPOSIT_DEDUCTION' || type === 'OTHER_FEE';
}

async function fetchVoucher() {
  if (!props.checkoutId) return;
  loading.value = true;
  try {
    const data = await request.get(`/checkout/${props.checkoutId}/voucher`);
    voucher.value = data;
  } catch (err: any) {
    notifyApiError(err, '获取退租结算凭单失败');
  } finally {
    loading.value = false;
  }
}

watch(visible, (val) => {
  if (val) {
    fetchVoucher();
  } else {
    voucher.value = null;
  }
});

function handlePrint() {
  window.print();
}
</script>

<style scoped>
.voucher-content-box {
  background-color: #f1f5f9;
  padding: 16px;
  border-radius: 6px;
}

.voucher-paper {
  background-color: #ffffff;
  padding: 28px 34px;
  border-radius: 4px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.06);
  position: relative;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang SC', sans-serif;
  color: #1e293b;
}

.voucher-header {
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

.voucher-meta-grid {
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

.voucher-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
  margin-bottom: 14px;
}

.voucher-table th,
.voucher-table td {
  border: 1px solid #cbd5e1;
  padding: 8px 10px;
}

.voucher-table th {
  background-color: #f8fafc;
  color: #475569;
  font-weight: 600;
}

.text-deduction {
  color: var(--error-text);
  font-weight: 600;
}

.text-refund {
  color: var(--success-text);
  font-weight: 600;
}

.voucher-total-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border: 1px solid #cbd5e1;
  padding: 10px 14px;
  background-color: #f8fafc;
  margin-bottom: 12px;
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

.voucher-notes {
  font-size: 12px;
  color: #64748b;
  margin-bottom: 16px;
}

.voucher-footer {
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
  #printable-voucher,
  #printable-voucher * {
    visibility: visible;
  }
  #printable-voucher {
    position: absolute;
    left: 0;
    top: 0;
    width: 100%;
    box-shadow: none;
    padding: 0;
  }
}
</style>
