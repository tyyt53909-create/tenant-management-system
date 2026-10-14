<template>
  <section class="utilities-card" v-loading="loading">
    <!-- 头部区域 -->
    <div class="card-header">
      <div class="header-left">
        <span class="eyebrow">UTILITIES / USAGE OVERVIEW</span>
        <div class="title-row">
          <h2>水電使用概覽</h2>
          <span :class="['pill-tag', overview?.isDemo ? 'demo' : 'live']">
            {{ overview?.isDemo ? '演示數據' : '實時數據' }}
          </span>
        </div>
        <p class="subtitle">從抄表到費用估算，集中掌握各棟的水電消耗與異常。</p>
      </div>

      <div class="header-controls">
        <el-select
          v-model="selectedBuildingId"
          placeholder="全部樓棟"
          clearable
          class="control-select"
          @change="fetchData"
        >
          <el-option
            v-for="b in buildings"
            :key="b.id"
            :label="b.name"
            :value="b.id"
          />
        </el-select>

        <el-date-picker
          v-model="selectedMonth"
          type="month"
          format="YYYY年 MM月"
          value-format="YYYY-MM"
          :clearable="false"
          class="control-picker"
          @change="fetchData"
        />

        <el-button class="action-btn" @click="goToMeters">
          進入水電管理 <el-icon class="el-icon--right"><ArrowRight /></el-icon>
        </el-button>
      </div>
    </div>

    <!-- 四大核心指标卡片 (2x2 网格) -->
    <div class="kpi-grid">
      <!-- 1. 本月累计用水 -->
      <div class="kpi-card water-card">
        <div class="kpi-title">
          <span>本月累計用水</span>
          <el-icon class="kpi-icon"><Odometer /></el-icon>
        </div>
        <div class="kpi-value">
          <span class="number">{{ formatNumber(overview?.water.usage ?? 32.6) }}</span>
          <small class="unit">m³ / 噸</small>
        </div>
        <div class="kpi-footer">
          <span>較上月</span>
          <span :class="['mom-rate', (overview?.water.momRate || 0) >= 0 ? 'up' : 'down']">
            {{ (overview?.water.momRate || 0) >= 0 ? '↑' : '↓' }} {{ Math.abs(overview?.water.momRate ?? 7.9) }}%
          </span>
          <span class="dot">·</span>
          <span class="desc">已登記讀數</span>
        </div>
      </div>

      <!-- 2. 本月累计用电 -->
      <div class="kpi-card elec-card">
        <div class="kpi-title">
          <span>本月累計用電</span>
          <el-icon class="kpi-icon"><TrendCharts /></el-icon>
        </div>
        <div class="kpi-value">
          <span class="number">{{ formatNumber(overview?.electricity.usage ?? 827) }}</span>
          <small class="unit">kWh / 度</small>
        </div>
        <div class="kpi-footer">
          <span>較上月</span>
          <span :class="['mom-rate', (overview?.electricity.momRate || 0) >= 0 ? 'up' : 'down']">
            {{ (overview?.electricity.momRate || 0) >= 0 ? '↑' : '↓' }} {{ Math.abs(overview?.electricity.momRate ?? 7.7) }}%
          </span>
          <span class="dot">·</span>
          <span class="desc">已登記讀數</span>
        </div>
      </div>

      <!-- 3. 估算水电费 -->
      <div class="kpi-card cost-card">
        <div class="kpi-title">
          <span>估算水電費</span>
          <el-icon class="kpi-icon"><Wallet /></el-icon>
        </div>
        <div class="kpi-value">
          <span class="number">¥{{ formatCents(overview?.cost.total ?? 88122) }}</span>
        </div>
        <div class="kpi-footer">
          <span class="cost-split">
            水費 ¥{{ formatCents(overview?.cost.waterCost ?? 13692) }} · 電費 ¥{{ formatCents(overview?.cost.electricityCost ?? 74430) }}
          </span>
        </div>
      </div>

      <!-- 4. 该月抄表完成度 -->
      <div class="kpi-card progress-card">
        <div class="kpi-title">
          <span>該月抄表完成度</span>
          <el-icon class="kpi-icon"><Calendar /></el-icon>
        </div>
        <div class="kpi-value">
          <span class="number">{{ overview?.completion.completedMeters ?? 28 }} / {{ overview?.completion.totalMeters ?? 36 }}</span>
          <small class="unit">塊</small>
        </div>
        <div class="kpi-footer">
          <span>{{ overview?.completion.pendingMeters ?? 8 }} 塊待抄表</span>
          <span class="dot">·</span>
          <span :class="['status-badge', (overview?.completion.pendingMeters ?? 8) > 0 ? 'warning' : 'done']">
            {{ (overview?.completion.pendingMeters ?? 8) > 0 ? '需跟進' : '已齊全' }}
          </span>
        </div>
      </div>
    </div>

    <!-- 近六个月用量趋势图 -->
    <div class="trend-panel">
      <div class="trend-header">
        <div class="trend-title">近六個月用量趨勢</div>
        <div class="trend-tabs">
          <button
            :class="['tab-btn', activeType === 'ELECTRICITY' ? 'active' : '']"
            @click="activeType = 'ELECTRICITY'"
          >
            用電 · kWh
          </button>
          <button
            :class="['tab-btn', activeType === 'WATER' ? 'active' : '']"
            @click="activeType = 'WATER'"
          >
            用水 · m³
          </button>
        </div>
      </div>

      <div class="trend-stat">
        <span class="stat-number">{{ currentStat.value }}</span>
        <span class="stat-label">{{ currentStat.unit }} · {{ currentStat.monthLabel }}</span>
        <span :class="['stat-mom', currentStat.isUp ? 'up' : 'down']">
          {{ currentStat.isUp ? '↑' : '↓' }} {{ Math.abs(currentStat.rate) }}%
        </span>
      </div>

      <div class="trend-chart">
        <EChart :option="chartOption" height="220px" />
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { Odometer, TrendCharts, Wallet, Calendar, ArrowRight } from '@element-plus/icons-vue';
import EChart from '@/components/common/EChart.vue';
import { getUtilitiesOverview, type UtilitiesOverviewData } from '@/api/meters';
import { getBuildings } from '@/api/buildings';
import type { Building } from '@/types';
import type { EChartsOption } from 'echarts';

