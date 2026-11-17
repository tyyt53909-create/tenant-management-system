<template>
  <div class="charge-workbench">
    <ResourcePanel title="周期收费工作台">
      <el-form label-position="top" class="filters" @submit.prevent>
        <el-form-item label="楼栋">
          <EntitySelect v-model="buildingId" resource="buildings" :disabled="busy" @update:model-value="changeBuilding" />
        </el-form-item>
        <el-form-item label="结算截止时间">
          <el-date-picker v-model="cutoff" type="datetime" :clearable="false" :disabled="busy" />
        </el-form-item>
        <el-form-item label="历史批次">
          <el-select v-model="selected" placeholder="选择批次" :disabled="busy" @change="openBatch">
            <el-option v-for="item in history" :key="item.id"
              :label="`${item.building.name} · ${item.period} · ${formatTime(item.cutoff)} · ${item.id.slice(-6)}`" :value="item.id" />
          </el-select>
          <el-button v-if="moreHistory" link type="primary" @click="loadOlder">载入较早批次</el-button>
        </el-form-item>
      </el-form>
      <div class="actions">
        <el-button :disabled="!buildingId || busy" @click="openCollector">采集读数</el-button>
        <el-button type="primary" :disabled="!buildingId || !cutoff || busy" @click="createPreview">检查并预览</el-button>
      </div>
    </ResourcePanel>

    <ResourcePanel v-if="batch" :title="`${batch.building.name} · ${batch.period} 收费批次`">
      <template #actions>
        <el-button :disabled="busy" @click="refreshBatch()">刷新结果</el-button>
        <el-button :disabled="busy || queued || !needsReview" @click="mutate('recheck')">重新检查异常</el-button>
        <el-button v-if="hasFailedNotices" :disabled="busy" @click="retryNotices">重试站内通知</el-button>
        <el-button type="primary" :disabled="busy || queued || !ready" @click="confirm">
          确认执行 {{ ready || '' }}
        </el-button>
      </template>
      <div class="batch-summary">
        <span>截止 {{ formatTime(batch.cutoff) }}</span>
        <el-tag v-for="entry in summary" :key="entry.state" :type="stateTypes[entry.state]">
          {{ stateLabels[entry.state] }} {{ entry.count }}
        </el-tag>
      </div>
      <el-table :data="batch.items" row-key="id" empty-text="该楼栋没有符合条件的租约或表计">
        <el-table-column prop="label" label="合同 / 表号" min-width="165" />
        <el-table-column label="类型" width="80">
          <template #default="{ row }">{{ row.kind === 'RENT' ? '租金' : '水电' }}</template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">{{ stateName(row.state) }}</template>
        </el-table-column>
        <el-table-column label="费用" width="115">
          <template #default="{ row }">{{ money(row.result ?? row.review, row.state) }}</template>
        </el-table-column>
        <el-table-column label="原因 / 下一步" min-width="215">
          <template #default="{ row }">
            <div>{{ (row.result ?? row.review).reason || '—' }}</div>
            <small v-if="(row.result ?? row.review).retryCondition">{{ (row.result ?? row.review).retryCondition }}</small>
          </template>
        </el-table-column>
        <el-table-column label="收款跟进" min-width="180">
          <template #default="{ row }">{{ paymentLabel(row as ChargeItem) }}</template>
        </el-table-column>
        <el-table-column label="站内通知" width="110">
          <template #default="{ row }">{{ noticeName(row.notificationState) }}</template>
        </el-table-column>
        <el-table-column prop="attempts" label="执行次数" width="95" />
      </el-table>
    </ResourcePanel>

    <el-dialog v-model="collectVisible" title="采集读数" width="min(640px, 95vw)" :close-on-click-modal="false">
      <el-form-item label="采集时间">
        <el-date-picker v-model="readingTime" type="datetime" :clearable="false" />
      </el-form-item>
      <el-table v-loading="loadingMeters" :data="meters" empty-text="这个楼栋没有启用的房间表计" max-height="420">
        <el-table-column prop="meterNumber" label="表号" />
        <el-table-column label="房间">
          <template #default="{ row }">{{ row.room?.roomNumber || '—' }}</template>
        </el-table-column>
        <el-table-column label="本次读数" width="150">
          <template #default="{ row }">
            <el-input-number v-model="draft[row.id]" :aria-label="`${row.meterNumber} 本次读数`" :min="0" :precision="2" :controls="false" />
          </template>
        </el-table-column>
        <el-table-column label="保存结果" min-width="155">
          <template #default="{ row }">{{ collectionResults[row.id] || '—' }}</template>
        </el-table-column>
      </el-table>
      <template #footer><el-button type="primary" :loading="busy" :disabled="!readingTime || !hasDraft" @click="saveReadings">只保存读数</el-button></template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import EntitySelect from '@/components/common/EntitySelect.vue';
