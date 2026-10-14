<template>
  <section class="resource-panel">
    <header class="resource-panel-head"><div><h2>{{ title }} <span v-if="count !== undefined">{{ count }}</span></h2><p v-if="description">{{ description }}</p></div><Teleport v-if="portal" to="#page-head-actions"><div class="resource-panel-actions"><slot name="actions" /></div></Teleport><div v-else class="resource-panel-actions"><slot name="actions" /></div></header>
    <div v-if="error" class="resource-error" role="alert"><el-icon><Warning /></el-icon><div><strong>暂时未能加载数据</strong><p>{{ error }}</p></div><el-button :loading="loading" @click="$emit('retry')">重新加载</el-button></div>
    <div v-if="loading && !count" class="resource-skeleton" aria-label="正在加载数据"><el-skeleton :rows="6" animated /></div>
    <div v-show="(!loading || !!count) && (!error || !!count)" class="resource-panel-body"><slot /></div>
  </section>
</template>
<script setup lang="ts">
import { Warning } from '@element-plus/icons-vue';
import { onMounted,ref } from 'vue';
const portal=ref(false);onMounted(()=>{portal.value=!!document.getElementById('page-head-actions');});
defineProps<{ title: string; description?: string; count?: number; loading?: boolean; error?: string }>();
defineEmits<{ retry: [] }>();
</script>
