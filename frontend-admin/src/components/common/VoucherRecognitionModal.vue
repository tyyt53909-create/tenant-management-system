<template>
  <el-dialog
    v-model="visible"
    title="单据识别入账"
    width="680px"
    destroy-on-close
    append-to-body
    class="voucher-dialog-wrapper"
  >
    <div class="voucher-modal-body">
      <!-- 顶部快捷提示与粘贴区 -->
      <div v-if="!paymentSuccess" class="paste-zone" :class="{ 'is-loading': loading }" @paste="handlePaste">
        <div class="paste-zone-header">
          <div class="zone-title">
            <el-icon><Ticket /></el-icon>
            <span>粘贴租客缴费单据或核销码</span>
          </div>
          <span class="zone-kbd-tip">支持快捷键 <b>⌘ V</b> / <b>Ctrl V</b> 直接粘贴</span>
        </div>

        <el-input
          v-model="rawInput"
          type="textarea"
          :rows="3"
          placeholder="可在此粘贴租客微信发来的单据文本、包含 [VOUCHER:xxx] 的核销码，或直接输入账单编号 (如 BILL-20261015-XXX)..."
          resize="none"
          @keydown.enter.ctrl.prevent="triggerRecognize"
          @keydown.enter.meta.prevent="triggerRecognize"
        />

        <div class="paste-actions">
          <span class="paste-hint">提示：在微信收到租客缴费单据后，复制单据文本并在此粘贴即可秒级匹配</span>
          <el-button type="primary" :loading="loading" :disabled="!rawInput.trim()" @click="triggerRecognize">
            <el-icon><Search /></el-icon> 立即识别
          </el-button>
        </div>
      </div>

      <!-- 识别加载骨架 -->
      <div v-if="loading" class="result-loading-box">
        <el-skeleton :rows="4" animated />
      </div>

      <!-- 识别错误提示 -->
      <el-alert
        v-if="errorMessage && !loading"
        :title="errorMessage"
        type="error"
        show-icon
        :closable="false"
        style="margin-top: 16px"
      >
        <template #default>
          <div style="font-size: 12px; margin-top: 4px; line-height: 1.6">
            未能识别到账单。请检查文本中是否包含类似 <code>BILL-20261015-XXX</code> 的账单号或 <code>[VOUCHER:账单号:金额]</code> 标签。如租客发送的是图片，请在微信中长按图片提取文字，或让租客在小程序账单详情中点击「复制单据文本」。
          </div>
        </template>
      </el-alert>

      <!-- 识别成功匹配结果卡片 -->
      <VoucherMatchCard
        v-if="result && !loading && !paymentSuccess"
        :result="result"
        :payment-form="paymentForm"
        @open-receipt="openReceipt"
      />

      <!-- 入账成功完成界面 -->
      <div v-if="paymentSuccess" class="payment-success-card">
        <div class="success-icon-wrap">
          <el-icon :size="48" color="#52c41a"><CircleCheckFilled /></el-icon>
        </div>
        <h3>收款入账成功！</h3>
        <p class="success-desc">
          已成功录入收款 <b>¥{{ paymentAmountLabel }}</b> 元，系统已实时更新账单状态并生成电子收据。
        </p>

        <div class="success-actions">
          <el-button type="primary" @click="openReceipt(lastSettledBillId)">
            <el-icon><Document /></el-icon> 查看 / 打印电子收据
          </el-button>
          <el-button @click="resetForNext">
            <el-icon><Refresh /></el-icon> 继续识别下一笔单据
          </el-button>
          <el-button @click="visible = false">完成并关闭</el-button>
        </div>
      </div>
    </div>

    <!-- 底部操作栏 -->
    <template #footer>
      <div class="dialog-footer-content">
        <span class="left-tips">
          <el-icon><QuestionFilled /></el-icon>
          租客可在微信小程序账单详情页一键生成凭单并复制核销码
        </span>
        <div class="right-buttons">
          <el-button @click="visible = false">关闭</el-button>
          <el-button
            v-if="result && !result.isPaid && !result.isCancelled && !paymentSuccess"
            type="primary"
            :loading="submitting"
            @click="handleConfirmPayment"
          >
            确认收款入账 ¥{{ paymentAmountLabel }}
          </el-button>
        </div>
      </div>
    </template>

    <!-- 嵌套打印电子收据 -->
    <ReceiptModal v-model="receiptVisible" :bill-id="receiptBillId" />
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch, reactive } from 'vue';
import { ElMessage } from 'element-plus';
import {
  Ticket,
  Search,
  CircleCheckFilled,
  QuestionFilled,
  Document,
  Refresh,
} from '@element-plus/icons-vue';
import {
  recognizeVoucher,
  addPayment,
  type RecognizeVoucherResult,
  type PaymentMethod,
} from '@/api/bills';
import ReceiptModal from '@/components/common/ReceiptModal.vue';
import VoucherMatchCard from './voucher/VoucherMatchCard.vue';
import { notifyApiError } from '@/utils/notify';
import { apiErrorMessage } from '@/utils/apiError';

const props = defineProps<{
  modelValue: boolean;
  initialText?: string;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', val: boolean): void;
  (e: 'settled', payload: { billId: string; amount: number }): void;
}>();

const visible = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val),
});

const rawInput = ref('');
const loading = ref(false);
const submitting = ref(false);
const errorMessage = ref('');
const result = ref<RecognizeVoucherResult | null>(null);

const paymentSuccess = ref(false);
const lastSettledBillId = ref('');

const receiptVisible = ref(false);
const receiptBillId = ref('');

const paymentForm = reactive({
  amount: 0,
  paymentMethod: 'WECHAT' as PaymentMethod,
  transactionNumber: '',
  notes: '微信缴费单据核销入账',
  idempotencyKey: '',
});