import ResourcePanel from '@/components/common/ResourcePanel.vue';
import { getMeters } from '@/api/meters';
import {
  collectChargeReadings, getChargeBatch, listChargeBatches, previewCharges, retryChargeNotices,
  updateChargeBatch, type ChargeBatch, type ChargeBatchDetail, type ChargeItem, type ChargeState,
} from '@/api/periodic-charges';
import type { Meter } from '@/types';
import { formatMoney } from '@/utils/table';
import { notifyApiError } from '@/utils/notify';

const route = useRoute();
const router = useRouter();
const buildingId = ref('');
const cutoff = ref(new Date());
const readingTime = ref(new Date());
const busy = ref(false);
const selected = ref('');
const batch = ref<ChargeBatchDetail>();
const history = ref<ChargeBatch[]>([]);
const moreHistory = ref(false);
const collectVisible = ref(false);
const loadingMeters = ref(false);
const meters = ref<Meter[]>([]);
const draft = reactive<Record<string, number | undefined>>({});
const collectionResults = reactive<Record<string, string>>({});
const hasDraft = computed(() => meters.value.some((meter) => Number.isFinite(draft[meter.id])));
const ready = computed(() => batch.value?.items.filter((item) => item.state === 'READY').length ?? 0);
const queued = computed(() => batch.value?.items.some((item) => item.state === 'QUEUED') ?? false);
const needsReview = computed(() => batch.value?.items.some((item) => ['READY', 'FAILED', 'BLOCKED'].includes(item.state)));
const hasFailedNotices = computed(() => batch.value?.items.some((item) => item.notificationState === 'FAILED'));
const stateLabels: Record<ChargeState, string> = {
  READY: '待确认', QUEUED: '排队中', SETTLED: '已处理', NO_CHANGE: '无变化', BLOCKED: '待处理', FAILED: '执行失败',
};
const stateTypes = { READY: 'info', QUEUED: 'info', SETTLED: 'success', NO_CHANGE: 'info', BLOCKED: 'warning', FAILED: 'danger' } as const;
const summary = computed(() => (Object.keys(stateLabels) as ChargeState[]).map((state) => ({
  state, count: batch.value?.items.filter((item) => item.state === state).length ?? 0,
})));

const stateName = (state: ChargeState) => stateLabels[state];
const formatTime = (value: string) => new Date(value).toLocaleString();
const noticeName = (state: ChargeItem['notificationState']) =>
  state ? { PENDING: '待投递', DELIVERED: '已入站内信', FAILED: '投递失败' }[state] : '—';
function money(value: ChargeItem['review'], state: ChargeState) {
  return state === 'BLOCKED' || state === 'FAILED' ? '—' : formatMoney(value.amount);
}
function paymentLabel(item: ChargeItem) {
  const bill = batch.value?.bills.find(({ id }) => id === item.result?.billId);
  const deducted = item.result?.prepayTransactionId ? '已扣预付' : '';
  if (!bill) return deducted || '—';
  const statuses: Record<string, string> = { PENDING: '待收', PARTIAL: '部分收款', PAID: '已收', CANCELLED: '已作废' };
  const status = statuses[bill.status] ?? bill.status;
  return [deducted, `${status} ${formatMoney(bill.paidAmount)} / ${formatMoney(bill.amount)}`].filter(Boolean).join(' · ');
}
function changeBuilding() {
  meters.value = [];
  Object.keys(draft).forEach((id) => delete draft[id]);
  Object.keys(collectionResults).forEach((id) => delete collectionResults[id]);
}
async function openCollector() {
  if (!buildingId.value) return;
  collectVisible.value = true;
  readingTime.value = cutoff.value;
  loadingMeters.value = true;
  try {
    const all: Meter[] = [];
    let page = 1;
    let totalPages = 1;
    do {
      const response = await getMeters({ buildingId: buildingId.value, page, limit: 100 });
      all.push(...response.data);
      totalPages = response.meta.totalPages;
      page += 1;
    } while (page <= totalPages);
    meters.value = all.filter((meter) => meter.isActive && meter.roomId);
  } catch (error) {
    notifyApiError(error, '读取表计失败');
  } finally {
    loadingMeters.value = false;
  }
}
async function saveReadings() {
  busy.value = true;
  try {
    const payload = meters.value.flatMap(({ id }) => {
      const reading = draft[id];
      return typeof reading === 'number' ? [{ meterId: id, readingTime: readingTime.value.toISOString(), currentReading: reading }] : [];
    });
    const result = await collectChargeReadings(payload);
    for (const row of result.results) {
      collectionResults[row.meterId] = row.success ? '已保存' : row.error ?? '保存失败';
      if (row.success) delete draft[row.meterId];
    }
    ElMessage.info(`已保存 ${result.successCount} 项`);
  } catch (error) {
    notifyApiError(error, '采集请求失败');
  } finally {
    busy.value = false;
  }
}

