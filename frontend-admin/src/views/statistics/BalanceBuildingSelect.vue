<template>
  <div class="balance-building-select">
    <el-select :model-value="modelValue" clearable placeholder="全部楼栋" :loading="loading" @update:model-value="$emit('update:modelValue', $event || '')">
      <el-option v-for="b in options" :key="b.id" :label="b.name" :value="b.id" />
      <el-option v-if="modelValue && !options.some(b => b.id === modelValue)" :value="modelValue" :label="selectedLabel" />
    </el-select>
    <el-button :disabled="loading || page <= 1" @click="change(page - 1)">上一页</el-button>
    <span>第 {{ page }} / {{ Math.max(totalPages, 1) }} 页</span>
    <el-button :disabled="loading || page >= totalPages" @click="change(page + 1)">下一页</el-button>
    <span v-if="error" role="alert">楼栋加载失败 <el-button link @click="load">重试</el-button></span>
  </div>
</template>
<script setup lang="ts">
import { ref, watch, onMounted } from 'vue';
import request from '@/utils/request';
import { fetchBuildingPage, type BuildingPage } from './buildingPages';
const props = defineProps<{ modelValue: string }>();
defineEmits<{ 'update:modelValue': [value: string] }>();
const options = ref<{id:string;name:string}[]>([]); const page = ref(1); const totalPages = ref(1); const loading = ref(false); const error = ref(false); const selectedLabel = ref('已选楼栋'); let generation = 0;
watch(() => props.modelValue, value => { const selected = options.value.find(b => b.id === value); if (selected) selectedLabel.value = selected.name; });
async function load() { const current = ++generation; loading.value = true; error.value = false; try { const result = await fetchBuildingPage(async pageNumber => await request.get('/buildings', { params: { page: pageNumber, limit: 100 } }) as unknown as BuildingPage, page.value); if (current === generation) { options.value = result.data; totalPages.value = result.meta.totalPages; } } catch { if (current === generation) { options.value = []; error.value = true; } } finally { if (current === generation) loading.value = false; } }
function change(next:number) { page.value = next; void load(); }
onMounted(load);
</script>
