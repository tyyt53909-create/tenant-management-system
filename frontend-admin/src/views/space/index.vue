<template>
  <div class="space-page">
    <section class="space-controlbar">
      <div class="space-controlbar-title">
        <strong>{{ model?.building.name || '房源模型' }}</strong>
        <span v-if="model">{{ model.summary.total }} 间 · {{ model.floors.length }} 层</span>
      </div>
      <div class="space-controlbar-actions">
        <el-select
          v-model="buildingId"
          placeholder="选择楼栋"
          filterable
          class="space-building-select"
          :loading="buildingsLoading"
          @change="loadSpace"
        >
          <el-option
            v-for="building in buildings"
            :key="building.id"
            :label="building.name"
            :value="building.id"
          >
            <span>{{ building.name }}</span>
            <small class="space-option-meta">{{ building.floors || building.totalFloors }} 层</small>
          </el-option>
        </el-select>
        <el-button :loading="spaceLoading" @click="loadSpace">刷新</el-button>
      </div>
    </section>

    <section v-if="model" class="space-summary" aria-label="房源状态摘要">
      <article
        v-for="item in summaryItems"
        :key="item.state"
        class="space-summary-card"
        :style="{ '--summary-color': item.meta.color, '--summary-soft': item.meta.soft }"
      >
        <span>{{ item.meta.label }}</span>
        <strong>{{ item.value }}<small>间</small></strong>
        <p>{{ item.meta.description }}</p>
      </article>
    </section>

    <section class="space-stage-panel">
      <header class="space-stage-head">
        <div class="space-mode-switch" role="group" aria-label="显示模式">
          <button
            :class="{ active: mode === '2d' }"
            :aria-pressed="mode === '2d'"
            @click="setMode('2d')"
          >
            2D 剖面
          </button>
          <button
            :class="{ active: mode === '3d' }"
            :aria-pressed="mode === '3d'"
            @click="setMode('3d')"
          >
            3D 模型
          </button>
        </div>

      </header>

      <div v-if="buildingsLoading || spaceLoading" class="space-loading" aria-busy="true">
        <div class="space-loading-stage" />
        <p>正在读取楼栋与空间模型…</p>
      </div>

      <div v-else-if="loadError" class="space-error" role="alert">
        <strong>空间模型未能加载</strong>
        <p>{{ loadError }}</p>
        <el-button @click="loadSpace">重新加载</el-button>
      </div>

      <div v-else-if="!buildings.length" class="space-empty">
        <strong>还没有楼栋</strong>
        <p>先到「楼栋管理」建立楼栋与房源，空间模型会自动生成。</p>
        <el-button type="primary" @click="router.push('/buildings')">前往楼栋管理</el-button>
      </div>

      <div v-else-if="model && model.summary.total === 0" class="space-empty">
        <strong>{{ model.building.name }} 还没有房源</strong>
        <p>这栋楼目前只有楼层骨架。新增房源后，房间会直接出现在模型里。</p>
        <el-button type="primary" @click="router.push('/rooms')">前往房源管理</el-button>
      </div>

      <template v-else-if="model">
        <div class="space-legend" aria-label="房态图例">
          <button
            v-for="item in legendItems"
            :key="item.state"
            class="space-legend-item"
            :class="{ 'is-muted': item.value === 0 }"
            type="button"
            @click="focusLegend(item.state)"
          >
            <i :style="{ background: item.meta.color }" />
            <span>{{ item.meta.label }}</span>
            <strong>{{ item.value }}</strong>
          </button>
        </div>

        <SpacePlan2DContract
          v-if="mode === '2d'"
          :model="model"
          :selected-id="selectedRoomId"
          @select="openRoom"
        />
        <SpaceScene3DContract
          v-else
          :model="model"
          :selected-id="selectedRoomId"
          @select="openRoom"
          @unsupported="handleUnsupported"
        />

        <footer class="space-stage-foot">
          <span v-if="mode === '2d'">按楼层排列的示意或平面图；AUTHORED 楼层的方位来自平面图资料。</span>
          <span v-else>等轴模型用于观察楼层与房间状态；可拖拽旋转、滚轮缩放。</span>
        </footer>
      </template>
    </section>

    <PropertyDetailPanel
      v-model="detailVisible"
      kind="rooms"
      :id="selectedRoomId"
      @edit="handleEdit"
      @status="handleStatus"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { getBuildings } from '@/api/buildings';
import { getBuildingSpace } from '@/api/space';
import type { Building } from '@/types';
import type { SpaceModelContract, SpaceRoomContract, SpaceState } from '@/types/space';
import type { ResourceRecord } from '@/utils/resource';
import { SPACE_STATE_META, SPACE_STATE_ORDER } from '@/utils/spaceModel';
import SpacePlan2DContract from '@/components/space/SpacePlan2DContract.vue';
import PropertyDetailPanel from '@/components/common/PropertyDetailPanel.vue';