async function openBatch(id: string) {
  if (!id) return;
  try {
    const result = await getChargeBatch(id);
    if (selected.value !== id) return;
    batch.value = result;
    buildingId.value = result.buildingId;
    cutoff.value = new Date(result.cutoff);
    changeBuilding();
    void router.replace({ query: { batch: id } });
  } catch (error) {
    notifyApiError(error, '读取收费批次失败');
  }
}
async function refreshBatch(silent = false) {
  if (!batch.value || busy.value) return;
  const id = batch.value.id;
  try {
    const result = await getChargeBatch(id);
    if (batch.value?.id === id) batch.value = result;
  } catch (error) {
    if (!silent) notifyApiError(error, '刷新结果失败');
  }
}
async function createPreview() {
  busy.value = true;
  try {
    const result = await previewCharges({ buildingId: buildingId.value, cutoff: cutoff.value.toISOString() });
    batch.value = result;
    selected.value = result.id;
    history.value = [result, ...history.value];
    void router.replace({ query: { batch: result.id } });
  } catch (error) {
    notifyApiError(error, '生成预览失败');
  } finally {
    busy.value = false;
  }
}
async function mutate(action: 'recheck' | 'confirm', reviewed = batch.value) {
  if (!reviewed || busy.value || reviewed.id !== batch.value?.id) return;
  busy.value = true;
  try {
    batch.value = await updateChargeBatch(reviewed, action);
  } catch (error) {
    notifyApiError(error, '批次操作失败');
  } finally {
    busy.value = false;
  }
}
async function confirm() {
  const reviewed = batch.value;
  if (!reviewed) return;
  const readyItems = reviewed.items.filter((item) => item.state === 'READY');
  const total = readyItems.reduce((sum, item) => sum + item.review.amount, 0);
  try {
    await ElMessageBox.confirm(`确认执行 ${reviewed.building.name} ${readyItems.length} 项，共 ${formatMoney(total)}？`, '确认周期收费', { type: 'warning' });
  } catch {
    return;
  }
  await mutate('confirm', reviewed);
}
async function retryNotices() {
  if (!batch.value) return;
  busy.value = true;
  try {
    batch.value = await retryChargeNotices(batch.value.id);
  } catch (error) {
    notifyApiError(error, '重试通知失败');
  } finally {
    busy.value = false;
  }
}
async function loadOlder() {
  try {
    const older = await listChargeBatches(history.value.at(-1)?.id);
    history.value.push(...older);
    moreHistory.value = older.length === 50;
  } catch (error) {
    notifyApiError(error, '读取较早批次失败');
  }
}
let poll: ReturnType<typeof setInterval> | undefined;
onMounted(async () => {
  try {
    history.value = await listChargeBatches();
    moreHistory.value = history.value.length === 50;
    const id = route.query.batch;
    if (typeof id === 'string') {
      selected.value = id;
      await openBatch(id);
    }
  } catch (error) {
    notifyApiError(error, '读取历史批次失败');
  }
  poll = setInterval(() => {
    if (queued.value || batch.value?.items.some((item) => item.notificationState === 'PENDING')) void refreshBatch(true);
  }, 3000);
});
onUnmounted(() => clearInterval(poll));
</script>

<style scoped>
.charge-workbench { display: grid; gap: 16px; }
.filters { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 0 16px; }
.filters :deep(.el-date-editor) { width: 100%; }
.actions, .batch-summary { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.batch-summary { margin-bottom: 12px; }
.batch-summary > span, small { color: var(--el-text-color-secondary); }
</style>
