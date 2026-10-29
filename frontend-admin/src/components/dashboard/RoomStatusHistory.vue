<template>
  <section class="history-card" aria-labelledby="room-history-title">
    <div class="history-heading">
      <div><h2 id="room-history-title">历史房态</h2><p>按楼栋和业务日期查看已擷取的房态。</p></div>
      <el-button v-if="!open" @click="show">查看历史</el-button>
      <el-button v-else @click="close">返回</el-button>
    </div>
    <div v-if="open" class="history-content">
      <p v-if="buildingError" role="alert">{{ buildingError }} <el-button text @click="loadBuildings">重试</el-button></p>
      <div class="history-controls">
        <label>楼栋
          <select v-model="buildingId" :disabled="loadingBuildings" aria-label="历史房态楼栋">
            <option value="">请选择楼栋</option>
            <option v-for="building in buildings" :key="building.id" :value="building.id">{{ building.name }}</option>
          </select>
        </label>
        <label>业务日期 <input v-model="date" type="date" aria-label="历史房态业务日期" /></label>
        <el-button type="primary" :disabled="!buildingId || !date || loadingBuildings" :loading="loading" @click="loadHistory">查询</el-button>
      </div>
      <p v-if="loading" role="status">正在查询…</p>
      <p v-else-if="error" role="alert">{{ error }}</p>
      <p v-else-if="queried && !snapshot" class="history-empty">该日期未擷取。</p>
      <div v-else-if="snapshot" class="history-result" aria-live="polite">
        <p>擷取时间：{{ capturedAt }}（{{ timeZone }}）</p>
        <dl><div><dt>总房间</dt><dd>{{ snapshot.total }}</dd></div><div><dt>空置</dt><dd>{{ snapshot.vacant }}</dd></div><div><dt>已预订</dt><dd>{{ snapshot.reserved }}</dd></div><div><dt>已出租</dt><dd>{{ snapshot.occupied }}</dd></div><div><dt>维护中</dt><dd>{{ snapshot.maintenance }}</dd></div></dl>
      </div>
      <p v-else class="history-empty">选择楼栋和日期后查询；未擷取的日期不会补算。</p>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { getBuildings } from '@/api/buildings';
import { getRoomStatusHistory } from '@/api/dashboard';
import type { Building } from '@/types';
import type { components } from '@/types/api.generated';

type Snapshot = components['schemas']['RoomStatusSnapshotDto'];
const open = ref(false);
const buildings = ref<Building[]>([]);
const buildingId = ref('');
const date = ref('');
const loadingBuildings = ref(false);
const buildingError = ref('');
const loading = ref(false);
const error = ref('');
const queried = ref(false);
const snapshot = ref<Snapshot | null>(null);
let generation = 0;
let buildingGeneration = 0;
const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
const capturedAt = computed(() => snapshot.value ? new Date(snapshot.value.capturedAt).toLocaleString('zh-CN', { timeZoneName: 'short' }) : '');
function clearResult() { generation++; snapshot.value = null; queried.value = false; error.value = ''; loading.value = false; }
watch([buildingId, date], clearResult, { flush: 'sync' });
function close() { open.value = false; buildingGeneration++; clearResult(); }
async function show() { open.value = true; await loadBuildings(); }
async function loadBuildings() {
  const requestId = ++buildingGeneration;
  loadingBuildings.value = true; buildingError.value = '';
  try {
    const all: Building[] = [];
    let page = 1;
    let pages: number;
    do {
      const response = await getBuildings({ page, limit: 100 });
      all.push(...response.data);
      pages = response.meta.totalPages;
      page++;
    } while (page <= pages && requestId === buildingGeneration);
    if (requestId === buildingGeneration) buildings.value = all;
  } catch {
    if (requestId === buildingGeneration) { buildings.value = []; buildingError.value = '楼栋列表加载失败。'; }
  } finally { if (requestId === buildingGeneration) loadingBuildings.value = false; }
}
async function loadHistory() {
  if (!buildingId.value || !date.value) return;
  const requestId = ++generation;
  snapshot.value = null; queried.value = false; error.value = ''; loading.value = true;
  try {
    const result = await getRoomStatusHistory(buildingId.value, date.value);
    if (requestId === generation && open.value) { snapshot.value = result.snapshot; queried.value = true; }
  } catch {
    if (requestId === generation && open.value) error.value = '历史房态加载失败，请重试。';
  } finally { if (requestId === generation) loading.value = false; }
}
</script>

<style scoped>
.history-card{padding:24px;background:var(--bg-card);border:1px solid var(--border);border-radius:13px;box-shadow:0 18px 65px rgba(46,42,31,.043)}
.history-heading{display:flex;align-items:center;justify-content:space-between;gap:16px}.history-heading h2{font-size:14px;font-weight:650}.history-heading p,.history-empty,.history-result p{font-size:12px;color:var(--text-muted);line-height:1.6;margin-top:8px}.history-content{margin-top:18px}.history-controls{display:flex;gap:12px;flex-wrap:wrap;align-items:end}.history-controls label{display:flex;flex-direction:column;gap:6px;font-size:12px;color:var(--text-muted)}.history-controls select,.history-controls input{min-width:150px;height:32px;padding:0 10px;border:1px solid var(--border);border-radius:6px;background:var(--bg-card);color:var(--text-primary)}.history-content [role=alert]{color:var(--error-text);font-size:12px}.history-result dl{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px;margin:16px 0 0}.history-result dt{font-size:12px;color:var(--text-muted)}.history-result dd{font-size:20px;margin:6px 0 0;font-variant-numeric:tabular-nums}@media(max-width:600px){.history-result dl{grid-template-columns:repeat(3,minmax(0,1fr))}.history-card{padding:19px 16px}}
</style>
