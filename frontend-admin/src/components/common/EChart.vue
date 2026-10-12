<template>
  <div ref="chartRef" :style="{ width: width, height: height }"></div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch } from 'vue';
import * as echarts from 'echarts';
import type { EChartsOption } from 'echarts';

const props = defineProps<{
  option: EChartsOption;
  width?: string;
  height?: string;
}>();

const chartRef = ref<HTMLDivElement>();
let chartInstance: echarts.ECharts | null = null;

const initChart = () => {
  if (!chartRef.value) return;
  
  chartInstance = echarts.init(chartRef.value);
  chartInstance.setOption(props.option);
};

const resizeChart = () => {
  chartInstance?.resize();
};

onMounted(() => {
  initChart();
  window.addEventListener('resize', resizeChart);
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', resizeChart);
  chartInstance?.dispose();
});

watch(() => props.option, (newOption) => {
  chartInstance?.setOption(newOption);
}, { deep: true });
</script>

<style scoped>
</style>
