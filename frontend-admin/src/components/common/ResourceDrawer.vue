<template>
  <el-drawer :model-value="modelValue" @update:model-value="$emit('update:modelValue',$event)" size="min(480px, 100vw)" :title="title" class="resource-drawer" destroy-on-close>
    <el-skeleton v-if="loading" :rows="8" animated />
    <div v-else-if="error" class="drawer-error" role="alert"><h3>详情暂时未能加载</h3><p>{{ error }}</p><el-button @click="load">重新加载</el-button></div>
    <template v-else-if="record"><div class="detail-hero"><span class="detail-symbol"><el-icon :size="25"><Document /></el-icon></span><div><h2>{{ recordLabel(resource,record) }}</h2><p>{{ record.status ? stateLabel(record.status) : '资料档案' }}</p></div></div>
      <el-tabs v-if="resource === 'tenants'" v-model="tenantActiveTab" class="resource-detail-tabs">
        <el-tab-pane label="基本资料" name="overview">
          <section v-for="section in sections" :key="section.title" class="detail-section">
            <h3>{{ section.title }}</h3>
            <dl>
              <div v-for="field in section.fields" :key="field.label">
                <dt>{{ field.label }}</dt>
                <dd>{{ field.value }}</dd>
              </div>
            </dl>
          </section>
        </el-tab-pane>

        <el-tab-pane label="租赁关联" name="contracts">
          <div v-if="record.contracts && record.contracts.length" class="drawer-contract-list">
            <div v-for="c in record.contracts" :key="c.id" class="drawer-contract-card">
              <div class="card-head">
                <strong>{{ c.room?.roomNumber || '关联房源' }}</strong>
                <el-tag size="small" :type="c.status === 'ACTIVE' ? 'success' : 'info'">{{ stateLabel(c.status) }}</el-tag>
              </div>
              <div class="card-line">合同编号：{{ c.contractNumber }}</div>
              <div class="card-line">租期：{{ c.startDate?.slice(0, 10) }} ~ {{ c.endDate?.slice(0, 10) }}</div>
            </div>
          </div>
          <div v-else class="drawer-empty-box">暂无生效或历史租约记录</div>
        </el-tab-pane>

        <el-tab-pane label="操作记录" name="audit">
          <div class="drawer-empty-box">操作记录请前往「审计日志」检索该租客档案的详细变更流水</div>
        </el-tab-pane>

        <el-tab-pane label="登入账号" name="account">
          <TenantAccountCapabilities :tenant-id="id" :tenant="record" :editable="editable" />
        </el-tab-pane>
      </el-tabs>

      <template v-else>
        <ContractAttachments v-if="resource === 'contracts'" :key="id" :contract-id="id" :editable="editable" />
        <section v-for="section in sections" :key="section.title" class="detail-section"><h3>{{ section.title }}</h3><dl><div v-for="field in section.fields" :key="field.label"><dt>{{ field.label }}</dt><dd>{{ field.value }}</dd></div></dl></section>
        <section v-if="record.photos?.length" class="detail-section"><h3>相关照片</h3><div class="detail-photos"><ProtectedImage v-for="photo in record.photos" :key="photo.id || photo.fileUrl || photo.url || photo" :url="typeof photo === 'string' ? photo : (photo.fileUrl || photo.url)" /></div></section>
      </template>
      <details class="record-reference"><summary>系统记录编号</summary><code>{{ record.id }}</code><el-button text size="small" @click="copy">复制编号</el-button></details>
    </template>
    <template #footer><el-button @click="$emit('update:modelValue',false)">关闭</el-button><el-button v-if="record && editable && !error" type="primary" @click="$emit('edit',record)">{{ resource === 'maintenance' ? '处理工单' : '编辑资料' }}</el-button><slot name="actions" :record="record" /></template>
  </el-drawer>
</template>
<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { Document } from '@element-plus/icons-vue';
import request from '@/utils/request';
import ProtectedImage from './ProtectedImage.vue';
import ContractAttachments from './ContractAttachments.vue';
import TenantAccountCapabilities from './TenantAccountCapabilities.vue';
import { detailSections, recordLabel, stateLabel } from '@/utils/resource';
import type { ResourceKind, ResourceRecord } from '@/utils/resource';
const props=withDefaults(defineProps<{modelValue:boolean;resource:ResourceKind;id:string;editable?:boolean}>(),{editable:true});
defineEmits<{ 'update:modelValue':[value:boolean];edit:[record:ResourceRecord] }>();
const titles:Record<ResourceKind,string>={rooms:'房源详情',tenants:'租客档案',contracts:'合同详情',bills:'账单详情',maintenance:'工单详情',meters:'水电表档案',checkout:'退租详情',buildings:'楼栋详情'};
const title=computed(()=>titles[props.resource]);const record=ref<ResourceRecord|null>(null);const loading=ref(false);const error=ref('');let generation=0;
const tenantActiveTab=ref('overview');
const sections=computed(()=>record.value?detailSections(props.resource,record.value):[]);
async function load(){const current=++generation;record.value=null;error.value='';loading.value=true;try{const data:any=await request.get(`/${props.resource}/${encodeURIComponent(props.id)}`);if(current===generation)record.value=data;}catch{if(current===generation)error.value='请检查网络连接或确认记录仍然存在。';}finally{if(current===generation)loading.value=false;}}
async function copy(){try{await navigator.clipboard.writeText(props.id);ElMessage.success('记录编号已复制');}catch{ElMessage.info('可选中编号手动复制');}}
watch(()=>[props.modelValue,props.id],()=>{if(props.modelValue&&props.id){tenantActiveTab.value='overview';void load();}else{generation++;record.value=null;}},{immediate:true});
</script>

<style scoped>
.resource-detail-tabs {
  margin-top: 12px;
}
.drawer-contract-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 8px 0;
}
.drawer-contract-card {
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 10px 12px;
  background: var(--bg-card);
}
.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}
.card-line {
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.5;
}
.drawer-empty-box {
  padding: 24px 16px;
  text-align: center;
  color: var(--text-muted);
  font-size: 12px;
}
</style>
