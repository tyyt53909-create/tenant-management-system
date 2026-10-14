<template>
  <section class="contract-attachments detail-section">
    <div class="attachment-heading"><h3>合同扫描图片 <span v-if="items.length">{{ items.length }} 张</span></h3><el-button v-if="editable" size="small" type="primary" plain :loading="uploading" @click="input?.click()">上传合同图片</el-button></div>
    <input ref="input" type="file" accept="image/jpeg,image/png,image/webp" multiple hidden aria-label="选择合同图片" @change="upload" />
    <p class="attachment-hint">{{ editable ? '支持 JPG、PNG、WebP，单张不超过 10MB；上传后保存到本合同。' : '点击图片查看合同原件。' }}</p>
    <el-skeleton v-if="loading" :rows="2" animated />
    <div v-else-if="error" class="attachment-error" role="alert">{{ error }} <el-button text size="small" @click="load">重新加载</el-button></div>
    <div v-else-if="items.length" class="contract-image-grid"><figure v-for="(item,index) in items" :key="item.id"><ProtectedImage :url="item.downloadUrl" fit="contain" :label="`放大合同第 ${index + 1} 页：${item.fileName}`" /><figcaption><strong>第 {{ index + 1 }} 页</strong><span :title="item.fileName">{{ item.fileName }}</span></figcaption></figure></div>
    <div v-else class="attachment-empty">{{ editable ? '尚未上传合同图片。点击右上方上传签字页或扫描件。' : '管理者尚未上传合同扫描图片。' }}</div>
    <p v-if="progress" class="attachment-progress" role="status">{{ progress }}</p>
    <ul v-if="failures.length" class="attachment-failures" role="alert"><li v-for="message in failures" :key="message">{{ message }}</li></ul>
  </section>
</template>
<script setup lang="ts">
import { onUnmounted, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import request from '@/utils/request';
import ProtectedImage from './ProtectedImage.vue';
interface Attachment { id:string;fileName:string;downloadUrl:string;fileSize:number }
const props=withDefaults(defineProps<{contractId:string;editable?:boolean}>(),{editable:true});
const input=ref<HTMLInputElement>();
const items=ref<Attachment[]>([]);
const loading=ref(false);
const uploading=ref(false);
const error=ref('');
const progress=ref('');
const failures=ref<string[]>([]);
let generation=0;
let active=true;

async function load(){
  const current=++generation;
  loading.value=true;error.value='';
  try{
    const data:any=await request.get(`/contracts/${encodeURIComponent(props.contractId)}/attachments`,{silentError:true});
    if(!Array.isArray(data))throw new Error('附件响应格式不正确');
    if(current===generation&&active)items.value=data;
  }catch{
    if(current===generation&&active)error.value='合同图片未能加载，请检查连接后重试。';
  }finally{
    if(current===generation&&active)loading.value=false;
  }
}

async function upload(event:Event){
  const target=event.target as HTMLInputElement;
  const files=Array.from(target.files||[]);
  target.value='';
  if(!props.editable||!files.length||uploading.value)return;
  const id=props.contractId;
  uploading.value=true;failures.value=[];
  let saved=0;
  try{
    for(const [index,file] of files.entries()){
      if(!active||id!==props.contractId)break;
      if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>10*1024*1024){
        failures.value.push(`${file.name}：仅支持 JPG、PNG、WebP，单张不超过 10MB。`);
        continue;
      }
      progress.value=`正在保存第 ${index+1}/${files.length} 张，请稍候…`;
      const form=new FormData();form.append('file',file);
      try{
        await request.post(`/contracts/${encodeURIComponent(id)}/attachments`,form,{headers:{'Content-Type':'multipart/form-data'},timeout:60000,silentError:true});
        saved++;
      }catch(error:any){
        if(active&&id===props.contractId)failures.value.push(`${file.name}：${error.response?.data?.message || '未确认保存，请刷新列表核对后再上传。'}`);
      }
    }
    if(!active||id!==props.contractId)return;
    progress.value=`已保存 ${saved} 张${failures.value.length?`，${failures.value.length} 张未成功。`:''}`;
    if(saved)ElMessage.success('合同图片已保存');
    await load();
  }finally{
    uploading.value=false;
  }
}

watch(()=>props.contractId,()=>{items.value=[];progress.value='';failures.value=[];void load();},{immediate:true});
onUnmounted(()=>{active=false;generation++;});
</script>
<style scoped>.attachment-failures{padding-left:18px;color:#98634c;font-size:11px;line-height:1.8;overflow-wrap:anywhere}</style>
