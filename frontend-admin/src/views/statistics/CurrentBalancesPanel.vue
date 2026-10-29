<template>
  <section aria-label="当前余额核对">
    <h2>当前押金与预付余额核对</h2><p>仅当前余额和当前楼栋归属，非月末、会计负债或业主应付。账面小计不代表历史完整。</p>
    <BalanceBuildingSelect v-model="buildingId" /><el-button :loading="loading" @click="load">查询余额</el-button>
    <p v-if="error" role="alert">{{ error }}</p>
    <template v-if="report"><p>提取时间：{{ report.capturedAt }}；全局归属异常：预付 {{ report.unassignedPrepayCount }}、押金 {{ report.unassignedDepositCount }} 笔（不计楼栋小计）</p><p v-for="item in report.limitations" :key="item">{{ item }}</p>
      <section v-for="category in categories" :key="category.key"><h3>{{ category.label }}</h3><p>账面小计：¥{{ money(report[category.key].bookSubtotal) }}；待核对 {{ report[category.key].unknownCount }} 项（含账单）；完整核实合计：不可提供</p>
        <el-table :data="report[category.key].items" empty-text="当前无记录">
          <el-table-column label="账面余额（元）"><template #default="{ row }">{{ row.balance === null ? '待核对' : `¥${money(row.balance)}` }}</template></el-table-column>
          <el-table-column label="流水总和（元）"><template #default="{ row }">{{ row.movementTotal === null ? '无法计算' : `¥${money(row.movementTotal)}` }}</template></el-table-column>
          <el-table-column label="流水算术"><template #default="{ row }">{{ row.arithmetic === 'consistent' ? '一致（不证明完整）' : row.arithmetic === 'inconsistent' ? '不一致' : '无法确定' }}</template></el-table-column>
          <el-table-column label="核对原因"><template #default="{ row }">{{ row.reasons.join('；') }}</template></el-table-column>
          <el-table-column label="归属"><template #default="{ row }">{{ row.inScope ? '当前楼栋' : '归属待核对，不计小计' }}</template></el-table-column>
          <el-table-column label="追溯"><template #default="{ row }"><details><summary>查看编号与流水</summary><div>记录：{{ row.id }}；房间：{{ row.roomId }}；合同：{{ row.contractId || '无' }}</div><div v-for="m in row.movements" :key="m.id">{{ m.createdAt }} · {{ m.type }} · ¥{{ money(m.amount) }} · 流水后 ¥{{ money(m.balanceAfter) }} · {{ m.id }} · {{ m.relatedId || '' }}</div></details></template></el-table-column>
        </el-table></section>
    </template>
    <section aria-label="全局无房间归属预付"><h3>全局无房间归属预付</h3><p>此范围独立于楼栋，不计入楼栋小计；无流水的零总和不证明历史完整。</p><el-button :loading="orphanLoading" @click="loadOrphans">查询异常明细</el-button><p v-if="orphanError" role="alert">{{ orphanError }}</p>
      <el-table v-if="orphanReport" :data="orphanReport.items" empty-text="没有无房间归属账户"><el-table-column prop="id" label="账户 ID" /><el-table-column prop="roomId" label="缺失房间 ID" /><el-table-column label="账面（元）"><template #default="{ row }">{{ row.balance === null ? '待核对' : `¥${money(row.balance)}` }}</template></el-table-column><el-table-column label="流水总和（元）"><template #default="{ row }">{{ row.movementTotal === null ? '无法计算' : `¥${money(row.movementTotal)}` }}</template></el-table-column><el-table-column label="原因"><template #default="{ row }">{{ row.reasons.join('；') }}</template></el-table-column><el-table-column label="流水"><template #default="{ row }"><details><summary>查看流水</summary><div v-for="m in row.movements" :key="m.id">{{ m.id }} · {{ m.createdAt }} · {{ m.type }} · ¥{{ money(m.amount) }} · {{ m.relatedId || '' }}</div></details></template></el-table-column></el-table>
    </section>
  </section>
</template>
<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';
import request from '@/utils/request';
import BalanceBuildingSelect from './BalanceBuildingSelect.vue';
import { apiErrorMessage } from '@/utils/apiError';
import { formatMoneyPlain } from '@/utils/money';
import type { components } from '@/types/api.generated';
type Report = components['schemas']['CurrentBalancesResponseDto'];
type Orphans = components['schemas']['UnassignedPrepayResponseDto'];
const categories = [{key:'deposit', label:'押金'}, {key:'prepay', label:'预付'}] as const;
const buildingId = ref(''); const report = ref<Report | null>(null); const loading = ref(false); const error = ref(''); let generation = 0;
const money = (amount: number) => formatMoneyPlain(amount);
const orphanReport = ref<Orphans | null>(null); const orphanLoading = ref(false); const orphanError = ref(''); let orphanGeneration = 0;
async function loadOrphans() { if (orphanLoading.value) return; const current = ++orphanGeneration; orphanLoading.value = true; orphanReport.value = null; orphanError.value = ''; try { const data = await request.get('/statistics/unassigned-prepay') as unknown as Orphans; if (current === orphanGeneration) orphanReport.value = data; } catch (e) { if (current === orphanGeneration) orphanError.value = apiErrorMessage(e, '异常明细查询失败'); } finally { if (current === orphanGeneration) orphanLoading.value = false; } }
watch(buildingId, () => { generation++; report.value = null; error.value = ''; loading.value = false; }, { flush:'sync' });
onBeforeUnmount(() => { generation++; orphanGeneration++; });
async function load() {
  if (loading.value) return;
  const current = ++generation; loading.value = true; report.value = null; error.value = '';
  try { const data = await request.get('/statistics/current-balances', { params: buildingId.value ? { buildingId: buildingId.value } : {} }) as unknown as Report; if (current === generation) report.value = data; }
  catch (e) { if (current === generation) error.value = apiErrorMessage(e, '余额查询失败'); }
  finally { if (current === generation) loading.value = false; }
}
</script>
