<template><div class="protected-image"><el-image v-if="src" ref="image" :src="src" :preview-src-list="[src]" :fit="fit" :alt="label" role="button" tabindex="0" :aria-label="label" preview-teleported @keydown.enter.prevent="image?.showPreview()" @keydown.space.prevent="image?.showPreview()" @error="imageFailed" /><span v-else-if="loading">加载照片…</span><button v-else @click="load">{{ failure }} · 重试</button></div></template>
<script setup lang="ts">
import { ref, watch, onUnmounted } from 'vue';
import request from '@/utils/request';
import { protectedFilePath } from '@/utils/resource';
const props=withDefaults(defineProps<{url:string;fit?:'cover'|'contain';label?:string}>(),{fit:'cover',label:'查看照片原图'});const image=ref<{showPreview:()=>void}>();const src=ref('');const loading=ref(false);const failure=ref('照片未能加载');let controller:AbortController|null=null;
function clear(){controller?.abort();if(src.value)URL.revokeObjectURL(src.value);src.value='';}
function imageFailed(){clear();failure.value='图片内容无法显示';}
async function load(){clear();const path=protectedFilePath(props.url);if(!path)return;const current=new AbortController();controller=current;loading.value=true;failure.value='照片未能加载';try{const blob:any=await request.get(path,{responseType:'blob',signal:current.signal,silentError:true});if(!current.signal.aborted)src.value=URL.createObjectURL(blob);}catch(error:any){if(!current.signal.aborted&&error.response?.status===404)failure.value='原文件缺失或不可访问';}finally{if(controller===current)loading.value=false;}}
watch(()=>props.url,load,{immediate:true});onUnmounted(clear);
</script>
<style scoped>
.protected-image > button{width:100%;height:100%;padding:12px;white-space:normal;overflow-wrap:anywhere;line-height:1.7;}
.protected-image :deep(.el-image:focus-visible){outline:2px solid #535b43;outline-offset:-2px;}
</style>
