<template>
  <div class="business-settings" v-loading="loading">
    <el-alert
      type="info"
      :closable="false"
      show-icon
      title="这里的默认值只影响之后新建的数据"
      description="已经生成的合同、预付账户和水电表保持原值；修改单价请到水电表详情单独调价。"
      style="margin-bottom: 16px"
    />

    <div class="settings-grid">
      <section class="settings-card">
        <header>
          <div>
            <h2>默认滞纳金规则</h2>
            <p>新合同未单独填写规则时使用；空规则表示不计收。</p>
          </div>
          <el-tag v-if="lateFeeItem?.isDefault" type="info" size="small">默认值</el-tag>
          <el-tag v-else type="success" size="small">已自定义</el-tag>
        </header>

        <el-form label-width="120px" class="settings-form">
          <el-form-item label="宽限天数">
            <el-input-number v-model="lateFee.graceDays" :min="0" :max="365" :step="1" />
            <span class="hint">逾期后前 N 天不计收</span>
          </el-form-item>
          <el-form-item label="按日费率">
            <el-input-number v-model="lateFee.ratePercent" :min="0" :max="100" :step="0.01" :precision="3" />
            <span class="hint">%/天，例如 0.3</span>
          </el-form-item>
          <el-form-item label="固定日额">
            <el-input v-model="lateFee.fixedDailyYuan" placeholder="留空表示不用固定金额">
              <template #append>元/天</template>
            </el-input>
          </el-form-item>
          <el-form-item label="封顶金额">
            <el-input v-model="lateFee.capYuan" placeholder="留空表示不封顶">
              <template #append>元</template>
            </el-input>
          </el-form-item>
          <el-form-item>
            <el-button type="primary" :loading="savingLateFee" @click="saveLateFee">保存规则</el-button>
            <span v-if="lateFeeItem?.updatedAt" class="hint">
              最近更新 {{ formatDateTime(lateFeeItem.updatedAt) }}
            </span>
          </el-form-item>
        </el-form>
      </section>

      <section class="settings-card">
        <header>
          <div>
            <h2>预付账户预警阈值</h2>
            <p>新开的预付账户默认使用；0 表示不提醒。</p>
          </div>
          <el-tag v-if="thresholdItem?.isDefault" type="info" size="small">默认值</el-tag>
          <el-tag v-else type="success" size="small">已自定义</el-tag>
        </header>

        <el-form label-width="120px" class="settings-form">
          <el-form-item label="预警阈值">
            <el-input v-model="thresholdYuan" placeholder="例如 100">
              <template #append>元</template>
            </el-input>
          </el-form-item>
          <el-form-item>
            <el-button type="primary" :loading="savingThreshold" @click="saveThreshold">保存阈值</el-button>
            <span v-if="thresholdItem?.updatedAt" class="hint">
              最近更新 {{ formatDateTime(thresholdItem.updatedAt) }}
            </span>
          </el-form-item>
        </el-form>
      </section>

      <section class="settings-card settings-card-wide">
        <header>
          <div>
            <h2>水电表默认单价</h2>
            <p>新建水电表未填写单价时按对应表类型的默认价；已建表仍按自己的价格历史。</p>
          </div>
        </header>

        <el-table :data="meterPrices" size="small" class="settings-table">
          <el-table-column label="表类型" width="120">
            <template #default="{ row }">{{ meterTypeLabel(row.meterType) }}</template>
          </el-table-column>
          <el-table-column label="当前默认价" width="160">
            <template #default="{ row }">
              {{ row.unitPrice == null ? '未配置' : formatMoney(row.unitPrice) }}
            </template>
          </el-table-column>
          <el-table-column label="生效日" width="140">
            <template #default="{ row }">{{ row.effectiveDate?.slice(0, 10) ?? '—' }}</template>
          </el-table-column>
          <el-table-column label="新单价（元）" width="180">
            <template #default="{ row }">
              <el-input v-model="row.editYuan" placeholder="如 0.42" />
            </template>
          </el-table-column>
          <el-table-column label="生效日" width="180">
            <template #default="{ row }">
              <el-date-picker v-model="row.editDate" type="date" value-format="YYYY-MM-DD" placeholder="选择日期" />
            </template>
          </el-table-column>
          <el-table-column label="操作" width="120">
            <template #default="{ row }">
              <el-button link type="primary" :loading="row.saving" @click="saveMeterPrice(row as MeterPriceRow)">保存</el-button>
            </template>
          </el-table-column>
        </el-table>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import {
  getMeterDefaultPrices,
  getSettings,
  setMeterDefaultPrice,
  updateSetting,
  type LateFeeRuleValue,
  type MeterDefaultPrice,
  type SettingItem,
} from '@/api/settings';
import { centsToYuan, formatMoney, yuanToCents } from '@/utils/money';

const loading = ref(false);
const savingLateFee = ref(false);
const savingThreshold = ref(false);

