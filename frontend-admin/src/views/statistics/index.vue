<template>
  <div class="statistics-page">
    <ResourcePanel title="数据统计" :description="rangeText" :loading="loading" @retry="fetchData">
      <el-form :inline="true" :model="query">
        <el-form-item label="时间维度">
          <el-radio-group v-model="query.period" @change="onPeriodChange">
            <el-radio-button value="MONTH">当月</el-radio-button>
            <el-radio-button value="QUARTER">本季</el-radio-button>
            <el-radio-button value="YEAR">本年</el-radio-button>
            <el-radio-button value="CUSTOM">自定义</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item v-if="query.period === 'CUSTOM'" label="起止">
          <el-date-picker
            v-model="customRange"
            type="daterange"
            unlink-panels
            range-separator="至"
            start-placeholder="开始日期"
            end-placeholder="结束日期"
            value-format="YYYY-MM-DD"
          />
        </el-form-item>
        <el-form-item label="空间维度">
          <el-radio-group v-model="query.dimension">
            <el-radio-button value="BUILDING">整楼</el-radio-button>
            <el-radio-button value="FLOOR">按楼层</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="楼栋">
          <el-select v-model="query.buildingId" placeholder="全部楼栋" clearable style="width: 160px">
            <el-option v-for="b in buildings" :key="b.id" :label="b.name" :value="b.id" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="fetchData">查询</el-button>
        </el-form-item>
      </el-form>

      <el-alert
        v-if="query.period === 'CUSTOM' && (!customRange || customRange.length !== 2)"
        type="warning"
        :closable="false"
        show-icon
        title="自定义区间需选择起止日期"
        style="margin-bottom: 12px"
      />

      <section class="management-overview" aria-label="运营统计摘要">
        <div class="management-metrics stat-metrics">
          <article class="management-metric">
            <span class="management-metric-icon"><el-icon :size="18"><Wallet /></el-icon></span>
            <div><h2>出账总额</h2><strong>¥{{ money(data?.summary.totalBilled) }}<small>元</small></strong><p>租金 ¥{{ money(data?.summary.rentBilled) }} · 水电 ¥{{ money(data?.summary.utilityBilled) }}</p></div>
          </article>
          <article class="management-metric success">
            <span class="management-metric-icon"><el-icon :size="18"><CircleCheck /></el-icon></span>
            <div><h2>实收总额</h2><strong>¥{{ money(data?.summary.totalPaid) }}<small>元</small></strong><p>租金 ¥{{ money(data?.summary.rentPaid) }} · 水电 ¥{{ money(data?.summary.utilityPaid) }}</p></div>
          </article>
          <article class="management-metric">
            <span class="management-metric-icon"><el-icon :size="18"><Odometer /></el-icon></span>
            <div><h2>收缴率</h2><strong>{{ data?.summary.collectionRate === null ? '—' : (data?.summary.collectionRate ?? '—') }}<small v-if="data?.summary.collectionRate !== null">%</small></strong><p>实收 / 出账</p></div>
          </article>
          <article class="management-metric">
            <span class="management-metric-icon"><el-icon :size="18"><House /></el-icon></span>
            <div><h2>出租率</h2><strong>{{ data?.summary.occupancyRate ?? 0 }}<small>%</small></strong><p>{{ data?.summary.roomOccupied ?? 0 }} / {{ data?.summary.roomTotal ?? 0 }} 间</p></div>
          </article>
          <article class="management-metric danger">
            <span class="management-metric-icon"><el-icon :size="18"><Warning /></el-icon></span>
            <div><h2>逾期账单</h2><strong>{{ data?.summary.overdueCount ?? 0 }}<small>笔</small></strong><p>区间内到期且逾期</p></div>
          </article>
          <article class="management-metric warning">
            <span class="management-metric-icon"><el-icon :size="18"><Tools /></el-icon></span>
            <div><h2>新增报修</h2><strong>{{ data?.summary.maintenanceCount ?? 0 }}<small>条</small></strong><p>区间内提交</p></div>
          </article>
        </div>
      </section>

      <template v-if="query.dimension === 'FLOOR'">
        <h3 class="section-title">按楼层</h3>
        <el-empty v-if="!data || data.byFloor.length === 0" description="暂无楼层数据" />
        <el-table v-else :data="data.byFloor">
          <el-table-column prop="floor" label="楼层" width="120">
            <template #default="{ row }">{{ row.floor }} 层</template>
          </el-table-column>
          <el-table-column prop="roomTotal" label="房间数" width="120" />
          <el-table-column prop="roomOccupied" label="已租" width="120" />
          <el-table-column label="出租率">
            <template #default="{ row }">
              <el-progress :percentage="row.occupancyRate" :stroke-width="14" />
            </template>
          </el-table-column>
        </el-table>
      </template>
    </ResourcePanel>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import { Wallet, CircleCheck, Odometer, House, Warning, Tools } from '@element-plus/icons-vue';
import {
  getStatisticsOverview,
  getBuildingsForFilter,
  type StatisticsOverview,
  type StatisticsPeriod,
  type StatisticsDimension,
} from '@/api/statistics';
import ResourcePanel from '@/components/common/ResourcePanel.vue';
import { formatMoneyPlain } from '@/utils/money';
import { notifyApiError } from '@/utils/notify';

const loading = ref(false);
const data = ref<StatisticsOverview | null>(null);
const buildings = ref<{ id: string; name: string }[]>([]);
const customRange = ref<[string, string] | null>(null);

const query = reactive<{
  period: StatisticsPeriod;
  dimension: StatisticsDimension;
  buildingId?: string;
}>({
  period: 'MONTH',
  dimension: 'BUILDING',
});

/** 分 → 元（保留两位） */
const money = (cents?: number) => formatMoneyPlain(cents ?? 0);

/** 统计区间文案（ResourcePanel 的副标题） */
const rangeText = computed(() =>
  data.value
    ? `统计区间：${data.value.summary.range.start.slice(0, 10)} ~ ${data.value.summary.range.end.slice(0, 10)}`
    : '',
);

const onPeriodChange = () => {
  if (query.period !== 'CUSTOM') customRange.value = null;
};

const fetchData = async () => {
  if (query.period === 'CUSTOM' && (!customRange.value || customRange.value.length !== 2)) {
    ElMessage.warning('请先选择自定义区间的起止日期');
    return;
  }
  loading.value = true;
  try {
    data.value = await getStatisticsOverview({
      period: query.period,
      dimension: query.dimension,
      buildingId: query.buildingId,
      startDate: query.period === 'CUSTOM' ? customRange.value?.[0] : undefined,
      endDate: query.period === 'CUSTOM' ? customRange.value?.[1] : undefined,
    });
  } catch (error) {
    notifyApiError(error, '获取统计数据失败');
  } finally {
    loading.value = false;
  }
};

onMounted(async () => {
  try {
    buildings.value = await getBuildingsForFilter();
  } catch {
    // 楼栋列表失败不阻断统计
  }
  fetchData();
});
</script>

<style scoped>
.statistics-page { padding: 0; }
/* 统计页有 6 张摘要卡：共用 .management-metric 语言，只把栅格改成 3 列更好收行 */
.stat-metrics { grid-template-columns: repeat(3, minmax(0, 1fr)); }
@media (max-width: 1120px) { .stat-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 760px) { .stat-metrics { grid-template-columns: 1fr; } }
.section-title { margin: 18px 0 10px; font-size: 15px; }
</style>
