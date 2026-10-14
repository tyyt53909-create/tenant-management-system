<template>
  <section class="management-overview" :aria-label="title || '业务摘要'" :aria-busy="store.loading">
    <div class="management-metrics"><article v-for="metric in metrics" :key="metric.key" :class="['management-metric',{[metric.tone || 'neutral']:true}]"><span class="management-metric-icon"><el-icon :size="18"><component :is="icons[metric.icon]" /></el-icon></span><div><h2>{{ metric.label }}</h2><strong>{{ metricValue(metric,values) }}<small v-if="values && metric.unit">{{ metric.unit }}</small></strong><p>{{ metric.note }}</p></div></article></div>
    <div v-if="store.error" class="management-summary-error" role="alert">{{ store.error }} {{ store.snapshot ? '目前保留上次摘要。' : '没有可用统计，不显示为零。' }} <el-button text size="small" :loading="store.loading" @click="store.load(true)">重新加载</el-button></div>
  </section>
</template>
<script setup lang="ts">
import { computed,onMounted,onUnmounted } from 'vue';
import { House,User,OfficeBuilding,Document,Wallet,Tools,Calendar,Clock,CircleCheck,Warning,Brush,Odometer,TrendCharts,Switch,Bell } from '@element-plus/icons-vue';
import { MANAGEMENT_METRICS,metricValue } from '@/utils/managementMetrics';
import type { ManagementKey } from '@/utils/managementMetrics';
import { useManagementStore } from '@/stores/management';
const props=defineProps<{resource:ManagementKey;title?:string}>();const store=useManagementStore();
const metrics=computed(()=>MANAGEMENT_METRICS[props.resource]);const values=computed(()=>store.snapshot?.[props.resource]);
const icons:Record<string,any>={house:House,users:OfficeBuilding,user:User,document:Document,wallet:Wallet,tools:Tools,calendar:Calendar,clock:Clock,check:CircleCheck,alert:Warning,brush:Brush,meter:Odometer,chart:TrendCharts,checkout:Switch,bell:Bell};
function refresh(){void store.load(true);}
onMounted(()=>{void store.load();window.addEventListener('qiju:data-updated',refresh);});
onUnmounted(()=>window.removeEventListener('qiju:data-updated',refresh));
</script>
