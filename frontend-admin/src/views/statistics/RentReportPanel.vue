<template>
  <section class="rent-report" aria-label="租金收支管理报表">
    <h2>租金收支管理报表</h2>
    <p>按业务月份查看一个楼栋的租金及已付支出。</p>
    <el-form :inline="true" @submit.prevent="load">
      <el-form-item label="楼栋"><el-select v-model="buildingId" placeholder="请选择楼栋" style="width: 180px"><el-option v-for="b in buildings" :key="b.id" :value="b.id" :label="b.name" /></el-select></el-form-item>
      <el-form-item label="月份"><el-date-picker v-model="month" type="month" value-format="YYYY-MM" placeholder="选择月份" /></el-form-item>
      <el-button native-type="submit" type="primary" :loading="loading">查询收支</el-button>
    </el-form>
    <el-alert v-if="report?.status === 'incomplete'" type="warning" :closable="false" show-icon :title="`数据待核对：收款 ${report.unknownAllocationCount} 笔，退款或更正 ${report.unknownAdjustmentCount} 笔；正式收入和净收益暂不可用。`" />
    <div v-if="report" class="report-values">
      <div><span>已验证实收 / 抵扣租金</span><strong>¥{{ money(report.verifiedAllocationRentSubtotal) }}</strong></div>
      <div><span>已验证成功退款</span><strong>¥{{ money(report.verifiedRefundSubtotal) }}</strong></div>
      <div><span>已验证更正调整</span><strong>¥{{ money(report.verifiedCorrectionSubtotal) }}</strong></div>
      <div><span>已付支出</span><strong>¥{{ money(report.paidExpenses) }}</strong></div>
      <div><span>租金净收入</span><strong>{{ nullableMoney(report.rentIncome) }}</strong></div>
      <div><span>净收益</span><strong>{{ nullableMoney(report.netOperatingIncome) }}</strong></div>
      <div><span>当前预付余额（非月末）</span><strong>¥{{ money(report.currentPrepayBalance) }}</strong></div>
    </div>
    <template v-if="report"><p>{{ report.basis }}</p><p v-for="item in report.limitations" :key="item">{{ item }}</p></template>
  </section>
</template>
<script setup lang="ts">
import { ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { getRentReport, type RentReport } from '@/api/statistics';
import { formatMoneyPlain } from '@/utils/money';
import { notifyApiError } from '@/utils/notify';

defineProps<{ buildings: { id: string; name: string }[] }>();
const buildingId = ref('');
const month = ref('');
const loading = ref(false);
const report = ref<RentReport | null>(null);
watch([buildingId, month], () => { report.value = null; });
const money = (amount: number) => formatMoneyPlain(amount);
const nullableMoney = (amount: number | null) => amount === null ? '待核对' : `¥${money(amount)}`;
async function load() {
  if (!buildingId.value || !month.value) { ElMessage.warning('请选择楼栋和月份'); return; }
  if (loading.value) return;
  loading.value = true;
  report.value = null;
  const selected = { buildingId: buildingId.value, month: month.value };
  try {
    const result = await getRentReport(selected);
    if (buildingId.value === selected.buildingId && month.value === selected.month) report.value = result;
  }
  catch (error) { notifyApiError(error, '获取租金收支报表失败'); }
  finally { loading.value = false; }
}
</script>
<style scoped>
.rent-report { margin-top: 24px; padding: 20px; border: 1px solid var(--el-border-color-light); border-radius: 8px; }
.rent-report h2 { font-size: 17px; }
.report-values { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 16px; margin-top: 16px; }
.report-values div { display: flex; flex-direction: column; gap: 8px; }
.report-values span { color: var(--el-text-color-secondary); }
.rent-report p { color: var(--el-text-color-secondary); }
</style>
