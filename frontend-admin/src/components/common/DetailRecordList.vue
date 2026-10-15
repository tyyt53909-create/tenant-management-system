<template>
  <div class="detail-record-list">
    <el-skeleton v-if="loading && !rows.length" :rows="5" animated />
    <div v-if="error" class="pane-error" role="alert"><strong>记录未能加载</strong><p>{{ error }}</p><el-button size="small" @click="load(requestedPage)">重新加载</el-button></div>
    <div v-if="!loading && !error && !rows.length" class="pane-empty">{{ empty }}</div>
    <ol v-if="kind==='audit' && rows.length" class="pane-timeline">
      <li v-for="row in rows" :key="row.id"><span class="timeline-dot" /><strong>{{ actionLabel(row.action) }}</strong><time>{{ formatDateTime(row.createdAt) }}</time><p>{{ row.user?.email || '系统记录' }}</p></li>
    </ol>
    <ol v-else-if="(kind==='payments' || kind==='readings') && rows.length" class="pane-timeline"><li v-for="row in rows" :key="row.id"><span class="timeline-dot" /><template v-if="kind==='payments'"><strong>{{ displayMoney(row.amount) }} · {{ paymentMethods[row.paymentMethod] || row.paymentMethod }}</strong><time>{{ formatDateTime(row.paidAt) }}</time><p>{{ row.notes || '未附收款备注' }}</p></template><template v-else><strong>读数 {{ row.currentReading }} {{ unit || '' }}</strong><time>{{ formatDateTime(row.readingTime) }}</time><p>上次 {{ row.previousReading }} · 用量 {{ row.usage }} {{ unit || '' }}</p><p v-if="row.notes">{{ row.notes }}</p></template></li></ol>
    <template v-else>
      <button v-for="row in rows" :key="row.id" class="pane-record" @click="$emit('select',row)">
        <span class="pane-record-heading"><strong>{{ kind==='contracts' ? row.contractNumber : row.billNumber }}</strong><span :class="['pane-status',stateTone(row.status)]">{{ stateLabel(row.status) }}</span></span>
        <template v-if="kind==='contracts'"><span class="pane-record-sub">{{ row.tenant?.name || '租客未关联' }} · {{ formatDateOnly(row.startDate) }} — {{ formatDateOnly(row.endDate) }}</span><span class="pane-record-bottom"><span>月租 {{ displayMoney(row.rentAmount) }}</span><span>查看合同 <el-icon><ArrowRight /></el-icon></span></span></template>
        <template v-else><span class="pane-record-sub">{{ row.period || '未记录账期' }} · 到期 {{ formatDateOnly(row.dueDate) }}</span><span class="pane-record-bottom"><span>应收 {{ displayMoney(row.amount) }}</span><span>已收 {{ displayMoney(row.paidAmount) }}</span></span></template>
      </button>
    </template>
    <p v-if="rows.length" class="pane-list-count">已显示 {{ rows.length }} / {{ total }} 条记录</p>
    <el-button v-if="page < totalPages" class="pane-load-more" plain :loading="loading" @click="load(page+1)">加载更多</el-button>
  </div>
</template>
<script setup lang="ts">
import { onUnmounted, ref, watch } from 'vue';
import { ArrowRight } from '@element-plus/icons-vue';
import request from '@/utils/request';
import { formatDateOnly, formatDateTime } from '@/utils/table';
import { displayMoney, stateTone } from '@/utils/propertyDetail';
import { stateLabel } from '@/utils/resource';
import type { ResourceRecord } from '@/utils/resource';
const props=defineProps<{url:string;params:Record<string,unknown>;kind:'contracts'|'bills'|'audit'|'payments'|'readings';empty:string;unit?:string}>();
defineEmits<{select:[row:ResourceRecord]}>();
const rows=ref<ResourceRecord[]>([]);const loading=ref(false);const error=ref('');const page=ref(0);const total=ref(0);const totalPages=ref(0);
let generation=0;let controller:AbortController|null=null;let requestedPage=1;
const paymentMethods:Record<string,string>={CASH:'现金',BANK_TRANSFER:'银行转账',WECHAT:'微信',ALIPAY:'支付宝',OTHER:'其他'};
async function load(target=1){
  requestedPage=target;
  const current=++generation;controller?.abort();controller=new AbortController();loading.value=true;error.value='';
  try{
    const result:any=await request.get(props.url,{params:{...props.params,page:target,limit:20},signal:controller.signal,silentError:true});
    const data=Array.isArray(result)?result:result.data;const meta=Array.isArray(result)?{total:result.length,totalPages:1}:result.meta;
    if(!Array.isArray(data)||!meta)throw new Error('记录响应格式不正确');
    if(current===generation){rows.value=target===1?data:[...rows.value,...data];page.value=target;total.value=meta.total;totalPages.value=meta.totalPages;}
  }catch{if(current===generation)error.value='请检查连接后重试，不会把加载失败当作空记录。';}
  finally{if(current===generation)loading.value=false;}
}
function actionLabel(action:string){const method=String(action).split(' ')[0];return ({POST:'新增记录',PATCH:'更新记录',PUT:'更新记录',DELETE:'删除记录'} as Record<string,string>)[method || ''] || action || '操作记录';}
watch(()=>`${props.url}:${JSON.stringify(props.params)}`,()=>{rows.value=[];page.value=0;total.value=0;totalPages.value=0;void load();},{immediate:true});
onUnmounted(()=>{generation++;controller?.abort();});
</script>