const lateFeeItem = ref<SettingItem<LateFeeRuleValue> | null>(null);
const thresholdItem = ref<SettingItem<number> | null>(null);
type MeterPriceRow = MeterDefaultPrice & { editYuan: string; editDate: string; saving?: boolean };
const meterPrices = ref<MeterPriceRow[]>([]);

const lateFee = reactive({
  graceDays: 0,
  ratePercent: 0,
  fixedDailyYuan: '',
  capYuan: '',
});
const thresholdYuan = ref('');

const today = () => new Date().toISOString().slice(0, 10);

function meterTypeLabel(type: string): string {
  return ({ ELECTRICITY: '电表', WATER: '水表', GAS: '燃气表' } as Record<string, string>)[type] ?? type;
}

function formatDateTime(value: string): string {
  return value.replace('T', ' ').slice(0, 16);
}

function optionalYuan(value: string): number | null {
  const text = String(value ?? '').trim();
  if (text === '') return null;
  return yuanToCents(text);
}

function fillLateFee(value: LateFeeRuleValue) {
  lateFee.graceDays = value.graceDays ?? 0;
  lateFee.ratePercent = value.dailyRate == null ? 0 : Number((value.dailyRate * 100).toFixed(4));
  lateFee.fixedDailyYuan = value.fixedDaily == null ? '' : String(centsToYuan(value.fixedDaily));
  lateFee.capYuan = value.cap == null ? '' : String(centsToYuan(value.cap));
}

async function load() {
  loading.value = true;
  try {
    const [settings, prices] = await Promise.all([getSettings(), getMeterDefaultPrices()]);
    lateFeeItem.value = (settings.find((item) => item.key === 'billing.defaultLateFeeRule') as SettingItem<LateFeeRuleValue>) ?? null;
    thresholdItem.value = (settings.find((item) => item.key === 'prepay.defaultLowBalanceThreshold') as SettingItem<number>) ?? null;

    if (lateFeeItem.value) fillLateFee(lateFeeItem.value.value);
    thresholdYuan.value = thresholdItem.value ? String(centsToYuan(thresholdItem.value.value)) : '';

    meterPrices.value = prices.map((item) => ({
      ...item,
      editYuan: item.unitPrice == null ? '' : String(centsToYuan(item.unitPrice)),
      editDate: item.effectiveDate?.slice(0, 10) ?? today(),
    }));
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '加载设置失败');
  } finally {
    loading.value = false;
  }
}

async function saveLateFee() {
  savingLateFee.value = true;
  try {
    const ratePercent = Number(lateFee.ratePercent) || 0;
    const saved = await updateSetting<LateFeeRuleValue>('billing.defaultLateFeeRule', {
      graceDays: Number(lateFee.graceDays) || 0,
      dailyRate: ratePercent > 0 ? ratePercent / 100 : null,
      fixedDaily: optionalYuan(lateFee.fixedDailyYuan),
      cap: optionalYuan(lateFee.capYuan),
    });
    lateFeeItem.value = saved;
    fillLateFee(saved.value);
    ElMessage.success('默认滞纳金规则已保存');
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '保存失败');
  } finally {
    savingLateFee.value = false;
  }
}

async function saveThreshold() {
  savingThreshold.value = true;
  try {
    const cents = yuanToCents(thresholdYuan.value || 0);
    const saved = await updateSetting<number>('prepay.defaultLowBalanceThreshold', cents);
    thresholdItem.value = saved;
    thresholdYuan.value = String(centsToYuan(saved.value));
    ElMessage.success('预警阈值已保存');
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '保存失败');
  } finally {
    savingThreshold.value = false;
  }
}

async function saveMeterPrice(row: MeterPriceRow) {
  const yuan = String(row.editYuan ?? '').trim();
  if (yuan === '') {
    ElMessage.warning('请填写新单价');
    return;
  }
  if (!row.editDate) {
    ElMessage.warning('请选择生效日');
    return;
  }
  row.saving = true;
  try {
    await setMeterDefaultPrice({
      meterType: row.meterType,
      unitPrice: yuanToCents(yuan),
      effectiveDate: row.editDate,
    });
    ElMessage.success(`${meterTypeLabel(row.meterType)}默认价已保存`);
    await load();
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '保存失败');
  } finally {
    row.saving = false;
  }
}

onMounted(load);
</script>

<style scoped>
.business-settings {
  padding: 4px 0;
}

.settings-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.settings-card {
  border: 1px solid var(--q-border, #e4e7ed);
  border-radius: 12px;
  padding: 18px 20px;
  background: var(--q-surface, #fff);
}

.settings-card-wide {
  grid-column: 1 / -1;
}

.settings-card header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.settings-card h2 {
  margin: 0 0 4px;
  font-size: 16px;
}

.settings-card p {
  margin: 0;
  color: var(--q-text-muted, #6b7280);
  font-size: 13px;
}

.settings-form {
  margin-top: 8px;
}

.hint {
  margin-left: 10px;
  color: var(--q-text-muted, #6b7280);
  font-size: 12px;
}

.settings-table {
  width: 100%;
}

@media (max-width: 900px) {
  .settings-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
