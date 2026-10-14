<template>
  <DetailPaneFrame :model-value="modelValue" :title="kind==='rooms' ? '房源详情' : '合同详情'" @update:model-value="$emit('update:modelValue',$event)">
    <div class="property-pane-layout">
      <button class="pane-close" aria-label="关闭详情面板" @click="$emit('update:modelValue',false)"><el-icon><Close /></el-icon></button>
      <div v-if="loading" class="pane-scroll pane-loading"><div class="pane-cover-skeleton"/><el-skeleton :rows="9" animated /></div>
      <div v-else-if="error" class="pane-scroll pane-error" role="alert"><h2>详情未能加载</h2><p>{{ error }}</p><el-button @click="load">重新加载</el-button></div>
      <div v-else-if="record" ref="scrollArea" class="pane-scroll">
        <div :class="['pane-cover',{'no-photo':!photos.length}]">
          <ProtectedImage v-if="photos.length" :url="photos[photoIndex].fileUrl" :label="`放大房源照片 ${photoIndex+1}`" />
          <div v-else class="pane-cover-empty"><el-icon :size="34"><House /></el-icon><strong>尚未添加房源照片</strong><span>只展示实际房源图片，不使用样板照片。</span></div>
          <div v-if="photos.length" class="pane-photo-controls"><button v-if="photos.length>1" aria-label="上一张房源照片" @click="photoIndex=(photoIndex-1+photos.length)%photos.length"><el-icon><ArrowLeft /></el-icon></button><span><el-icon><Picture /></el-icon>{{ photoIndex+1 }} / {{ photos.length }}</span><button v-if="photos.length>1" aria-label="下一张房源照片" @click="photoIndex=(photoIndex+1)%photos.length"><el-icon><ArrowRight /></el-icon></button></div>
        </div>
        <header class="pane-identity"><div><h2>{{ kind==='rooms' ? record.roomNumber : record.contractNumber }}</h2><p>{{ room.building?.name || record.building?.name || '楼栋未关联' }} · {{ kind==='contracts' ? `${room.roomNumber || '房源未关联'} · ` : '' }}{{ ROOM_TYPES[room.roomType] || '房型未记录' }}</p></div><span :class="['pane-status',stateTone(record.status)]">{{ stateLabel(record.status) }}</span></header>
        <div class="pane-tabs" role="tablist" :aria-label="kind==='rooms' ? '房源详情分页' : '合同详情分页'">
          <button v-for="(tab,index) in tabs" :id="`${uid}-${tab.id}`" :key="tab.id" role="tab" :aria-selected="activeTab===tab.id" :aria-controls="`${uid}-content-${tab.id}`" :tabindex="activeTab===tab.id ? 0 : -1" :class="{active:activeTab===tab.id}" @click="activate(tab.id)" @keydown="tabKey($event,index)">{{ tab.label }}</button>
        </div>
        <div v-for="tab in tabs" v-show="activeTab===tab.id" :id="`${uid}-content-${tab.id}`" :key="tab.id" class="pane-tab-content" role="tabpanel" :aria-labelledby="`${uid}-${tab.id}`" tabindex="0">
          <template v-if="tab.id==='overview'">
            <template v-if="kind==='rooms'">
              <section class="pane-section"><div class="pane-section-heading"><h3>房源信息</h3><el-button size="small" plain @click="$emit('edit',record)">编辑</el-button></div><dl class="pane-fact-grid"><div v-for="field in fields" :key="field.label"><el-icon><component :is="factIcons[field.icon]" /></el-icon><dt>{{ field.label }}</dt><dd>{{ field.value }}</dd></div></dl></section>
              <section class="pane-section"><h3>当前状态</h3><div class="pane-state-grid"><div :class="['pane-state-card',stateTone(room.status)]"><el-icon><House /></el-icon><div><small>房态</small><strong>{{ stateLabel(room.status) }}</strong></div></div><div :class="['pane-state-card',stateTone(room.cleanStatus)]"><el-icon><CircleCheck /></el-icon><div><small>清洁状态</small><strong>{{ stateLabel(room.cleanStatus) }}</strong></div></div></div></section>
              <section class="pane-section"><div class="pane-section-heading"><h3>租约信息</h3><button class="pane-text-link" @click="activate('leases')">全部租约 <el-icon><ArrowRight /></el-icon></button></div><el-skeleton v-if="leaseLoading" :rows="3" animated /><div v-else-if="leaseError" class="pane-error" role="alert"><p>{{ leaseError }}</p><el-button text @click="load">重新加载</el-button></div><template v-else-if="lease"><dl class="pane-line-list"><div><dt><el-icon><User /></el-icon>租客</dt><dd>{{ lease.tenant?.name || '未关联' }}</dd></div><div><dt><el-icon><Document /></el-icon>合同编号</dt><dd><button class="pane-text-link" @click="openContract(lease.id)">{{ lease.contractNumber }} <el-icon><ArrowRight /></el-icon></button></dd></div><div><dt><el-icon><Calendar /></el-icon>{{ lease.status==='DRAFT' ? '预计入住' : '租约起始' }}</dt><dd>{{ formatDateOnly(lease.startDate) }}</dd></div><div><dt><el-icon><Clock /></el-icon>租约到期</dt><dd>{{ formatDateOnly(lease.endDate) }}</dd></div><div><dt><el-icon><Money /></el-icon>月租金</dt><dd>{{ displayMoney(lease.rentAmount) }}</dd></div></dl><p v-if="lease.status==='DRAFT'" class="pane-note">当前为预订关联的草稿合同，尚未生效。</p></template><div v-else class="pane-empty">暂无当前租约。历史合同可在「租约信息」中查看。</div></section>
              <section v-if="room.facilities?.length || room.description" class="pane-section"><h3>居住设施与备注</h3><div v-if="Array.isArray(room.facilities)" class="pane-facilities"><span v-for="facility in room.facilities" :key="facility">{{ facility }}</span></div><p v-if="room.description" class="pane-note">{{ room.description }}</p></section>
            </template>
            <template v-else>
              <section class="pane-section"><h3>租客信息</h3><div class="pane-resident"><span class="pane-resident-avatar">{{ record.tenant?.name?.slice(0,1) || '租' }}</span><div><strong>{{ record.tenant?.name || '租客未关联' }}</strong><p><el-icon><Phone /></el-icon>{{ record.tenant?.phone || '未记录联系电话' }}</p></div><button class="pane-text-link" @click="activate('tenant')">资料 <el-icon><ArrowRight /></el-icon></button></div></section>
              <section class="pane-section"><h3>房源信息</h3><button class="pane-related-room" @click="openRoom"><span class="pane-room-symbol"><el-icon :size="24"><House /></el-icon></span><span><strong>{{ room.building?.name || record.building?.name || '房源' }} · {{ room.roomNumber || '未关联' }}</strong><small>{{ ROOM_TYPES[room.roomType] || '房型未记录' }}{{ room.area == null ? '' : ` · ${room.area} m²` }}</small></span><el-icon><ArrowRight /></el-icon></button></section>
              <section class="pane-section"><h3>合同条款</h3><dl class="pane-line-list"><div><dt>合同编号</dt><dd>{{ record.contractNumber }}</dd></div><div><dt>合同期限</dt><dd>{{ formatDateOnly(record.startDate) }} — {{ formatDateOnly(record.endDate) }}</dd></div><div><dt><el-icon><Money /></el-icon>月租金额</dt><dd>{{ displayMoney(record.rentAmount) }}</dd></div><div><dt><el-icon><Lock /></el-icon>押金金额</dt><dd>{{ displayMoney(record.depositAmount) }}</dd></div><div><dt><el-icon><Wallet /></el-icon>付款方式</dt><dd>{{ PAYMENT_CYCLES[record.paymentCycle] || '—' }}</dd></div><div><dt><el-icon><Calendar /></el-icon>每期缴付日</dt><dd>{{ record.paymentDay == null ? '—' : `每月 ${record.paymentDay} 日` }}</dd></div></dl></section>
              <section class="pane-section"><h3>重要提醒</h3><div :class="['pane-reminder',reminder.tone]"><el-icon :size="20"><Calendar /></el-icon><div><strong>{{ reminder.title }}</strong><p>{{ reminder.text }}</p></div></div><button v-if="record.renewedTo" class="pane-text-link pane-renewed-link" @click="openContract(record.renewedTo.id)">查看续签合同 {{ record.renewedTo.contractNumber }} <el-icon><ArrowRight /></el-icon></button></section>
              <section class="pane-section"><div class="pane-section-heading"><h3>合同扫描图片</h3><button class="pane-text-link" @click="activate('files')">查看 / 上传 <el-icon><ArrowRight /></el-icon></button></div><p class="pane-note">签字页与扫描件归档于本合同，仅管理者及对应租客可查看。</p></section>
            </template>
            <section class="pane-section pane-record-meta"><dl class="pane-line-list"><div><dt>最近更新</dt><dd>{{ formatDateTime(record.updatedAt) }}</dd></div></dl><details><summary>系统记录编号</summary><code>{{ record.id }}</code></details></section>
          </template>
          <template v-else-if="tab.id==='leases' && activeTab==='leases'"><section class="pane-section"><h3>本房源租约</h3><p class="pane-note">当前与历史合同均保留。点击合同可查看条款和扫描件。</p><DetailRecordList url="/contracts" :params="{roomId:record.id}" kind="contracts" empty="此房源尚未建立合同。" @select="row=>openContract(row.id)" /></section></template>
          <template v-else-if="tab.id==='tenant'"><section class="pane-section"><h3>租客档案</h3><dl class="pane-line-list"><div v-for="field in tenantFields" :key="field.label"><dt>{{ field.label }}</dt><dd>{{ field.value || '—' }}</dd></div></dl></section></template>
          <template v-else-if="tab.id==='room'"><section class="pane-section"><div class="pane-section-heading"><h3>关联房源</h3><button class="pane-text-link" @click="openRoom">查看房源 <el-icon><ArrowRight /></el-icon></button></div><dl class="pane-fact-grid"><div v-for="field in fields" :key="field.label"><el-icon><component :is="factIcons[field.icon]" /></el-icon><dt>{{ field.label }}</dt><dd>{{ field.value }}</dd></div></dl><div class="pane-state-grid"><div :class="['pane-state-card',stateTone(room.status)]"><small>房态</small><strong>{{ stateLabel(room.status) }}</strong></div><div :class="['pane-state-card',stateTone(room.cleanStatus)]"><small>清洁状态</small><strong>{{ stateLabel(room.cleanStatus) }}</strong></div></div></section></template>
          <template v-else-if="tab.id==='bills' && activeTab==='bills'"><section class="pane-section"><h3>账单记录</h3><p class="pane-note">{{ kind==='rooms' ? '以下为当前租约的账单；历史账单请从租约信息进入对应合同。' : '仅展示与本合同关联的账单，金额单位为元。' }}</p><el-skeleton v-if="leaseLoading" :rows="3" animated /><div v-else-if="leaseError" class="pane-error" role="alert">{{ leaseError }}<el-button text @click="load">重新加载</el-button></div><DetailRecordList v-else-if="billContractId" url="/bills" :params="{contractId:billContractId}" kind="bills" empty="该合同尚未生成账单。" @select="row=>{billId=row.id;billVisible=true}" /><div v-else class="pane-empty">暂无当前租约，请从「租约信息」选择历史合同查看账单。</div></section></template>
          <template v-else-if="tab.id==='audit' && activeTab==='audit'"><section class="pane-section"><h3>房源操作记录</h3><DetailRecordList url="/audit-logs" :params="{entityType:'rooms',entityId:record.id}" kind="audit" empty="尚无此房源的操作记录。" /></section></template>
          <template v-else-if="tab.id==='files' && filesVisited"><ContractAttachments :key="record.id" :contract-id="record.id" /></template>
        </div>
      </div>
      <footer v-if="record && !error && !loading" class="pane-actions"><h3>快捷操作</h3><div v-if="kind==='rooms'"><el-button @click="activate('leases')">租约记录</el-button><el-button @click="$emit('edit',record)">编辑房源</el-button><el-button type="primary" @click="$emit('status',record)">房态变更</el-button></div><div v-else><el-button @click="$emit('edit',record)">编辑合同</el-button><el-button :disabled="!renewable" :title="renewable ? '基于此合同生成续签草稿' : '此合同当前不可续签'" @click="$emit('renew',record)">发起续签</el-button><el-button type="primary" @click="activate('files')"><el-icon><Document /></el-icon>合同图片</el-button></div></footer>
    </div>
  </DetailPaneFrame>
  <ResourceDrawer v-model="billVisible" resource="bills" :id="billId" :editable="false" />
