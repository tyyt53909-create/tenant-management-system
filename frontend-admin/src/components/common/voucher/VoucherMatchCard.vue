<template>
  <div class="voucher-match-card">
    <div class="match-card-head">
      <div class="match-room-tag">
        <el-icon><House /></el-icon>
        <strong>{{ result.room.buildingName }} {{ result.room.roomNumber }}</strong>
        <span class="match-tenant-name">{{ result.tenant.name }} ({{ result.tenant.phone }})</span>
      </div>
      <el-tag :type="result.isPaid ? 'success' : result.isCancelled ? 'info' : 'warning'">
        {{ result.isPaid ? '已缴清' : result.isCancelled ? '已取消' : '待入账' }}
      </el-tag>
    </div>

    <!-- 金额匹配检验状态栏 -->
    <div class="match-status-banner" :class="bannerClass">
      <el-icon v-if="result.amountMatchStatus === 'MATCHED' && !principalOnlyMatch"><CircleCheck /></el-icon>
      <el-icon v-else-if="result.amountMatchStatus === 'MISMATCH' || principalOnlyMatch"><Warning /></el-icon>
      <el-icon v-else><InfoFilled /></el-icon>
      <div class="banner-text">
        <strong>{{ bannerTitle }}</strong>
        <span>{{ bannerDesc }}</span>
      </div>
    </div>

    <!-- 账单明细网格 -->
    <div class="bill-meta-grid">
      <div class="meta-col">
        <span class="lbl">账单编号</span>
        <span class="val font-mono">{{ result.billNumber }}</span>
      </div>
      <div class="meta-col">
        <span class="lbl">账单类型</span>
        <span class="val">{{ result.billTypeLabel }} ({{ result.period }})</span>
      </div>
      <div class="meta-col">
        <span class="lbl">到期日期</span>
        <span class="val">{{ result.dueDate ? String(result.dueDate).slice(0, 10) : '—' }}</span>
      </div>
      <div class="meta-col">
        <span class="lbl">账单应缴本金</span>
        <span class="val">¥{{ result.amountYuan }}</span>
      </div>
      <div class="meta-col">
        <span class="lbl">已缴本金</span>
        <span class="val text-success">¥{{ result.paidAmountYuan }}</span>
      </div>
      <div class="meta-col highlight">
        <span class="lbl">当前待收合计</span>
        <span class="val price">¥{{ result.suggestedAmountYuan }}</span>
      </div>
    </div>

    <!-- 如果账单已缴清或取消 -->
    <div v-if="result.isPaid" class="settled-notice">
      <el-icon :size="24" color="#52c41a"><CircleCheckFilled /></el-icon>
      <div>
        <strong>该账单已全部结清</strong>
        <p>已全额缴齐，无需重复收款入账。您可直接查看或打印已开具的电子收款凭单。</p>
      </div>
      <el-button type="primary" plain @click="$emit('openReceipt', result.billId)">查看电子收据</el-button>
    </div>

    <div v-else-if="result.isCancelled" class="settled-notice is-cancelled">
      <el-icon :size="24" color="var(--text-muted)"><InfoFilled /></el-icon>
      <div>
        <strong>该账单已被取消</strong>
        <p>此账单已被作废或取消，不可进行收款入账操作。</p>
      </div>
    </div>

    <!-- 收款录入表单 -->
    <div v-else class="payment-action-form">
      <div class="form-section-title">
        <span>确认收款信息并入账</span>
        <small>收款将自动冲抵未缴本金，若有滞纳金将按规则结算</small>
      </div>

      <el-form label-width="84px" size="default">
        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="本次实收" required>
              <el-input-number
                v-model="paymentForm.amount"
                :min="0.01"
                :max="Number(result.suggestedAmountYuan)"
                :precision="2"
                :step="100"
                style="width: 100%"
              />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="收款方式" required>
              <el-select v-model="paymentForm.paymentMethod" style="width: 100%">
                <el-option label="微信转账 / 扫码" value="WECHAT" />
                <el-option label="支付宝" value="ALIPAY" />
                <el-option label="银行转账" value="BANK_TRANSFER" />
                <el-option label="现金收款" value="CASH" />
                <el-option label="其他方式" value="OTHER" />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>

        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="交易流水">
              <el-input
                v-model="paymentForm.transactionNumber"
                placeholder="微信转账单号 / 凭证号 (选填)"
                clearable
              />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="入账备注">
              <el-input
                v-model="paymentForm.notes"
                placeholder="如：租客微信发送单据自动识别"
                clearable
              />
            </el-form-item>
          </el-col>
        </el-row>
      </el-form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import {
  House,
  CircleCheck,
  CircleCheckFilled,
  Warning,
  InfoFilled,
} from '@element-plus/icons-vue';
import type { RecognizeVoucherResult, PaymentMethod } from '@/api/bills';

