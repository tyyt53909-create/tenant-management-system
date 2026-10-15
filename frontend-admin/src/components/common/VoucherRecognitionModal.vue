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
      <div v-if="result && !loading && !paymentSuccess" class="voucher-match-card">
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
          <el-button type="primary" plain @click="openReceipt(result.billId)">查看电子收据</el-button>
        </div>

        <div v-else-if="result.isCancelled" class="settled-notice is-cancelled">
          <el-icon :size="24" color="#909399"><InfoFilled /></el-icon>
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
  House,
  CircleCheck,
  CircleCheckFilled,
  Warning,
  InfoFilled,
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
    // 延迟一个微任务执行识别
    setTimeout(() => {
      void triggerRecognize();
    }, 50);
    return;
  }

  // 若粘贴的是图片
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
    errorMessage.value = err?.message || '未能识别到账单编号或有效核销码';
  } finally {
    loading.value = false;
  }
}

// 状态横幅计算
const bannerClass = computed(() => {
  if (!result.value) return '';
  if (result.value.amountMatchStatus === 'MATCHED') {
    return principalOnlyMatch.value ? 'banner-mismatch' : 'banner-matched';
  }
  if (result.value.amountMatchStatus === 'MISMATCH') return 'banner-mismatch';
  return 'banner-info';
});

const principalOnlyMatch = computed(() => {
  if (!result.value || result.value.amountMatchStatus !== 'MATCHED') return false;
  return (
    result.value.outstandingLateFees > 0 &&
    result.value.extractedAmountCents !== result.value.suggestedAmount
  );
});

const paymentAmountLabel = computed(() => Number(paymentForm.amount || 0).toFixed(2));

const bannerTitle = computed(() => {
  if (!result.value) return '';
  if (result.value.amountMatchStatus === 'MATCHED') {
    return principalOnlyMatch.value
      ? '单据金额与未缴本金一致，仍有滞纳金'
      : '单据金额与当前待收一致';
  }
  if (result.value.amountMatchStatus === 'MISMATCH') return '注意：单据金额与当前应收不一致';
  return '单据核销信息已匹配';
});

const bannerDesc = computed(() => {
  if (!result.value) return '';
  if (result.value.amountMatchStatus === 'MATCHED' && principalOnlyMatch.value) {
    return `单据金额 ¥${result.value.extractedAmountYuan} 等于未缴本金 ¥${result.value.unpaidAmountYuan}，另有未结滞纳金 ¥${result.value.outstandingLateFeesYuan}。当前待收合计 ¥${result.value.suggestedAmountYuan}。`;
  }
  if (result.value.amountMatchStatus === 'MATCHED') {
    return `单据提取金额 ¥${result.value.extractedAmountYuan}，当前待收合计 ¥${result.value.suggestedAmountYuan}，可直接确认入账。`;
  }
  if (result.value.amountMatchStatus === 'MISMATCH') {
    return `单据注明金额 ¥${result.value.extractedAmountYuan}，而当前系统待收合计为 ¥${result.value.suggestedAmountYuan}，请核实是否为部分缴款或包含其他款项。`;
  }
  return `请核对以下账单与租客信息后确认入账。`;
});

// 确认收款
async function handleConfirmPayment() {
  if (!result.value) return;

  if (paymentForm.amount <= 0) {
    ElMessage.warning('收款金额必须大于 0 元');
    return;
  }

  const amountCents = Math.round(paymentForm.amount * 100);
  submitting.value = true;

  try {
    await addPayment(result.value.billId, {
      amount: amountCents,
      paymentMethod: paymentForm.paymentMethod,
      transactionNumber: paymentForm.transactionNumber || undefined,
      notes: paymentForm.notes || undefined,
    });

    ElMessage.success('收款入账成功！');
    lastSettledBillId.value = result.value.billId;
    paymentSuccess.value = true;
    emit('settled', { billId: result.value.billId, amount: amountCents });
  } catch (err: any) {
    ElMessage.error(err?.message || '收款入账失败，请检查后重试');
  } finally {
    submitting.value = false;
  }
}

function openReceipt(billId: string) {
  if (!billId) return;
  receiptBillId.value = billId;
  receiptVisible.value = true;
}

// 暴露对外调用方法，允许父组件直接调用并传入识别文本
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
  color: #8c8983;
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
  color: #8c8c8c;
}

.result-loading-box {
  margin-top: 16px;
  padding: 16px;
  background: #fff;
  border: 1px solid #ebeef5;
  border-radius: 8px;
}

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
  color: #389e0d;
  border-bottom-color: #b7eb8f;
}

.banner-mismatch {
  background: #fffbe6;
  color: #d46b08;
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
  color: #8c8983;
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
  color: #389e0d !important;
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
  color: #8c8983;
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
  color: #8c8983;
}

.right-buttons {
  display: flex;
  gap: 10px;
}
</style>