const SpaceScene3DContract = defineAsyncComponent(
  () => import('@/components/space/SpaceScene3DContract.vue'),
);

type BuildingWithFloors = Building & { floors?: number };

const router = useRouter();
const route = useRoute();

const buildings = ref<BuildingWithFloors[]>([]);
const buildingId = ref('');
const model = ref<SpaceModelContract | null>(null);
const buildingsLoading = ref(false);
const spaceLoading = ref(false);
const loadError = ref('');
const mode = ref<'2d' | '3d'>('3d');
const selectedRoomId = ref('');
const detailVisible = ref(false);

let spaceRequest = 0;

const summaryItems = computed(() => {
  if (!model.value) return [];
  const summary = model.value.summary;
  return [
    { state: 'OCCUPIED' as SpaceState, value: summary.occupied, meta: SPACE_STATE_META.OCCUPIED },
    { state: 'RENTABLE' as SpaceState, value: summary.rentable, meta: SPACE_STATE_META.RENTABLE },
    { state: 'PENDING_CLEAN' as SpaceState, value: summary.pendingClean, meta: SPACE_STATE_META.PENDING_CLEAN },
    { state: 'CLEANING' as SpaceState, value: summary.cleaning, meta: SPACE_STATE_META.CLEANING },
    { state: 'MAINTENANCE' as SpaceState, value: summary.maintenance, meta: SPACE_STATE_META.MAINTENANCE },
  ];
});

const legendItems = computed(() => {
  if (!model.value) return [];
  const summary = model.value.summary;
  const values: Record<SpaceState, number> = {
    OCCUPIED: summary.occupied,
    RESERVED: summary.reserved,
    RENTABLE: summary.rentable,
    PENDING_CLEAN: summary.pendingClean,
    CLEANING: summary.cleaning,
    MAINTENANCE: summary.maintenance,
    UNKNOWN: summary.unknown,
  };
  return SPACE_STATE_ORDER.filter((state) => state !== 'UNKNOWN' || values[state] > 0).map(
    (state) => ({ state, value: values[state], meta: SPACE_STATE_META[state] }),
  );
});

async function loadBuildings() {
  buildingsLoading.value = true;
  loadError.value = '';
  try {
    const response = await getBuildings({ page: 1, limit: 100 });
    buildings.value = (response.data as BuildingWithFloors[]).filter(
      (building) => building.isActive !== false,
    );
    const queryId = typeof route.query.building === 'string' ? route.query.building : '';
    const preferred = buildings.value.find((building) => building.id === queryId);
    buildingId.value = preferred?.id || buildings.value[0]?.id || '';
    await loadSpace();
  } catch {
    loadError.value = '请检查连接后重试；空间模型不会显示旧的楼栋数据。';
  } finally {
    buildingsLoading.value = false;
  }
}

async function loadSpace() {
  if (!buildingId.value) {
    model.value = null;
    return;
  }
  const requestId = ++spaceRequest;
  spaceLoading.value = true;
  loadError.value = '';
  try {
    const result = await getBuildingSpace(buildingId.value);
    if (requestId !== spaceRequest) return;
    model.value = result;
  } catch {
    if (requestId !== spaceRequest) return;
    model.value = null;
    loadError.value = '空间模型未能加载，请确认后端已更新并稍后重试。';
  } finally {
    if (requestId === spaceRequest) spaceLoading.value = false;
  }
}

function openRoom(room: Pick<SpaceRoomContract, 'id'>) {
  selectedRoomId.value = room.id;
  detailVisible.value = true;
}

function handleEdit(record: ResourceRecord) {
  const id = record.id;
  if (typeof id === 'string' && id) {
    void router.push({ path: '/rooms', query: { detail: id } });
  }
}

function handleStatus(record: ResourceRecord) {
  const id = record.id;
  if (typeof id === 'string' && id) {
    // 空間 API 只回傳投影狀態；房態操作回到房源頁的既有詳情/流轉流程。
    void router.push({ path: '/rooms', query: { detail: id } });
  }
}

function setMode(nextMode: '2d' | '3d') {
  mode.value = nextMode;
}

function focusLegend(state: SpaceState) {
  const first = model.value?.floors
    .flatMap((floor) => floor.rooms)
    .find((room) => room.state === state);
  if (first) openRoom(first);
}

function handleUnsupported() {
  mode.value = '2d';
}

watch(
  () => buildingId.value,
  () => {
    selectedRoomId.value = '';
    detailVisible.value = false;
    if (typeof route.query.building === 'string' && route.query.building !== buildingId.value) {
      void router.replace({ query: { ...route.query, building: buildingId.value } });
    }
  },
);

onMounted(() => {
  void loadBuildings();
});
</script>

<style scoped>
.space-page {
  display: grid;
  gap: 16px;
}