// 监听打开并支持传入初始文本
watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      paymentSuccess.value = false;
      errorMessage.value = '';
      if (props.initialText) {
        rawInput.value = props.initialText;
        void triggerRecognize();
      }
    } else {
      resetState();
    }
  },
  { immediate: true },
);

function resetState() {
  rawInput.value = '';
  result.value = null;
  errorMessage.value = '';
  paymentSuccess.value = false;
  lastSettledBillId.value = '';
}

function resetForNext() {
  resetState();
}

// 默认实收不超过当前可收金额。旧单据上的原账单金额不能直接填进收款框。
function defaultPaymentAmount(data: RecognizeVoucherResult) {
  const suggested = Number(data.suggestedAmountYuan);
  const extracted = data.extractedAmountYuan == null ? Number.NaN : Number(data.extractedAmountYuan);
  const suggestedOk = Number.isFinite(suggested) && suggested > 0;
  if (Number.isFinite(extracted) && extracted > 0 && (!suggestedOk || extracted <= suggested)) {
    return extracted;
  }
  return suggestedOk ? suggested : 0;
}

// 粘贴事件监听处理（剪贴板支持提取文本或检测图片）
function handlePaste(e: ClipboardEvent) {
  const clipboardData = e.clipboardData;
  if (!clipboardData) return;

  const text = clipboardData.getData('text/plain');
  if (text && text.trim()) {
    rawInput.value = text.trim();
    setTimeout(() => {
      void triggerRecognize();
    }, 50);
    return;
  }

  const items = clipboardData.items;
  let hasImage = false;
  for (let i = 0; i < items.length; i++) {
    if (items[i].type.startsWith('image/')) {
      hasImage = true;
      break;
    }
  }

  if (hasImage) {
    ElMessage.info('检测到剪贴板包含单据图片。请在微信中长按图片提取文字并复制，或直接粘贴单据右下角的账单号');
  }
}

// 触发识别
async function triggerRecognize() {
  const query = rawInput.value.trim();
  if (!query) return;

  loading.value = true;
  errorMessage.value = '';
  result.value = null;

  try {
    const data = await recognizeVoucher({ text: query });
    result.value = data;
    paymentForm.amount = defaultPaymentAmount(data);

    if (data.isPaid) {
      ElMessage.warning('该账单已完成全部款项缴纳，不可重复收款');
    } else {
      ElMessage.success('成功识别单据，已匹配对应账单！');
    }
  } catch (err: any) {
    errorMessage.value = apiErrorMessage(err, '未能识别到账单编号或有效核销码');
  } finally {
    loading.value = false;
  }
}

const paymentAmountLabel = computed(() => Number(paymentForm.amount || 0).toFixed(2));

// 确认收款
async function handleConfirmPayment() {
  if (!result.value) return;

  if (paymentForm.amount <= 0) {
    ElMessage.warning('收款金额必须大于 0 元');
    return;
  }

  const amountCents = Math.round(paymentForm.amount * 100);
  submitting.value = true;
  if (!paymentForm.idempotencyKey) paymentForm.idempotencyKey = crypto.randomUUID();

  try {
    await addPayment(result.value.billId, {
      amount: amountCents,
      paymentMethod: paymentForm.paymentMethod,
      transactionNumber: paymentForm.transactionNumber || undefined,
      notes: paymentForm.notes || undefined,
      idempotencyKey: paymentForm.idempotencyKey,
    });

    ElMessage.success('收款入账成功！');
    lastSettledBillId.value = result.value.billId;
    paymentSuccess.value = true;
    emit('settled', { billId: result.value.billId, amount: amountCents });
  } catch (err: any) {
    notifyApiError(err, '收款入账失败，请检查后重试');
  } finally {
    submitting.value = false;
  }
}

function openReceipt(billId: string) {
  if (!billId) return;
  receiptBillId.value = billId;
  receiptVisible.value = true;
}

defineExpose({
  openWithText: (text: string) => {
    visible.value = true;
    rawInput.value = text;
    void triggerRecognize();
  },
});
</script>

<style scoped>
.voucher-modal-body {
  padding: 4px 0;
}

.paste-zone {
  border: 2px dashed #dcdfe6;
  background: #fafaf9;
  border-radius: 10px;
  padding: 16px;
  transition: all 0.2s ease;
}

.paste-zone:focus-within,
.paste-zone:hover {
  border-color: #3b5a45;
  background: #fdfdfc;
}

.paste-zone-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.zone-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  font-size: 14px;
  color: #2c3e50;
}

.zone-kbd-tip {
  font-size: 11px;
  color: var(--text-muted);
}

.zone-kbd-tip b {
  display: inline-block;
  padding: 1px 6px;
  border-radius: 4px;
  background: #eef0ea;
  color: #333;
  font-family: inherit;
}

.paste-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 10px;
}

.paste-hint {
  font-size: 12px;
  color: var(--text-muted);
}

.result-loading-box {
  margin-top: 16px;
  padding: 16px;
  background: #fff;
  border: 1px solid #ebeef5;
  border-radius: 8px;
}

.payment-success-card {
  padding: 36px 20px;
  text-align: center;
}

.success-icon-wrap {
  margin-bottom: 12px;
}

.payment-success-card h3 {
  font-size: 20px;
  margin: 0 0 8px;
  color: #2c3e50;
}

.success-desc {
  font-size: 14px;
  color: #595959;
  margin-bottom: 24px;
}

.success-actions {
  display: flex;
  justify-content: center;
  gap: 12px;
}

.dialog-footer-content {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
}

.left-tips {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-muted);
}

.right-buttons {
  display: flex;
  gap: 10px;
}
</style>