</template>
<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, useId, watch } from 'vue';
import { useRouter } from 'vue-router';
import { House, Close, ArrowLeft, ArrowRight, Picture, OfficeBuilding, Rank, FullScreen, Money, Document, User, Phone, Calendar, Clock, CircleCheck, Lock, Wallet } from '@element-plus/icons-vue';
import request from '@/utils/request';
import { formatDateOnly,formatDateTime } from '@/utils/table';
import { stateLabel } from '@/utils/resource';
import type { ResourceRecord } from '@/utils/resource';
import { contractReminder,currentLeaseQuery,detailTabs,displayMoney,PAYMENT_CYCLES,propertyPhotos,roomFacts,ROOM_TYPES,stateTone } from '@/utils/propertyDetail';
import type { PropertyKind } from '@/utils/propertyDetail';
import DetailPaneFrame from './DetailPaneFrame.vue';
import DetailRecordList from './DetailRecordList.vue';
import ProtectedImage from './ProtectedImage.vue';
import ContractAttachments from './ContractAttachments.vue';
import ResourceDrawer from './ResourceDrawer.vue';

const props=defineProps<{modelValue:boolean;kind:PropertyKind;id:string;canRenew?:(row:ResourceRecord)=>boolean}>();
defineEmits<{ 'update:modelValue':[value:boolean];edit:[record:ResourceRecord];status:[record:ResourceRecord];renew:[record:ResourceRecord] }>();
const router=useRouter();const uid=useId();
const record=ref<ResourceRecord|null>(null);const loading=ref(false);const error=ref('');
const lease=ref<ResourceRecord|null>(null);const leaseLoading=ref(false);const leaseError=ref('');
const activeTab=ref('overview');const filesVisited=ref(false);const photoIndex=ref(0);const scrollArea=ref<HTMLElement>();
const billId=ref('');const billVisible=ref(false);
let generation=0;let controller:AbortController|null=null;
const tabs=computed(()=>detailTabs(props.kind));
const room=computed(()=>props.kind==='rooms' ? record.value || {} : record.value?.room || {});
const photos=computed(()=>propertyPhotos(props.kind,record.value));
const fields=computed(()=>roomFacts(room.value,props.kind==='contracts' ? record.value : lease.value).map(field=>field.label==='租约月租'&&leaseLoading.value ? {...field,value:'加载租约…'} : field.label==='租约月租'&&leaseError.value ? {...field,value:'暂时不可用'} : field));
const reminder=computed(()=>contractReminder(record.value || {}));
const renewable=computed(()=>!!record.value && !record.value.renewedTo && !!props.canRenew?.(record.value));
const billContractId=computed(()=>props.kind==='contracts' ? record.value?.id : lease.value?.id);
const factIcons:Record<string,any>={building:OfficeBuilding,floor:Rank,house:House,area:FullScreen,money:Money,number:Document};
const tenantFields=computed(()=>{const tenant=record.value?.tenant || {};return [{label:'姓名',value:tenant.name},{label:'联系电话',value:tenant.phone},{label:'邮箱',value:tenant.email},{label:'紧急联系人',value:tenant.emergencyContact},{label:'紧急联系电话',value:tenant.emergencyPhone}];});

