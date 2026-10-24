<template>
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

    <transition name="stat-fade" mode="out-in">
      <div :key="activeType" class="trend-stat">
        <span class="stat-number">{{ currentStat.value }}</span>
        <span class="stat-label">{{ currentStat.unit }} · {{ currentStat.monthLabel }}</span>
        <span :class="['stat-mom', currentStat.isUp ? 'up' : 'down']">
          {{ currentStat.isUp ? '↑' : '↓' }} {{ Math.abs(currentStat.rate) }}%
        </span>
      </div>
    </transition>

    <div class="trend-chart">
      <EChart :option="chartOption" height="220px" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import EChart from '@/components/common/EChart.vue';
import type { UtilitiesOverviewData } from '@/api/meters';
import type { EChartsOption } from 'echarts';
import { formatMoneyPlain } from '@/utils/money';

const props = defineProps<{
  overview: UtilitiesOverviewData | null;
  selectedMonth: string;
}>();

const activeType = ref<'ELECTRICITY' | 'WATER'>('ELECTRICITY');

function formatNumber(num: number): string {
  if (num >= 1000) {
    return num.toLocaleString();
  }
  return String(num);
}

const currentStat = computed(() => {
  const monthName = props.selectedMonth ? `${parseInt(props.selectedMonth.split('-')[1], 10)}月` : '10月';
  if (activeType.value === 'ELECTRICITY') {
    const usage = props.overview?.electricity.usage ?? 827;
    const rate = props.overview?.electricity.momRate ?? 7.7;
    return {
      value: formatNumber(usage),
      unit: '度',
      monthLabel: monthName,
      rate,
      isUp: rate >= 0,
    };
  } else {
    const usage = props.overview?.water.usage ?? 32.6;
    const rate = props.overview?.water.momRate ?? 7.9;
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
  const trend = props.overview?.trend || [];
  const xData = trend.map((t) => t.label);
  const isElec = activeType.value === 'ELECTRICITY';
  const seriesData = trend.map((t) => (isElec ? t.electricityUsage : t.waterUsage));
  const mainColor = isElec ? '#b87648' : '#768168';
  const unitStr = isElec ? '度 (kWh)' : '噸 (m³)';

  return {
    animation: true,
    animationDuration: 750,
    animationEasing: 'cubicOut',
    animationDurationUpdate: 550,
    animationEasingUpdate: 'cubicInOut',
    color: [mainColor],
    tooltip: {
      trigger: 'axis',
      axisPointer: {
        type: 'line',
        lineStyle: {
          color: '#d6cfc2',
          width: 1,
          type: 'dashed',
        },
      },
      backgroundColor: 'rgba(255, 254, 250, 0.96)',
      borderColor: '#e8e3d8',
      borderWidth: 1,
      padding: [8, 12],
      textStyle: { color: '#2c2a29' },
      extraCssText: 'box-shadow: 0 8px 24px rgba(54, 45, 26, 0.08); border-radius: 8px;',
      formatter: (params: any) => {
        if (!params || !params[0]) return '';
        const p = params[0];
        const item = trend[p.dataIndex];
        const costStr = item ? formatMoneyPlain(isElec ? item.electricityCost : item.waterCost) : '0.00';
        return `
          <div style="font-size:12px;padding:2px;">
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
      axisLabel: { color: '#6f6c63', fontSize: 11 },
    },
    yAxis: {
      type: 'value',
      splitLine: { lineStyle: { color: '#f0ede5' } },
      axisLabel: { color: '#6f6c63', fontSize: 11 },
    },
    series: [
      {
        name: isElec ? '用电量' : '用水量',
        type: 'line',
        smooth: true,
        showSymbol: true,
        symbolSize: 6,
        emphasis: {
          scale: 1.5,
          itemStyle: {
            shadowBlur: 8,
            shadowColor: 'rgba(0,0,0,0.18)',
          },
        },
        lineStyle: {
          width: 2.5,
          color: mainColor,
        },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: isElec ? 'rgba(184, 118, 72, 0.22)' : 'rgba(118, 129, 104, 0.22)' },
              { offset: 1, color: isElec ? 'rgba(184, 118, 72, 0.02)' : 'rgba(118, 129, 104, 0.02)' },
            ],
          },
        },
        data: seriesData,
      },
    ],
  };
});
</script>

<style scoped>
.trend-panel {
  border: 1px solid #eeebe3;
  border-radius: 8px;
  padding: 16px;
  background: #faf8f5;
}

.trend-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.trend-title {
  font-size: 13px;
  font-weight: 600;
  color: #2c2a29;
}

.trend-tabs {
  display: flex;
  gap: 4px;
  background: #f2eee7; /* 白字面较浅一阶，使内文达到 4.5:1 */
  padding: 2px;
  border-radius: 6px;
}

.tab-btn {
  border: none;
  background: transparent;
  padding: 4px 10px;
  font-size: 11px;
  color: var(--text-muted);
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s;
}

.tab-btn.active {
  background: #ffffff;
  color: #2c2a29;
  font-weight: 600;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
}

.trend-stat {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 8px;
}

.stat-number {
  font-family: inherit;
  font-size: 20px;
  font-weight: 700;
  color: #2c2a29;
}

.stat-label {
  font-size: 11px;
  color: var(--text-muted);
}

.stat-mom {
  font-size: 11px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 4px;
}

.stat-mom.up {
  color: #8f5a2b;
  background: #f7ebe1;
}

.stat-mom.down {
  color: #556b4f;
  background: #eaf0e6;
}

.trend-chart {
  width: 100%;
}

.stat-fade-enter-active,
.stat-fade-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.stat-fade-enter-from,
.stat-fade-leave-to {
  opacity: 0;
  transform: translateY(4px);
}
</style>
