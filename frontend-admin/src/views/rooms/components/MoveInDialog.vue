<template>
  <el-dialog :model-value="true" title="办理入住" width="min(600px, 94vw)"
    :close-on-click-modal="false" :show-close="!busy" :close-on-press-escape="!busy" @close="emit('close')">
    <el-descriptions :column="1" class="room-summary">
      <el-descriptions-item label="房源">{{ room.building?.name }} {{ room.roomNumber }}</el-descriptions-item>
      <el-descriptions-item v-if="preview" label="租客">{{ preview.tenantName }}</el-descriptions-item>
    </el-descriptions>

    <el-form v-if="!preview" label-position="top" @submit.prevent="loadPreview">
      <el-form-item label="租约">
        <el-radio-group v-model="mode">
          <el-radio-button value="existing">已有合同</el-radio-button>
          <el-radio-button value="new">新建合同</el-radio-button>
        </el-radio-group>
      </el-form-item>
      <el-form-item v-if="mode === 'existing'" label="合同">
        <el-select v-model="contractId" :loading="loadingContracts" placeholder="请选择合同">
          <el-option v-for="lease in contracts" :key="lease.id" :label="lease.contractNumber" :value="lease.id" />
        </el-select>
        <el-button v-if="loadFailed" link type="primary" @click="loadContracts">重新加载合同</el-button>
      </el-form-item>
      <template v-else>
        <el-form-item label="租客"><EntitySelect v-model="draft.tenantId" resource="tenants" /></el-form-item>
        <div class="terms">
          <el-form-item label="起租日"><el-date-picker v-model="draft.startDate" type="date" value-format="YYYY-MM-DD" /></el-form-item>
          <el-form-item label="到期日"><el-date-picker v-model="draft.endDate" type="date" value-format="YYYY-MM-DD" /></el-form-item>
          <el-form-item label="月租金（元）"><el-input-number v-model="draft.rent" :min="0" :precision="2" /></el-form-item>
          <el-form-item label="押金（元）"><el-input-number v-model="draft.deposit" :min="0" :precision="2" /></el-form-item>
          <el-form-item label="付款周期">
            <el-select v-model="draft.paymentCycle">
              <el-option label="月付" value="MONTHLY" />
              <el-option label="季付" value="QUARTERLY" />
              <el-option label="半年付" value="SEMI_ANNUAL" />
              <el-option label="年付" value="ANNUAL" />
            </el-select>
          </el-form-item>
          <el-form-item label="每月付款日"><el-input-number v-model="draft.paymentDay" :min="1" :max="31" /></el-form-item>
        </div>
      </template>
    </el-form>

    <template v-else>
      <el-table :data="preview.bills" size="small" empty-text="本次无应收">
        <el-table-column label="入住应收">
          <template #default="{ row }">{{ row.billType === 'RENT' ? '首期租金' : '押金' }}</template>
        </el-table-column>
        <el-table-column label="金额">
          <template #default="{ row }">{{ formatMoney(row.amount) }}</template>
        </el-table-column>
        <el-table-column label="到期日">
          <template #default="{ row }">{{ row.dueDate.slice(0, 10) }}</template>
        </el-table-column>
      </el-table>
      <el-form v-if="preview.meters.length" label-position="top" class="readings">
        <el-form-item v-for="meter in preview.meters" :key="meter.id" :label="`表计 ${meter.meterNumber} 入住底数`">
          <el-input-number v-model="readings[meter.id]" :min="0" :max="99999999.99" :precision="2"
            :disabled="busy" @change="pending = undefined" />
        </el-form-item>
      </el-form>
    </template>

    <template #footer>
      <el-button :disabled="busy" @click="preview ? revise() : emit('close')">{{ preview ? '返回修改' : '取消' }}</el-button>
      <el-button v-if="!preview" type="primary" :loading="busy" :disabled="!validSelection" @click="loadPreview">预览入住</el-button>
      <el-button v-else type="primary" :loading="busy" :disabled="incompleteReadings" @click="submit">确认入住</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import EntitySelect from '@/components/common/EntitySelect.vue';
