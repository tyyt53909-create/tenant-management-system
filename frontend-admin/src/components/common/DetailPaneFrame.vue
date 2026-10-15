<template>
  <el-drawer :model-value="modelValue" :title="title" size="min(505px, 100vw)" :with-header="false" :close-on-press-escape="false" class="property-detail-pane is-mobile" destroy-on-close @update:model-value="$emit('update:modelValue',$event)">
    <slot />
  </el-drawer>
</template>
<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue';
const props=defineProps<{modelValue:boolean;title:string}>();
const emit=defineEmits<{ 'update:modelValue':[value:boolean] }>();
function escape(event:KeyboardEvent){
  // 弹窗与图片预览负责自己的 Escape，不能连同底层详情一起关闭。
  const nestedVisible=[...document.querySelectorAll('.el-overlay-dialog, .el-image-viewer__wrapper, .resource-drawer, .el-dropdown__popper, .el-select__popper')].some(element=>element.getClientRects().length>0);
  if(event.key==='Escape'&&props.modelValue&&!nestedVisible){event.preventDefault();event.stopPropagation();emit('update:modelValue',false);}
}
// 捕获阶段检查层级：图片预览在 document 阶段关闭后，不能继续关闭底层面板。
onMounted(()=>{window.addEventListener('keydown',escape,true);});
onUnmounted(()=>{window.removeEventListener('keydown',escape,true);});
</script>
<style src="@/styles/property-detail.css" />
