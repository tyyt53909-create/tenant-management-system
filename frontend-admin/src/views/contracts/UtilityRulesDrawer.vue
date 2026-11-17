<template>
  <el-drawer v-model="visible" title="水电规则与交接" size="min(100%, 660px)" append-to-body destroy-on-close>
    <el-skeleton v-if="loading" :rows="6" animated />
    <el-result v-else-if="loadError" icon="error" title="资料加载失败" :sub-title="loadError">
      <template #extra><el-button @click="load">重试加载</el-button></template>
    </el-result>
    <template v-else-if="data">
      <p>{{ data.contract.contractNumber }} · {{ data.contract.tenant.name }}</p>
      <el-alert type="info" :closable="false" title="金额为规则试算；确认保存规则与交接证据。正式费用接入将另行启用。" />
      <el-alert v-if="pending" class="review-section" type="warning" :closable="false" title="上次确认结果待核对，可重试原请求。">
        <el-button :loading="busy" @click="retryPending">重试上次确认</el-button>
      </el-alert>
      <el-empty v-if="!data.meters.length" description="该房间尚无启用表计" />
      <el-form v-else class="review-section" label-position="top" :disabled="busy" @submit.prevent="preview">
        <el-form-item label="表计">
          <el-select v-model="form.meterId" aria-label="表计" placeholder="选择表计">
            <el-option v-for="meter in data.meters" :key="meter.id" :value="meter.id" :label="`${meter.meterNumber} · ${typeLabel[meter.meterType] ?? meter.meterType}`" />
          </el-select>
        </el-form-item>
        <template v-if="selected">
          <el-alert v-for="item in selected.issues" :key="item.code" class="review-issue" type="warning" :closable="false" :title="item.message" />
          <p v-if="selected.policy">已确认第 {{ selected.policy.version }} 版 · {{ modeLabel[selected.policy.collectionMode] }} · {{ selected.policy.rateCents }} 分/单位</p>
          <el-form-item label="本段责任">
            <el-radio-group v-model="form.responsibility" aria-label="本段责任">
              <el-radio-button value="TENANT">本合同租客</el-radio-button>
              <el-radio-button value="OWNER">房东空置期</el-radio-button>
            </el-radio-group>
          </el-form-item>
          <div class="reading-fields">
            <el-form-item label="起点读数">
              <el-select v-model="form.openingReadingId" aria-label="起点读数" placeholder="选择真实起点" filterable>
                <el-option v-for="row in selected.readings" :key="row.id" :value="row.id" :label="readingLabel(row)" />
              </el-select>
            </el-form-item>
            <el-form-item label="终点读数">
              <el-select v-model="form.closingReadingId" aria-label="终点读数" placeholder="选择真实终点" filterable>
                <el-option v-for="row in selected.readings" :key="row.id" :value="row.id" :label="readingLabel(row)" />
              </el-select>
            </el-form-item>
          </div>
          <template v-if="form.responsibility === 'TENANT'">
            <el-form-item label="收款模式">
              <el-select v-model="form.collectionMode" aria-label="收款模式" placeholder="按租约明确选择">
                <el-option v-for="(label, value) in modeLabel" :key="value" :value="value" :label="label" />
              </el-select>
            </el-form-item>
            <el-form-item label="每单位费率（分，最多六位小数）">
              <el-input v-model="form.rateCents" aria-label="每单位费率（分）" inputmode="decimal" placeholder="例如 61.7 分 = 0.617 元" />
            </el-form-item>
          </template>
          <el-form-item label="核验依据与交接说明">
            <el-input v-model="form.evidence" aria-label="核验依据与交接说明" type="textarea" :rows="3" :maxlength="1000" placeholder="记录核对的租约条款、交接凭据及确认依据" />
          </el-form-item>
          <el-button native-type="submit" :loading="busy" :disabled="!complete">检查并预览</el-button>
        </template>
      </el-form>
      <section v-if="review" class="review-section" aria-label="规则预览">
        <el-alert v-for="item in [...review.blockingIssues, ...review.billingIssues]" :key="item.code" class="review-issue" type="warning" :closable="false" :title="item.message" />
        <dl class="amounts">
          <div><dt>本段用量</dt><dd>{{ review.financialPreview.usage ?? '待核验' }}</dd></div>
          <div><dt>费用试算</dt><dd>{{ amount(review.financialPreview.totalAmount) }}</dd></div>
          <div><dt>预计预付抵扣</dt><dd>{{ amount(review.financialPreview.prepayApplied) }}</dd></div>
          <div><dt>预计房东应收</dt><dd>{{ amount(review.financialPreview.receivableAmount) }}</dd></div>
          <div><dt>外部直缴参考</dt><dd>{{ amount(review.financialPreview.providerAmount) }}</dd></div>
        </dl>
        <el-button type="primary" :disabled="!review.ready" :loading="busy" @click="confirm">确认规则与责任</el-button>
      </section>
      <section v-if="selected?.responsibilityIntervals.length" class="review-section" aria-label="已确认责任段">
        <h3>已确认责任段</h3>
        <article v-for="row in selected.responsibilityIntervals" :key="row.id" class="confirmed-interval">
          <strong>{{ row.responsibility === 'OWNER' ? '房东空置期' : row.contractId === contractId ? '本合同租客' : '其他历史合同' }}</strong>
          <p>{{ time(row.startAt) }} 至 {{ time(row.endAt) }}</p>
          <p>{{ row.evidence }}</p>
        </article>
      </section>
    </template>
  </el-drawer>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import {
  confirmUtilityRule, getUtilityReadiness, previewUtilityRule,
  type CollectionMode, type RuleConfirmation, type RuleReview, type UtilityReadiness, type UtilityRulePreview,
} from '@/api/utilityReadiness';
import { formatMoney } from '@/utils/money';
import { apiErrorMessage, parseApiError } from '@/utils/apiError';
import { ErrorCode } from '../../../../shared/src/error-codes';
import { notifyApiError } from '@/utils/notify';

