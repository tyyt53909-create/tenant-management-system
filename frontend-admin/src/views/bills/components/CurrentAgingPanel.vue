<template>
  <section class="aging-panel">
    <h3>当前账龄</h3>
    <p>按当前业务日计算，非历史截止日。金额为已核实小计；待核对记录不计入小计。滞纳金不分账龄。</p>
    <EntitySelect :model-value="buildingId" resource="buildings" placeholder="全部楼栋" @update:model-value="selectBuilding" />
    <el-select v-model="billType" aria-label="账单类型" style="width: 150px" @change="load">
      <el-option label="全部类型" value="ALL" />
      <el-option v-for="item in types" :key="item.value" :label="item.label" :value="item.value" />
    </el-select>
    <el-button :loading="loading" @click="load">刷新</el-button>
    <p v-if="error" role="alert">{{ error }}</p>
    <template v-if="report">
      <p>业务日：{{ report.asOfBusinessDate }}；生成时间：{{ report.generatedAt }}</p>
      <el-table :data="report.groups" border>
        <el-table-column label="类型" width="90"><template #default="{ row }">{{ label(row.billType) }}</template></el-table-column>
        <el-table-column v-for="b in buckets" :key="b.key" :label="b.label" min-width="110">
          <template #default="{ row }"><template v-if="row.unknownPrincipalCount && !row.buckets[b.key].count">—（有待核对）</template><template v-else>{{ row.unknownPrincipalCount ? '已核实 ' : '' }}{{ money(row.buckets[b.key].amount) }} / {{ row.buckets[b.key].count }} 笔</template></template>
        </el-table-column>
        <el-table-column label="本金已核实小计" min-width="125"><template #default="{ row }">{{ row.unknownPrincipalCount && !row.principalCount ? '—' : money(row.principal) }} / {{ row.principalCount }} 笔<br>待核对 {{ row.unknownPrincipalCount }} 笔</template></el-table-column>
        <el-table-column label="未付已确认滞纳金" min-width="140"><template #default="{ row }">{{ row.unknownLateFeeCount && !row.lateFeeCount ? '—' : money(row.lateFee) }} / {{ row.lateFeeCount }} 笔<br>待核对 {{ row.unknownLateFeeCount }} 笔</template></el-table-column>
      </el-table>
      <p>本金已核实合计：{{ report.totals.unknownPrincipalCount && !report.totals.principalCount ? '—' : money(report.totals.principal) }} / {{ report.totals.principalCount }} 笔，待核对 {{ report.totals.unknownPrincipalCount }} 笔；未付已确认滞纳金已核实合计：{{ report.totals.unknownLateFeeCount && !report.totals.lateFeeCount ? '—' : money(report.totals.lateFee) }} / {{ report.totals.lateFeeCount }} 笔，待核对 {{ report.totals.unknownLateFeeCount }} 笔。</p>
      <details v-for="group in report.groups" :key="group.billType">
        <summary>{{ label(group.billType) }}账单明细</summary>
        <div>本金待核对：<button v-for="id in group.unknownPrincipalIds" :key="id" type="button" @click="$emit('open', id)">{{ id }}</button></div>
        <div>滞纳金待核对：<button v-for="id in group.unknownLateFeeIds" :key="id" type="button" @click="$emit('open', id)">{{ id }}</button></div>
        <div v-for="b in buckets" :key="b.key">{{ b.label }}：
          <button v-for="id in group.buckets[b.key].billIds" :key="id" type="button" @click="$emit('open', id)">{{ id }}</button>
          <span v-if="!group.buckets[b.key].count">无已核实记录</span>
        </div>
      </details>
    </template>
  </section>
</template>
<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import request from '@/utils/request';
import { apiErrorMessage } from '@/utils/apiError';
import EntitySelect from '@/components/common/EntitySelect.vue';
import { formatMoney } from '@/utils/table';
import { isAgingReport, agingParams, requestGeneration, type Key, type Report } from './agingReport';
defineEmits<{ open: [id: string] }>();
const types = [{value:'RENT', label:'租金'}, {value:'UTILITY', label:'水电费'}, {value:'DEPOSIT', label:'押金'}, {value:'OTHER', label:'其他'}, {value:'MAINTENANCE', label:'维修费'}];
const buckets: {key: Key; label: string}[] = [{key:'CURRENT',label:'未逾期'}, {key:'DAYS_1_30',label:'1–30 天'}, {key:'DAYS_31_60',label:'31–60 天'}, {key:'DAYS_61_90',label:'61–90 天'}, {key:'DAYS_91_PLUS',label:'91 天以上'}];
const label = (type: string) => types.find(t => t.value === type)?.label ?? type;
const money = (amount: number) => formatMoney(amount);
const billType = ref('ALL');
const buildingId = ref('');
function selectBuilding(value: string) { buildingId.value = value; void load(); }
const report = ref<Report | null>(null);
const loading = ref(false); const error = ref(''); const generation = requestGeneration();
async function load() {
  const current = generation.next(); loading.value = true; error.value = ''; report.value = null;
  try { const data: unknown = await request.get('/bills/current-aging', {params: agingParams(billType.value, buildingId.value)}); if (!isAgingReport(data)) throw new Error('invalid report'); if (generation.isCurrent(current)) report.value = data; }
  catch (e) { if (generation.isCurrent(current)) error.value = apiErrorMessage(e, '账龄查询失败，请重试'); }
  finally { if (generation.isCurrent(current)) loading.value = false; }
}
onMounted(load); onUnmounted(() => { generation.next(); });
</script>
<style scoped>
.aging-panel { padding: 20px; margin-bottom: 20px; background: white; border: 1px solid #e4e7ed; border-radius: 8px; }
.aging-panel :deep(.entity-select) { display: inline-block; width: 180px; margin-right: 8px; }
.aging-panel p { color: #606266; }
.aging-panel details { padding-top: 8px; }
.aging-panel button { margin: 3px; }
</style>