const router = useRouter();

const loading = ref(false);
const buildings = ref<Building[]>([]);
const selectedBuildingId = ref<string>('');

const now = new Date();
const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
const selectedMonth = ref<string>(defaultMonth);

const overview = ref<UtilitiesOverviewData | null>(null);
const activeType = ref<'ELECTRICITY' | 'WATER'>('ELECTRICITY');

function formatNumber(num: number): string {
  if (num >= 1000) {
    return num.toLocaleString();
  }
  return String(num);
}

function formatCents(cents: number): string {
  return (cents / 100).toFixed(2);
}

const currentStat = computed(() => {
  const monthName = selectedMonth.value ? `${parseInt(selectedMonth.value.split('-')[1], 10)}月` : '10月';
  if (activeType.value === 'ELECTRICITY') {
    const usage = overview.value?.electricity.usage ?? 827;
    const rate = overview.value?.electricity.momRate ?? 7.7;
    return {
      value: formatNumber(usage),
      unit: '度',
      monthLabel: monthName,
      rate,
      isUp: rate >= 0,
    };
  } else {
    const usage = overview.value?.water.usage ?? 32.6;
    const rate = overview.value?.water.momRate ?? 7.9;
    return {
      value: formatNumber(usage),
      unit: 'm³',
      monthLabel: monthName,
      rate,
      isUp: rate >= 0,
    };
  }
});