import { getContracts } from '@/api/contracts';
import { confirmMoveIn, previewMoveIn, type MoveInConfirmation, type MoveInPreview, type MoveInSelection } from '@/api/move-in';
import type { Contract, Room } from '@/types';
import { notifyApiError } from '@/utils/notify';
import { formatMoney } from '@/utils/table';

const props = defineProps<{ room: Room }>();
const emit = defineEmits<{ close: []; completed: [] }>();
const mode = ref<'existing' | 'new'>('existing');
const contractId = ref('');
const contracts = ref<Contract[]>([]);
const loadingContracts = ref(false);
const loadFailed = ref(false);
const busy = ref(false);
const preview = ref<MoveInPreview>();
const selected = ref<MoveInSelection>();
const pending = ref<MoveInConfirmation>();
const readings = reactive<Record<string, number | undefined>>({});
const draft = reactive({
  tenantId: '', startDate: '', endDate: '', rent: 0, deposit: 0,
  paymentCycle: 'MONTHLY' as Contract['paymentCycle'], paymentDay: 1,
});
const validSelection = computed(() => mode.value === 'existing' ? !!contractId.value
  : Boolean(draft.tenantId && draft.startDate && draft.endDate
    && Number.isFinite(draft.rent) && Number.isFinite(draft.deposit) && Number.isInteger(draft.paymentDay)));
const incompleteReadings = computed(() => preview.value?.meters.some((meter) => !Number.isFinite(readings[meter.id])) ?? true);

async function loadContracts() {
  loadingContracts.value = true;
  loadFailed.value = false;
  try {
    const items = await getContracts({ roomId: props.room.id, limit: 100 });
    contracts.value = items.data.filter((lease) => !lease.renewedFromId
      && (lease.status === 'DRAFT' || (lease.status === 'ACTIVE' && lease.leaseConfirmedAt)));
    contractId.value = contracts.value[0]?.id ?? '';
    mode.value = contractId.value ? 'existing' : 'new';
  } catch (error) {
    loadFailed.value = true;
    notifyApiError(error, '读取可用合同失败');
  } finally {
    loadingContracts.value = false;
  }
}

async function loadPreview() {
  if (busy.value || !validSelection.value) return;
  const data: MoveInSelection = mode.value === 'existing' ? { contractId: contractId.value } : {
    contract: {
      buildingId: props.room.buildingId, roomId: props.room.id, tenantId: draft.tenantId,
      startDate: draft.startDate, endDate: draft.endDate, rentAmount: Math.round(draft.rent * 100),
      depositAmount: Math.round(draft.deposit * 100), paymentCycle: draft.paymentCycle, paymentDay: draft.paymentDay,
    },
  };
  busy.value = true;
  try {
    preview.value = await previewMoveIn(props.room.id, data);
    selected.value = data;
  } catch (error) {
    notifyApiError(error, '无法预览入住');
  } finally {
    busy.value = false;
  }
}

function revise() {
  preview.value = undefined;
  pending.value = undefined;
}

async function submit() {
  if (busy.value || incompleteReadings.value || !preview.value || !selected.value) return;
  pending.value ??= {
    ...selected.value, requestId: crypto.randomUUID(), reviewToken: preview.value.reviewToken,
    readings: preview.value.meters.map((meter) => ({ meterId: meter.id, currentReading: readings[meter.id]! })),
  };
  busy.value = true;
  try {
    await confirmMoveIn(props.room.id, pending.value);
    ElMessage.success('入住办理完成');
    emit('completed');
  } catch (error) {
    notifyApiError(error, '入住未确认，请核对结果后重试');
  } finally {
    busy.value = false;
  }
}

onMounted(loadContracts);
</script>

<style scoped>
.room-summary, .readings { margin-block: 12px; }
.terms { display: grid; grid-template-columns: repeat(auto-fit, minmax(185px, 1fr)); gap: 0 16px; }
.terms :deep(.el-date-editor), .terms :deep(.el-input-number) { width: 100%; }
</style>