.space-controlbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-height: 40px;
}

.space-controlbar-title {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}

.space-controlbar-title strong {
  overflow: hidden;
  color: #36362f;
  font-size: 14px;
  font-weight: 600;
  letter-spacing: -0.01em;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.space-controlbar-title span {
  color: #948d80;
  font-size: 10px;
  white-space: nowrap;
}

.space-controlbar-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.space-building-select {
  width: 220px;
}

.space-option-meta {
  float: right;
  color: #9b9488;
  font-size: 10px;
}

.space-summary {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 8px;
}

.space-summary-card {
  position: relative;
  min-width: 0;
  padding: 10px 12px 9px;
  overflow: hidden;
  border: 1px solid #e9e4da;
  border-radius: 9px;
  background: #fffefa;
}

.space-summary-card:before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 3px;
  background: var(--summary-color, #8b9a7e);
}

.space-summary-card > span {
  color: #827b6e;
  font-size: 10px;
}

.space-summary-card strong {
  display: block;
  margin-top: 4px;
  color: #302f2a;
  font-size: 21px;
  font-weight: 650;
  letter-spacing: -0.04em;
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
}

.space-summary-card strong small {
  margin-left: 3px;
  color: #928b7e;
  font-size: 9px;
  font-weight: 400;
  letter-spacing: 0;
}

.space-summary-card p {
  display: none;
}

.space-stage-panel {
  min-width: 0;
  overflow: hidden;
  border: 1px solid #e9e4da;
  border-radius: 12px;
  background: #fffefa;
}

.space-stage-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 13px 16px;
  border-bottom: 1px solid #eeeae1;
}

.space-mode-switch {
  display: inline-flex;
  gap: 3px;
  padding: 3px;
  border: 1px solid #e5dfd3;
  border-radius: 8px;
  background: #f7f4ed;
}

.space-mode-switch button {
  border: 0;
  border-radius: 6px;
  background: transparent;
  padding: 7px 11px;
  color: #817a6e;
  font-size: 11px;
  font-weight: 550;
  transition:
    background 0.18s ease,
    color 0.18s ease,
    box-shadow 0.18s ease;
}

.space-mode-switch button.active {
  background: #fffefa;
  color: #303b2d;
  box-shadow: 0 2px 6px rgba(46, 42, 31, 0.08);
}

.space-stage-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 7px;
}

.space-floor-select {
  width: 124px;
}

.space-legend {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  padding: 11px 16px 0;
}

.space-legend-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid #eee9df;
  border-radius: 6px;
  background: #fffefa;
  padding: 5px 8px;
  color: #777166;
  font-size: 10px;
  line-height: 1;
  transition:
    opacity 0.18s ease,
    border-color 0.18s ease;
}

.space-legend-item:hover {
  border-color: #d5ccbc;
}

.space-legend-item.is-muted {
  opacity: 0.48;
}

.space-legend-item i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
}

.space-legend-item strong {
  color: #44423b;
  font-size: 10px;
  font-weight: 650;
}

.space-stage-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 16px 12px;
  color: #9a9387;
  font-size: 10px;
  line-height: 1.5;
}

.space-truncated {
  color: #a17342;
}

.space-loading,
.space-empty,
.space-error {
  display: grid;
  justify-items: center;
  gap: 8px;
  padding: 54px 20px;
  text-align: center;
}

.space-loading-stage {
  width: min(420px, 80%);
  height: 190px;
  border: 1px solid #eee9df;
  border-radius: 10px;
  background: linear-gradient(100deg, #f7f4ed 20%, #fffefa 45%, #f7f4ed 70%);
  background-size: 220% 100%;
  animation: space-shimmer 1.4s ease-in-out infinite;
}

.space-loading p,
.space-empty p,
.space-error p {
  margin: 0;
  color: #8d8679;
  font-size: 11px;
  line-height: 1.7;
}

.space-empty strong,
.space-error strong {
  color: #44423b;
  font-size: 14px;
}

.space-error strong {
  color: #a05245;
}

@keyframes space-shimmer {
  to {
    background-position: -220% 0;
  }
}

@media (max-width: 760px) {
  .space-controlbar {
    align-items: flex-start;
    flex-direction: column;
    gap: 8px;
  }

  .space-controlbar-actions {
    width: 100%;
  }

  .space-building-select {
    flex: 1;
    width: auto;
  }

  .space-summary {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .space-summary-card strong {
    font-size: 20px;
  }

  .space-stage-head {
    align-items: flex-start;
    flex-direction: column;
  }

  .space-stage-actions {
    justify-content: flex-start;
  }

  .space-stage-foot {
    align-items: flex-start;
    flex-direction: column;
  }
}

@media (prefers-reduced-motion: reduce) {
  .space-loading-stage {
    animation: none;
  }
}
</style>