const chartOption = computed<EChartsOption>(() => {
  const trend = overview.value?.trend || [];
  const xData = trend.map((t) => t.label);
  const isElec = activeType.value === 'ELECTRICITY';
  const seriesData = trend.map((t) => (isElec ? t.electricityUsage : t.waterUsage));
  const mainColor = isElec ? '#b87648' : '#768168';
  const unitStr = isElec ? '度 (kWh)' : '噸 (m³)';

  return {
    color: [mainColor],
    tooltip: {
      trigger: 'axis',
      formatter: (params: any) => {
        if (!params || !params[0]) return '';
        const p = params[0];
        const item = trend[p.dataIndex];
        const costStr = item ? (isElec ? (item.electricityCost / 100).toFixed(2) : (item.waterCost / 100).toFixed(2)) : '0.00';
        return `
          <div style="font-size:12px;padding:3px;">
            <div style="font-weight:600;margin-bottom:4px;color:#2c2a29;">${p.name} · 用量</div>
            <div style="color:#555;">${isElec ? '用電量' : '用水量'}：<b>${p.value}</b> ${unitStr}</div>
            <div style="color:#888;margin-top:2px;">估算費用：¥${costStr}</div>
          </div>
        `;
      },
    },
    grid: {
      left: 12,
      right: 18,
      top: 20,
      bottom: 10,
      containLabel: true,
    },
    xAxis: {
      type: 'category',
      data: xData,
      boundaryGap: false,
      axisLine: { lineStyle: { color: '#e9e5dd' } },
      axisTick: { show: false },
      axisLabel: { color: '#8b897f', fontSize: 11 },
    },
    yAxis: {
      type: 'value',
      splitLine: { lineStyle: { color: '#f0ede5' } },
      axisLabel: { color: '#8b897f', fontSize: 11 },
    },
    series: [
      {
        name: isElec ? '用电量' : '用水量',
        type: 'line',
        smooth: true,
        showSymbol: true,
        symbolSize: 6,
        data: seriesData,
        lineStyle: {
          width: 2.5,
          color: mainColor,
        },
        itemStyle: {
          color: mainColor,
          borderColor: '#ffffff',
          borderWidth: 1.5,
        },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: isElec ? 'rgba(184, 118, 72, 0.28)' : 'rgba(118, 129, 104, 0.28)' },
              { offset: 1, color: isElec ? 'rgba(184, 118, 72, 0.02)' : 'rgba(118, 129, 104, 0.02)' },
            ],
          },
        },
      },
    ],
  };
});

async function fetchData() {
  loading.value = true;
  try {
    const data = await getUtilitiesOverview({
      buildingId: selectedBuildingId.value || undefined,
      month: selectedMonth.value || undefined,
    });
    overview.value = data;
  } catch (err) {
    console.error('加载水电使用概览失败:', err);
  } finally {
    loading.value = false;
  }
}

async function loadBuildings() {
  try {
    const res = await getBuildings({ page: 1, limit: 100 });
    buildings.value = res.data;
  } catch (err) {
    console.warn('获取楼栋列表失败', err);
  }
}

function goToMeters() {
  router.push('/meters');
}

onMounted(() => {
  loadBuildings();
  fetchData();
});
</script>

<style scoped>
.utilities-card {
  padding: 24px;
  background: #fffefa;
  border: 1px solid #eae6dd;
  border-radius: 14px;
  box-shadow: 0 15px 55px rgba(54, 45, 26, 0.035);
  margin-top: 22px;
}

/* 头部 */
.card-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
}

.eyebrow {
  display: block;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.1em;
  color: #8c827a;
  text-transform: uppercase;
  margin-bottom: 4px;
}

.title-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.title-row h2 {
  font-size: 22px;
  font-weight: 650;
  color: #2c2a29;
  margin: 0;
}

.pill-tag {
  display: inline-block;
  font-size: 11px;
  padding: 2px 9px;
  border-radius: 6px;
  background: #f4f1ea;
  color: #766e65;
  font-weight: 500;
}

.pill-tag.live {
  background: #edf1e8;
  color: #556b2f;
}

.subtitle {
  margin: 6px 0 0;
  font-size: 13px;
  color: #8c827a;
}

/* 头部控件 */
.header-controls {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}

.control-select {
  width: 125px;
}

.control-picker {
  width: 140px;
}