const props = defineProps<{
  result: RecognizeVoucherResult;
  paymentForm: {
    amount: number;
    paymentMethod: PaymentMethod;
    transactionNumber: string;
    notes: string;
  };
}>();

defineEmits<{
  (e: 'openReceipt', billId: string): void;
}>();

const principalOnlyMatch = computed(() => {
  if (!props.result || props.result.amountMatchStatus !== 'MATCHED') return false;
  return (
    props.result.outstandingLateFees > 0 &&
    props.result.extractedAmountCents !== props.result.suggestedAmount
  );
});

const bannerClass = computed(() => {
  if (!props.result) return '';
  if (props.result.amountMatchStatus === 'MATCHED') {
    return principalOnlyMatch.value ? 'banner-mismatch' : 'banner-matched';
  }
  if (props.result.amountMatchStatus === 'MISMATCH') return 'banner-mismatch';
  return 'banner-info';
});

const bannerTitle = computed(() => {
  if (!props.result) return '';
  if (props.result.amountMatchStatus === 'MATCHED') {
    return principalOnlyMatch.value
      ? '单据金额与未缴本金一致，仍有滞纳金'
      : '单据金额与当前待收一致';
  }
  if (props.result.amountMatchStatus === 'MISMATCH') return '注意：单据金额与当前应收不一致';
  return '单据核销信息已匹配';
});

const bannerDesc = computed(() => {
  if (!props.result) return '';
  if (props.result.amountMatchStatus === 'MATCHED' && principalOnlyMatch.value) {
    return `单据金额 ¥${props.result.extractedAmountYuan} 等于未缴本金 ¥${props.result.unpaidAmountYuan}，另有未结滞纳金 ¥${props.result.outstandingLateFeesYuan}。当前待收合计 ¥${props.result.suggestedAmountYuan}。`;
  }
  if (props.result.amountMatchStatus === 'MATCHED') {
    return `单据提取金额 ¥${props.result.extractedAmountYuan}，当前待收合计 ¥${props.result.suggestedAmountYuan}，可直接确认入账。`;
  }
  if (props.result.amountMatchStatus === 'MISMATCH') {
    return `单据注明金额 ¥${props.result.extractedAmountYuan}，而当前系统待收合计为 ¥${props.result.suggestedAmountYuan}，请核实是否为部分缴款或包含其他款项。`;
  }
  return `请核对以下账单与租客信息后确认入账。`;
});
</script>

<style scoped>
.voucher-match-card {
  margin-top: 18px;
  border: 1px solid #e2ded5;
  border-radius: 10px;
  background: #fff;
  overflow: hidden;
}

.match-card-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 14px 18px;
  background: #f7f6f2;
  border-bottom: 1px solid #e8e5dc;
}

.match-room-tag {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
}

.match-tenant-name {
  font-size: 13px;
  color: #666;
  margin-left: 6px;
}

.match-status-banner {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px 18px;
  font-size: 13px;
  border-bottom: 1px solid #eee;
}

.banner-matched {
  background: #f6ffed;
  color: var(--success-text);
  border-bottom-color: #b7eb8f;
}

.banner-mismatch {
  background: #fffbe6;
  color: var(--warning-text);
  border-bottom-color: #ffe58f;
}

.banner-info {
  background: #e6f7ff;
  color: #096dd9;
  border-bottom-color: #91d5ff;
}

.banner-text strong {
  display: block;
  font-size: 13px;
  margin-bottom: 2px;
}

.banner-text span {
  font-size: 12px;
  opacity: 0.9;
}

.bill-meta-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  padding: 16px 18px;
  background: #fff;
}

.meta-col {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.meta-col .lbl {
  font-size: 11px;
  color: var(--text-muted);
}

.meta-col .val {
  font-size: 13px;
  color: #2c3e50;
  font-weight: 500;
}

.meta-col.highlight .price {
  font-size: 17px;
  font-weight: 700;
  color: #c05621;
}

.text-success {
  color: var(--success-text) !important;
}

.font-mono {
  font-family: monospace;
}

.settled-notice {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 16px 18px;
  background: #f6ffed;
  border-top: 1px solid #d9f7be;
}

.settled-notice.is-cancelled {
  background: #f5f5f5;
  border-top: 1px solid #d9d9d9;
}

.settled-notice strong {
  display: block;
  font-size: 14px;
  margin-bottom: 4px;
}

.settled-notice p {
  margin: 0;
  font-size: 12px;
  color: #666;
}

.payment-action-form {
  padding: 16px 18px;
  background: #faf9f6;
  border-top: 1px solid #e8e5dc;
}

.form-section-title {
  margin-bottom: 12px;
}

.form-section-title span {
  font-weight: 600;
  font-size: 13px;
  color: #2c3e50;
}

.form-section-title small {
  margin-left: 8px;
  font-size: 11px;
  color: var(--text-muted);
}
</style>