const visible = defineModel<boolean>({ default: false });
const props = defineProps<{ contractId: string }>();
const data = ref<UtilityReadiness>();
const loading = ref(false);
const loadError = ref('');
const busy = ref(false);
const review = ref<UtilityRulePreview>();
const pending = ref<RuleConfirmation>();
let loadSequence = 0;
const form = reactive({ meterId: '', responsibility: 'TENANT' as 'TENANT' | 'OWNER', openingReadingId: '', closingReadingId: '', collectionMode: '' as CollectionMode | '', rateCents: '', evidence: '' });
const selected = computed(() => data.value?.meters.find((meter) => meter.id === form.meterId));
const modeLabel = { PREPAY_WITH_SHORTFALL: '预付余额抵扣，不足补缴', POSTPAID: '后付，由房东收取', DIRECT_TO_PROVIDER: '租客直接缴给供应商' };
const typeLabel: Record<string, string> = { WATER: '水表', ELECTRICITY: '电表', GAS: '燃气表' };
const complete = computed(() => Boolean(form.meterId && form.openingReadingId && form.closingReadingId && form.evidence.trim()
  && (form.responsibility === 'OWNER' || (form.collectionMode && /^(0|[1-9]\d{0,9})(\.\d{1,6})?$/.test(form.rateCents)))));
const storageKey = () => `utility-rule-confirm:${props.contractId}`;
const time = (value: string) => new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
const readingLabel = (row: { readingTime: string; currentReading: string }) => `${row.currentReading} · ${time(row.readingTime)}`;
const amount = (value: number | null) => value === null ? '待核验' : formatMoney(value);

watch(form, () => { review.value = undefined; });
watch(() => form.meterId, () => { form.openingReadingId = ''; form.closingReadingId = ''; });
watch([visible, () => props.contractId], async ([open]) => {
  if (!open || !props.contractId) return;
  review.value = undefined;
  pending.value = undefined;
  Object.assign(form, { meterId: '', responsibility: 'TENANT', openingReadingId: '', closingReadingId: '', collectionMode: '', rateCents: '', evidence: '' });
  const raw = sessionStorage.getItem(storageKey());
  if (raw) {
    try {
      const saved = JSON.parse(raw) as RuleConfirmation;
      if (typeof saved.requestId === 'string' && typeof saved.reviewToken === 'string') pending.value = saved;
    } catch { sessionStorage.removeItem(storageKey()); }
  }
  await load();
});

async function load() {
  const sequence = ++loadSequence;
  const contractId = props.contractId;
  loading.value = true;
  loadError.value = '';
  try {
    const next = await getUtilityReadiness(contractId);
    if (sequence === loadSequence) data.value = next;
  } catch (error) {
    if (sequence === loadSequence) loadError.value = apiErrorMessage(error, '请检查连接后重试');
  } finally {
    if (sequence === loadSequence) loading.value = false;
  }
}

function payload(): RuleReview {
  return {
    meterId: form.meterId, responsibility: form.responsibility,
    openingReadingId: form.openingReadingId, closingReadingId: form.closingReadingId, evidence: form.evidence.trim(),
    ...(form.responsibility === 'TENANT' && { contractId: props.contractId, collectionMode: form.collectionMode as CollectionMode, rateCents: form.rateCents }),
  };
}

async function preview() {
  if (!complete.value || busy.value) return;
  busy.value = true;
  review.value = undefined;
  try { review.value = await previewUtilityRule(payload()); }
  catch (error) { notifyApiError(error, '规则检查失败'); }
  finally { busy.value = false; }
}

async function confirm() {
  if (!review.value?.ready || busy.value) return;
  pending.value = { ...payload(), requestId: crypto.randomUUID(), reviewToken: review.value.reviewToken };
  sessionStorage.setItem(storageKey(), JSON.stringify(pending.value));
  await retryPending();
}

async function retryPending() {
  if (!pending.value || busy.value) return;
  const command = pending.value;
  const key = storageKey();
  const contractId = props.contractId;
  busy.value = true;
  try {
    await confirmUtilityRule(command);
    sessionStorage.removeItem(key);
    if (props.contractId !== contractId) return;
    pending.value = undefined;
    review.value = undefined;
    ElMessage.success('规则与责任段已保存');
    await load();
  } catch (error) {
    const code = parseApiError(error).code;
    if (code === ErrorCode.PREVIEW_STALE || code === ErrorCode.UTILITY_RULE_BLOCKED) {
      sessionStorage.removeItem(key);
      if (props.contractId === contractId) {
        pending.value = undefined;
        review.value = undefined;
      }
    }
    notifyApiError(error, '确认失败，可核对后重试');
  }
  finally { busy.value = false; }
}
</script>

<style scoped>
.review-section { margin-top: 24px; }
.review-issue { margin-bottom: 8px; }
.reading-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
.amounts { display: grid; gap: 12px; }
.amounts > div { display: flex; justify-content: space-between; gap: 16px; }
.amounts dd { margin: 0; font-variant-numeric: tabular-nums; }
.confirmed-interval { padding: 12px 0; border-bottom: 1px solid var(--border); overflow-wrap: anywhere; }
.confirmed-interval p { margin-bottom: 0; }
@media (max-width: 560px) { .reading-fields { grid-template-columns: minmax(0, 1fr); gap: 0; } }
</style>
