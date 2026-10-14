<template><el-button :disabled="!rows.length" @click="download"><el-icon><Download /></el-icon>导出{{ label || '本页' }}</el-button></template>
<script setup lang="ts">
import { Download } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { csvColumns } from '@/utils/resourceCsv';
import { downloadCsv,toCsv } from '@/utils/csv';
import type { ExportResource } from '@/utils/resourceCsv';
import type { ResourceRecord } from '@/utils/resource';
const props=defineProps<{resource:ExportResource;rows:ResourceRecord[];label?:string}>();
function download(){downloadCsv(toCsv(props.rows,csvColumns(props.resource)),`qiju-${props.resource}-loaded-${new Date().toISOString().slice(0,10)}.csv`);ElMessage.success(`已导出当前已载入的 ${props.rows.length} 条记录`);}
</script>