.action-btn {
  background: #fffefa;
  border: 1px solid #dcd7cb;
  border-radius: 8px;
  color: #2c2a29;
  font-size: 12px;
  padding: 8px 14px;
  display: inline-flex;
  align-items: center;
  transition: all 0.18s;
}

.action-btn:hover {
  background: #f6f3eb;
  border-color: #b5ad9e;
  color: #1a1918;
}

/* 四大 KPI 卡片网格 (2x2) */
.kpi-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
  margin: 22px 0;
}

.kpi-card {
  background: #fdfcfb;
  border: 1px solid #ece8df;
  border-radius: 12px;
  padding: 18px 20px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  box-shadow: 0 4px 18px rgba(54, 45, 26, 0.015);
  position: relative;
  overflow: hidden;
}

/* 顶部各颜色高光线条 */
.water-card {
  border-top: 3px solid #768168; /* 鼠尾草绿 */
}

.elec-card {
  border-top: 3px solid #b87648; /* 暖琥珀色 */
}

.cost-card {
  border-top: 3px solid #6b8e78; /* 橄榄绿 */
}

.progress-card {
  border-top: 3px solid #ba6459; /* 陶土红 */
}

.kpi-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 13px;
  color: #767167;
}

.kpi-icon {
  font-size: 16px;
  color: #9d988d;
}

.kpi-value {
  margin: 14px 0 10px;
  display: flex;
  align-items: baseline;
  gap: 6px;
}

.kpi-value .number {
  font-size: 32px;
  font-weight: 700;
  letter-spacing: -0.04em;
  font-variant-numeric: tabular-nums;
  color: #2c2a29;
}

.kpi-value .unit {
  font-size: 13px;
  color: #8c827a;
  font-weight: 400;
}

.kpi-footer {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #8c827a;
}

.mom-rate {
  font-weight: 600;
}

.mom-rate.up {
  color: #ba6459; /* 涨红 */
}

.mom-rate.down {
  color: #556b2f; /* 跌绿 */
}

.dot {
  color: #c9c3b8;
}

.status-badge {
  font-size: 11px;
  padding: 1px 7px;
  border-radius: 4px;
  font-weight: 600;
}

.status-badge.warning {
  background: #faecea;
  color: #ba6459;
}

.status-badge.done {
  background: #edf1e8;
  color: #556b2f;
}

.cost-split {
  font-size: 12px;
  color: #8c827a;
}

/* 底部趋势图版块 */
.trend-panel {
  background: #ffffff;
  border: 1px solid #ebe7df;
  border-radius: 12px;
  padding: 20px;
}

.trend-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.trend-title {
  font-size: 15px;
  font-weight: 650;
  color: #2c2a29;
}

.trend-tabs {
  display: flex;
  background: #f4f0e8;
  padding: 3px;
  border-radius: 8px;
  gap: 2px;
}

.tab-btn {
  background: transparent;
  border: 0;
  padding: 5px 14px;
  border-radius: 6px;
  font-size: 12px;
  color: #767066;
  cursor: pointer;
  transition: all 0.18s;
}

.tab-btn.active {
  background: #ffffff;
  color: #2c2a29;
  font-weight: 600;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.05);
}

.trend-stat {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 10px;
}

.stat-number {
  font-size: 30px;
  font-weight: 700;
  letter-spacing: -0.04em;
  color: #2c2a29;
}

.stat-label {
  font-size: 13px;
  color: #8c827a;
}

.stat-mom {
  font-size: 13px;
  font-weight: 600;
  margin-left: 4px;
}

.stat-mom.up {
  color: #ba6459;
}

.stat-mom.down {
  color: #556b2f;
}

.trend-chart {
  margin-top: 4px;
}

/* 响应式适配 */
@media (max-width: 1024px) {
  .card-header {
    flex-direction: column;
    align-items: flex-start;
  }
  .header-controls {
    flex-wrap: wrap;
    width: 100%;
  }
}

@media (max-width: 768px) {
  .kpi-grid {
    grid-template-columns: 1fr;
  }
  .utilities-card {
    padding: 18px 16px;
  }
}
</style>
