<template>
  <section class="posting-section" aria-label="正式水电计费">
    <h3>正式水电计费</h3>
    <p>预览仅核对资料。确认后按已核验的收款模式产生费用及相应凭证。</p>
    <el-alert v-if="pending" type="warning" :closable="false" title="上次计费结果待核对，请用原请求重试。">
      <el-button :loading="busy" @click="submitPending">重试上次计费</el-button>
    </el-alert>
    <el-button :loading="busy" @click="preview">预览正式费用</el-button>
    <template v-if="review">
      <el-alert v-if="review.settlementBlock" type="warning" :closable="false" :title="review.settlementBlock.reason" :description="review.settlementBlock.retryCondition" />
      <p v-else-if="review.alreadySettled || !review.hasReadings">暂无新增可结算用量</p>
      <template v-else>
        <dl class="posting-amounts">
          <div><dt>收款模式</dt><dd>{{ review.collectionMode ? modeLabel[review.collectionMode] : '房东空置期' }}</dd></div>
          <div><dt>本次费用</dt><dd>{{ formatMoney(review.estimatedAmount) }}</dd></div>
          <div><dt>预付抵扣</dt><dd>{{ formatMoney(review.prepayApplied ?? 0) }}</dd></div>
          <div><dt>房东应收</dt><dd>{{ formatMoney(review.receivableAmount ?? 0) }}</dd></div>
          <div><dt>外部直缴参考</dt><dd>{{ formatMoney(review.providerAmount ?? 0) }}</dd></div>
        </dl>
        <el-button type="primary" :loading="busy" :disabled="!review.reviewToken || !!pending" @click="confirm">确认正式计费</el-button>
      </template>
    </template>
    <p v-if="result" role="status">费用已处理 · {{ result.chargeId ? `凭证 ${result.chargeId}` : result.reason || '无新增费用' }}</p>
  </section>
</template>
<script setup lang="ts">
import { ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { previewUtilityCharge, confirmUtilityCharge, type UnsettledUsage, type UtilityChargeCommand, type MeterSettleResult } from '@/api/meters';
import { formatMoney } from '@/utils/money';
import { parseApiError } from '@/utils/apiError';
import { notifyApiError } from '@/utils/notify';
import { ErrorCode } from '../../../../shared/src/error-codes';
const props = defineProps<{ meterId: string }>();
const emit = defineEmits<{ posted: [] }>();
const busy = ref(false);
const review = ref<UnsettledUsage>();
const result = ref<MeterSettleResult>();
const pending = ref<UtilityChargeCommand>();
const keyFor = (id: string) => `utility-posting-confirm:${id}`;
const modeLabel = { PREPAY_WITH_SHORTFALL: '预付不足补缴', POSTPAID: '后付全额应收', DIRECT_TO_PROVIDER: '租客直缴供应商' };
watch(() => props.meterId, (id) => {
  review.value = undefined; result.value = undefined; pending.value = undefined;
  const raw = sessionStorage.getItem(keyFor(id));
  if (raw) {
    try {
      const saved = JSON.parse(raw) as UtilityChargeCommand;
      if (saved.meterId === id && typeof saved.requestId === 'string' && typeof saved.reviewToken === 'string') pending.value = saved;
    } catch { sessionStorage.removeItem(keyFor(id)); }
  }
}, { immediate: true });
async function preview() {
  if (busy.value) return;
  const id = props.meterId;
  busy.value = true; review.value = undefined; result.value = undefined;
  try {
    const next = await previewUtilityCharge(id);
    if (id === props.meterId) review.value = next;
  } catch (error) { notifyApiError(error, '费用预览失败'); }
  finally { busy.value = false; }
}
async function confirm() {
  if (busy.value || !review.value?.reviewToken || review.value.settlementBlock) return;
  pending.value = { meterId: props.meterId, requestId: crypto.randomUUID(), reviewToken: review.value.reviewToken };
  sessionStorage.setItem(keyFor(props.meterId), JSON.stringify(pending.value));
  await submitPending();
}
async function submitPending() {
  if (busy.value || !pending.value) return;
  const command = pending.value;
  busy.value = true;
  try {
    const next = await confirmUtilityCharge(command);
    sessionStorage.removeItem(keyFor(command.meterId));
    if (props.meterId !== command.meterId) return;
    result.value = next; pending.value = undefined; review.value = undefined;
    ElMessage.success('费用及资金凭证已保存'); emit('posted');
  } catch (error) {
    const code = parseApiError(error).code;
    if (code === ErrorCode.PREVIEW_STALE || code === ErrorCode.UTILITY_RULE_BLOCKED) {
      sessionStorage.removeItem(keyFor(command.meterId));
      if (props.meterId === command.meterId) { pending.value = undefined; review.value = undefined; }
    }
    notifyApiError(error, '计费结果未确认，可重试原请求');
  } finally { busy.value = false; }
}
</script>
<style scoped>
.posting-section { margin-top: 24px; padding-top: 16px; border-top: 1px solid var(--border); }
.posting-section .el-alert { margin: 12px 0; }
.posting-amounts { display: grid; gap: 12px; }
.posting-amounts > div { display: flex; justify-content: space-between; gap: 16px; }
.posting-amounts dd { margin: 0; font-variant-numeric: tabular-nums; }
.posting-section [role="status"] { overflow-wrap: anywhere; }
</style>
