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

    <!-- 近六个月用量趋势图 (拆分子组件) -->
    <UtilitiesTrendPanel :overview="overview" :selected-month="selectedMonth" />
  </section>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { Odometer, TrendCharts, Wallet, Calendar, ArrowRight } from '@element-plus/icons-vue';
import { getUtilitiesOverview, type UtilitiesOverviewData } from '@/api/meters';
import { getBuildings } from '@/api/buildings';
import type { Building } from '@/types';
import UtilitiesTrendPanel from './UtilitiesTrendPanel.vue';

const router = useRouter();

const loading = ref(false);
const buildings = ref<Building[]>([]);
const selectedBuildingId = ref<string>('');

const now = new Date();
const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
const selectedMonth = ref<string>(defaultMonth);

const overview = ref<UtilitiesOverviewData | null>(null);

function formatNumber(num: number): string {
  if (num >= 1000) {
    return num.toLocaleString();
  }
  return String(num);
}

function formatCents(cents: number): string {
  return (cents / 100).toFixed(2);
}

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
  color: var(--text-muted);
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
  color: var(--text-muted);
  font-weight: 500;
}

.pill-tag.live {
  background: #edf1e8;
  color: #556b2f;
}

.subtitle {
  margin: 6px 0 0;
  font-size: 13px;
  color: var(--text-muted);
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
  transition: all 0.22s cubic-bezier(0.16, 1, 0.3, 1);
}

.action-btn:hover {
  background: #f7f4ec;
  border-color: #c9c3b4;
  color: #1a1918;
}

/* KPI 网格 */
.kpi-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px;
  margin: 24px 0 22px;
}

.kpi-card {
  background: #ffffff;
  border: 1px solid #ebe7df;
  border-radius: 12px;
  padding: 18px 20px;
  transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.25s ease, border-color 0.2s ease;
  position: relative;
  overflow: hidden;
}

.kpi-card:hover {
  transform: translateY(-3px);
  box-shadow: 0 12px 28px rgba(54, 45, 26, 0.06);
  border-color: #ded8cb;
}

/* 顶部各颜色高光线条 */
.water-card {
  border-top: 3px solid #768168;
}

.elec-card {
  border-top: 3px solid #b87648;
}

.cost-card {
  border-top: 3px solid #6b8e78;
}

.progress-card {
  border-top: 3px solid #ba6459;
}

.kpi-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 13px;
  color: var(--text-muted);
}

.kpi-icon {
  font-size: 16px;
  color: var(--text-subtle);
  transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1), color 0.2s ease;
}

.kpi-card:hover .kpi-icon {
  transform: scale(1.15);
  color: #4f4b42;
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
  color: var(--text-muted);
  font-weight: 400;
}

.kpi-footer {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-muted);
}

.mom-rate {
  font-weight: 600;
}

.mom-rate.up {
  color: var(--error-text);
}

.mom-rate.down {
  color: #556b2f;
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
  color: var(--error-text);
}

.status-badge.done {
  background: #edf1e8;
  color: #556b2f;
}

.cost-split {
  font-size: 12px;
  color: var(--text-muted);
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
