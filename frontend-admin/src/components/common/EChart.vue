<template>
  <div ref="chartRef" :style="{ width: width, height: height }"></div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch } from 'vue';
import * as echarts from 'echarts/core';
import { BarChart, LineChart, PieChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, LegendComponent, TitleComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { EChartsOption } from 'echarts';

echarts.use([BarChart, LineChart, PieChart, GridComponent, TooltipComponent, LegendComponent, TitleComponent, CanvasRenderer]);

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
let observer:ResizeObserver|undefined;

onMounted(() => {
  initChart();
  window.addEventListener('resize', resizeChart);
  if(chartRef.value){observer=new ResizeObserver(resizeChart);observer.observe(chartRef.value);}
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', resizeChart);
  chartInstance?.dispose();
  observer?.disconnect();
});

watch(() => props.option, (newOption) => {
  chartInstance?.setOption(newOption);
}, { deep: true });
</script>

<style scoped>
</style>