async function load(){
  if(!props.modelValue||!props.id)return;
  const current=++generation;controller?.abort();controller=new AbortController();
  const signal=controller.signal;
  loading.value=true;error.value='';record.value=null;lease.value=null;leaseError.value='';leaseLoading.value=false;photoIndex.value=0;
  try{
    const data:any=await request.get(`/${props.kind}/${encodeURIComponent(props.id)}`,{signal,silentError:true});
    if(current!==generation)return;
    record.value=data;
    if(props.kind==='rooms'){
      leaseLoading.value=true;
      request.get('/contracts',{params:currentLeaseQuery(data),signal,silentError:true}).then((result:any)=>{
        if(!Array.isArray(result.data))throw new Error('租约响应格式不正确');
        if(current===generation)lease.value=result.data[0] || null;
      }).catch(()=>{if(current===generation)leaseError.value='当前租约暂时未能加载，请重试。';}).finally(()=>{if(current===generation)leaseLoading.value=false;});
    }
  }catch{if(current===generation)error.value='请检查连接或确认记录仍然存在。';}
  finally{if(current===generation)loading.value=false;}
}
function activate(tab:string){activeTab.value=tab;if(tab==='files')filesVisited.value=true;scrollArea.value?.scrollTo({top:0,behavior:'instant'});}
async function tabKey(event:KeyboardEvent,index:number){
  if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
  event.preventDefault();const last=tabs.value.length-1;
  const target=event.key==='Home'?0:event.key==='End'?last:(index+(event.key==='ArrowRight'?1:-1)+tabs.value.length)%tabs.value.length;
  activate(tabs.value[target]!.id);await nextTick();document.getElementById(`${uid}-${activeTab.value}`)?.focus();
}
function openContract(id:string){void router.push({path:'/contracts',query:{detail:id}});}
function openRoom(){if(record.value?.roomId)void router.push({path:'/rooms',query:{detail:record.value.roomId}});}
watch(()=>[props.modelValue,props.id,props.kind],()=>{
  generation++;controller?.abort();record.value=null;activeTab.value='overview';filesVisited.value=false;billVisible.value=false;
  if(props.modelValue&&props.id)void load();
},{immediate:true});
onUnmounted(()=>{generation++;controller?.abort();});
defineExpose({reload:load});
</script>
