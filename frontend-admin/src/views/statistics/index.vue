<template>
  <div class="statistics-page">
    <el-card shadow="never">
      <template #header>
        <div class="header">
          <span class="title">统计</span>
          <span class="range" v-if="data">
            统计区间：{{ data.summary.range.start.slice(0, 10) }} ~ {{ data.summary.range.end.slice(0, 10) }}
          </span>
        </div>
      </template>

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

      <el-row v-loading="loading" :gutter="16" class="cards">
        <el-col :xs="12" :sm="8" :md="6">
          <el-card shadow="hover" class="stat-card">
            <div class="stat-label">出账总额</div>
            <div class="stat-value">¥{{ money(data?.summary.totalBilled) }}</div>
            <div class="stat-sub">租金 ¥{{ money(data?.summary.rentBilled) }} · 水电 ¥{{ money(data?.summary.utilityBilled) }}</div>
          </el-card>
        </el-col>
        <el-col :xs="12" :sm="8" :md="6">
          <el-card shadow="hover" class="stat-card">
            <div class="stat-label">实收总额</div>
            <div class="stat-value success">¥{{ money(data?.summary.totalPaid) }}</div>
            <div class="stat-sub">租金 ¥{{ money(data?.summary.rentPaid) }} · 水电 ¥{{ money(data?.summary.utilityPaid) }}</div>
          </el-card>
        </el-col>
        <el-col :xs="12" :sm="8" :md="6">
          <el-card shadow="hover" class="stat-card">
            <div class="stat-label">收缴率</div>
            <div class="stat-value">
              {{ data?.summary.collectionRate === null ? '—' : (data?.summary.collectionRate ?? '—') + '%' }}
            </div>
            <div class="stat-sub">实收 / 出账</div>
          </el-card>
        </el-col>
        <el-col :xs="12" :sm="8" :md="6">
          <el-card shadow="hover" class="stat-card">
            <div class="stat-label">出租率</div>
            <div class="stat-value">{{ data?.summary.occupancyRate ?? 0 }}%</div>
            <div class="stat-sub">
              {{ data?.summary.roomOccupied ?? 0 }} / {{ data?.summary.roomTotal ?? 0 }} 间
            </div>
          </el-card>
        </el-col>
        <el-col :xs="12" :sm="8" :md="6">
          <el-card shadow="hover" class="stat-card">
            <div class="stat-label">逾期账单</div>
            <div class="stat-value danger">{{ data?.summary.overdueCount ?? 0 }}</div>
            <div class="stat-sub">区间内到期且逾期</div>
          </el-card>
        </el-col>
        <el-col :xs="12" :sm="8" :md="6">
          <el-card shadow="hover" class="stat-card">
            <div class="stat-label">新增报修</div>
            <div class="stat-value">{{ data?.summary.maintenanceCount ?? 0 }}</div>
            <div class="stat-sub">区间内提交</div>
          </el-card>
        </el-col>
      </el-row>

      <template v-if="query.dimension === 'FLOOR'">
        <h3 class="section-title">按楼层</h3>
        <el-empty v-if="!data || data.byFloor.length === 0" description="暂无楼层数据" />
        <el-table v-else :data="data.byFloor" border stripe>
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
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import {
  getStatisticsOverview,
  getBuildingsForFilter,
  type StatisticsOverview,
  type StatisticsPeriod,
  type StatisticsDimension,
} from '@/api/statistics';

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
const money = (cents?: number) => ((cents ?? 0) / 100).toFixed(2);

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
    ElMessage.error('获取统计数据失败');
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
.header { display: flex; justify-content: space-between; align-items: center; }
.title { font-size: 18px; font-weight: 600; }
.range { color: #909399; font-size: 13px; }
.cards { margin-top: 8px; }
.stat-card { margin-bottom: 16px; }
.stat-label { color: #909399; font-size: 13px; }
.stat-value { font-size: 24px; font-weight: 600; margin: 6px 0; }
.stat-value.success { color: #67c23a; }
.stat-value.danger { color: #f56c6c; }
.stat-sub { color: #c0c4cc; font-size: 12px; }
.section-title { margin: 18px 0 10px; font-size: 15px; }
</style>
