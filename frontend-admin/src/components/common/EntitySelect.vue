<template>
  <div class="entity-select"><el-select :model-value="modelValue" @update:model-value="select" :placeholder="placeholder || `请选择${names[resource]}`" filterable clearable :loading="loading" :disabled="disabled" style="width:100%" :no-data-text="error || '暂无可选记录，请先创建对应资料'"><el-option v-for="item in options" :key="item.id" :label="recordLabel(resource,item)" :value="item.id" /><el-option v-if="modelValue && !options.some(item => item.id === modelValue)" :value="modelValue" label="当前关联记录（未载入）" /></el-select><button v-if="error" type="button" class="entity-retry" @click="load">{{ error }} · 重试</button><small v-if="truncated">仅加载前 10000 条，请缩小管理范围后再选择。</small></div>
</template>
<script setup lang="ts">
import { ref, onMounted } from 'vue';
import request from '@/utils/request';
import { recordLabel } from '@/utils/resource';
import type { ResourceRecord } from '@/utils/resource';
const props = defineProps<{ modelValue?: string; resource:'rooms'|'tenants'|'contracts'|'buildings'; placeholder?: string; disabled?: boolean }>();
const emit = defineEmits<{ 'update:modelValue':[value:string]; selected:[row:ResourceRecord|null] }>();
const names = { rooms:'房源', tenants:'租客', contracts:'合同', buildings:'楼栋' };
const options = ref<ResourceRecord[]>([]); const loading = ref(false); const error = ref(''); const truncated = ref(false);
async function load() {
  loading.value=true; error.value=''; const all:ResourceRecord[]=[];
  try { for(let page=1;page<=100;page++){ const res:any=await request.get(`/${props.resource}`,{params:{page,limit:100}});all.push(...res.data); if(page >= (res.meta?.totalPages || 1)) break; if(page===100) truncated.value=true; } options.value=all; }
  catch { error.value='选项加载失败'; options.value=[]; } finally { loading.value=false; }
}
function select(value:string|undefined){emit('update:modelValue',value||'');emit('selected',options.value.find(row=>row.id===value)||null);}
onMounted(load);
</script>
