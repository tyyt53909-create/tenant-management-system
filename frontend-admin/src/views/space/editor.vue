<template>
  <main class="editor-page">
    <header class="editor-header">
      <div>
        <p class="eyebrow">SPACE PLAN / ADMIN</p>
        <h1>平面图编辑器</h1>
        <p class="intro">拖动房间调整位置，拖右下角控制点调整尺寸；几何位置会吸附到网格。</p>
      </div>
      <el-button plain @click="router.push('/space')">返回空间模型</el-button>
    </header>

    <section class="toolbar">
      <el-select v-model="buildingId" placeholder="选择楼栋" filterable :loading="loadingBuildings" @change="loadEditor">
        <el-option v-for="building in buildings" :key="building.id" :label="building.name" :value="building.id" />
      </el-select>
      <el-select v-model="floorNumber" placeholder="选择楼层" :disabled="!floorOptions.length" @change="loadFloorPlan">
        <el-option v-for="floor in floorOptions" :key="floor" :label="`${floor} 楼`" :value="floor" />
      </el-select>
      <el-button :disabled="!buildingId || !floorNumber" :loading="templateLoading" @click="makeTemplate">生成房间模板</el-button>
      <span class="toolbar-spacer" />
      <span v-if="plan" class="version">版本 {{ plan.version }}</span>
      <el-button :disabled="!buildingId || !floorNumber" @click="loadFloorPlan">重新载入</el-button>
      <el-button type="primary" :loading="saving" :disabled="!buildingId || !floorNumber" @click="save">保存平面图</el-button>
    </section>

    <el-alert v-if="error" :title="error" type="error" show-icon :closable="false" />
    <el-alert v-if="conflict" title="平面图已被其他人修改（版本冲突）。你的本地改动尚未保存；请先重新载入，再重新编辑。" type="warning" show-icon :closable="false" />
    <el-alert v-if="dbUnavailable" title="平面图 API 暂不可用。开发数据库可能尚未套用 floor_plans migration；请在迁移后重新载入。" type="info" show-icon :closable="false" />

    <section v-if="buildingId && floorNumber" class="workspace">
      <div class="canvas-card">
        <div class="canvas-heading"><div><strong>{{ selectedBuilding?.name }} · {{ floorNumber }} 楼</strong><span>网格间距 {{ GRID }} 单位</span></div><span class="layout-tag">{{ plan ? '已保存平面图' : '新平面图' }}</span></div>
        <div v-if="loadingPlan" class="canvas-empty">正在载入楼层数据…</div>
        <div v-else class="canvas-scroll">
          <svg ref="svgRef" class="plan-canvas" :viewBox="`0 0 ${canvasWidth} ${canvasDepth}`" role="img" :aria-label="`${floorNumber} 楼平面图编辑画布`" @pointermove="moveShape" @pointerup="endPointer" @pointercancel="endPointer" @pointerleave="endPointer">
            <defs><pattern id="editor-grid" :width="GRID" :height="GRID" patternUnits="userSpaceOnUse"><path :d="`M ${GRID} 0 L 0 0 0 ${GRID}`" fill="none" stroke="#e9e7df" stroke-width="1" /></pattern></defs>
            <rect x="0" y="0" :width="canvasWidth" :height="canvasDepth" fill="#fbfaf6" />
            <rect x="0" y="0" :width="canvasWidth" :height="canvasDepth" fill="url(#editor-grid)" />
            <g v-for="(shape, index) in shapes" :key="shape.roomId || `shape-${index}`" :class="{ selected: selectedIndex === index, draggable: shape.kind === 'RECT' }" @pointerdown.stop="startPointer($event, index)">
              <rect v-if="shape.kind === 'RECT'" :x="shape.x" :y="shape.y" :width="shape.width" :height="shape.depth" rx="5" class="room-rect" />
              <polygon v-else-if="shape.polygon?.length" :points="shape.polygon.map(point => point.join(',')).join(' ')" class="room-polygon" />
              <text :x="shape.x + shape.width / 2" :y="shape.y + shape.depth / 2" class="room-label" text-anchor="middle" dominant-baseline="middle">{{ roomLabel(shape.roomId) || '未绑定房间' }}</text>
              <rect v-if="selectedIndex === index && shape.kind === 'RECT'" :x="shape.x + shape.width - 5" :y="shape.y + shape.depth - 5" width="10" height="10" class="resize-handle" @pointerdown.stop="startResize($event, index)" />
            </g>
          </svg>
        </div>
        <div class="canvas-foot"><span>画布 {{ canvasWidth }} × {{ canvasDepth }}</span><span>点击房间选中 · 拖动移动 · 拖动角点缩放</span></div>
      </div>

      <aside class="unplaced-card">
        <div class="aside-heading"><div><span class="eyebrow">ROOMS</span><h2>未放置房间</h2></div><span class="count">{{ unplacedRooms.length }}</span></div>
        <p class="aside-copy">这些房间尚未关联到图面。生成模板可一次性放置本楼层全部房间。</p>
        <ul v-if="unplacedRooms.length" class="room-list"><li v-for="room in unplacedRooms" :key="room.id"><span class="room-dot" /><span>{{ room.roomNumber }}</span><small>未放置</small></li></ul>
        <div v-else class="all-placed"><span>✓</span><strong>全部房间已放置</strong><p>保存后，空间模型将显示此楼层平面图。</p></div>
      </aside>
    </section>
    <section v-else class="empty-state"><strong>先选择楼栋与楼层</strong><p>读取对应楼层后即可开始编辑。</p></section>
  </main>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import type { AxiosError } from 'axios';
import { getBuildings } from '@/api/buildings';
import { createFloorPlanTemplate, getFloorPlans, saveFloorPlan } from '@/api/floorPlans';
import type { FloorPlan, FloorPlanShape } from '@/api/floorPlans';
import { getBuildingSpace } from '@/api/space';
import type { Building } from '@/types';
import type { SpaceFloorContract, SpaceModelContract } from '@/types/space';

const GRID = 20;
const router = useRouter();
const route = useRoute();
const buildings = ref<Building[]>([]);
const buildingId = ref('');
const floorNumber = ref<number | undefined>();
const model = ref<SpaceModelContract | null>(null);
const plan = ref<FloorPlan | null>(null);
const shapes = ref<FloorPlanShape[]>([]);
const loadingBuildings = ref(false);
const loadingPlan = ref(false);
const saving = ref(false);
const templateLoading = ref(false);
const error = ref('');
const conflict = ref(false);
const dbUnavailable = ref(false);
const selectedIndex = ref(-1);
const svgRef = ref<SVGSVGElement>();
const gesture = ref<{ index: number; mode: 'move' | 'resize'; dx: number; dy: number; originalX: number; originalY: number; width: number; depth: number } | null>(null);

const selectedBuilding = computed(() => buildings.value.find(item => item.id === buildingId.value));
const floorOptions = computed(() => model.value?.floors.map(item => item.floor) ?? []);
const currentFloor = computed<SpaceFloorContract | undefined>(() => model.value?.floors.find(item => item.floor === floorNumber.value));
const rooms = computed(() => currentFloor.value?.rooms ?? []);
const boundRoomIds = computed(() => new Set(shapes.value.map(shape => shape.roomId).filter((id): id is string => Boolean(id))));
const unplacedRooms = computed(() => rooms.value.filter(room => !boundRoomIds.value.has(room.id)));
const canvasWidth = computed(() => Math.max(200, Math.ceil((plan.value?.width || currentFloor.value?.width || 600) / GRID) * GRID));
const canvasDepth = computed(() => Math.max(160, Math.ceil((plan.value?.depth || currentFloor.value?.depth || 400) / GRID) * GRID));

function roomLabel(id: string | null) { return rooms.value.find(room => room.id === id)?.roomNumber ?? ''; }
function rounded(value: number) { return Math.max(0, Math.round(value / GRID) * GRID); }
function onApiError(caught: unknown) {
  const status = (caught as AxiosError)?.response?.status;
  conflict.value = status === 409;
  dbUnavailable.value = status === 500;
  error.value = status === 409 ? '' : status === 500 ? '' : '无法载入平面图资料，请检查连接后重试。';
}

async function loadEditor() {
  if (!buildingId.value) return;
  loadingPlan.value = true;
  error.value = '';
  dbUnavailable.value = false;
  try {
    model.value = await getBuildingSpace(buildingId.value);
    const requested = Number(route.query.floor);
    floorNumber.value = floorOptions.value.includes(requested) ? requested : floorOptions.value[0];
    await loadFloorPlan();
  } catch (caught) {
    model.value = null;
    onApiError(caught);
  } finally { loadingPlan.value = false; }
}

async function loadFloorPlan() {
  if (!buildingId.value || floorNumber.value === undefined) return;
  loadingPlan.value = true;
  error.value = '';
  conflict.value = false;
  dbUnavailable.value = false;
  try {
    if (!model.value) model.value = await getBuildingSpace(buildingId.value);
    const plans = await getFloorPlans(buildingId.value);
    plan.value = plans.find(item => item.floor === floorNumber.value) ?? null;
    shapes.value = plan.value ? plan.value.shapes.map(shape => ({ ...shape })) : [];
    selectedIndex.value = -1;
  } catch (caught) { onApiError(caught); }
  finally { loadingPlan.value = false; }
}

async function makeTemplate() {
  if (!buildingId.value || floorNumber.value === undefined) return;
  try {
    await ElMessageBox.confirm('模板会替换此楼层目前的所有图形配置，确定继续吗？', '生成房间模板', { type: 'warning', confirmButtonText: '替换并生成', cancelButtonText: '取消' });
    templateLoading.value = true;
    const result = await createFloorPlanTemplate(buildingId.value, floorNumber.value);
    plan.value = result;
    shapes.value = result.shapes.map(shape => ({ ...shape }));
    conflict.value = false;
    dbUnavailable.value = false;
    ElMessage.success('房间模板已生成，可继续调整并保存。');
  } catch (caught) {
    if (caught !== 'cancel' && caught !== 'close') onApiError(caught);
  } finally { templateLoading.value = false; }
}

async function save() {
  if (!buildingId.value || floorNumber.value === undefined) return;
  saving.value = true;
  conflict.value = false;
  error.value = '';
  const floor = currentFloor.value;
  try {
    plan.value = await saveFloorPlan(buildingId.value, floorNumber.value, {
      width: plan.value?.width ?? floor?.width ?? canvasWidth.value,
      depth: plan.value?.depth ?? floor?.depth ?? canvasDepth.value,
      version: plan.value?.version ?? 0,
      shapes: shapes.value.map(shape => ({ ...shape, width: Math.max(0, shape.width), depth: Math.max(0, shape.depth) })),
    });
    shapes.value = plan.value.shapes.map(shape => ({ ...shape }));
    ElMessage.success('平面图已保存。');
  } catch (caught) { onApiError(caught); }
  finally { saving.value = false; }
}

function pointerPosition(event: PointerEvent) {
  const point = svgRef.value?.createSVGPoint();
  if (!point || !svgRef.value) return { x: 0, y: 0 };
  point.x = event.clientX; point.y = event.clientY;
  const local = point.matrixTransform(svgRef.value.getScreenCTM()?.inverse());
  return { x: local.x, y: local.y };
}
function startPointer(event: PointerEvent, index: number) {
  selectedIndex.value = index;
  const shape = shapes.value[index];
  if (shape.kind !== 'RECT') return;
  event.preventDefault();
  const point = pointerPosition(event);
  gesture.value = { index, mode: 'move', dx: point.x - shape.x, dy: point.y - shape.y, originalX: shape.x, originalY: shape.y, width: shape.width, depth: shape.depth };
  (event.currentTarget as SVGGElement).setPointerCapture?.(event.pointerId);
}
function startResize(event: PointerEvent, index: number) {
  event.preventDefault();
  event.stopPropagation();
  const shape = shapes.value[index]; const point = pointerPosition(event);
  gesture.value = { index, mode: 'resize', dx: point.x, dy: point.y, originalX: shape.x, originalY: shape.y, width: shape.width, depth: shape.depth };
  (event.currentTarget as SVGElement).setPointerCapture?.(event.pointerId);
}
function moveShape(event: PointerEvent) {
  if (!gesture.value) return;
  const point = pointerPosition(event); const active = gesture.value;
  const shape = shapes.value[active.index];
  if (active.mode === 'move') {
    shape.x = rounded(point.x - active.dx);
    shape.y = rounded(point.y - active.dy);
  } else {
    shape.width = Math.max(GRID, rounded(active.width + point.x - active.dx));
    shape.depth = Math.max(GRID, rounded(active.depth + point.y - active.dy));
  }
}
function endPointer() { gesture.value = null; }

onMounted(async () => {
  loadingBuildings.value = true;
  try {
    const response = await getBuildings({ page: 1, limit: 100 });
    buildings.value = (response.data as Building[]).filter(building => building.isActive !== false);
    const queryBuilding = typeof route.query.building === 'string' ? route.query.building : '';
    buildingId.value = buildings.value.some(building => building.id === queryBuilding) ? queryBuilding : buildings.value[0]?.id ?? '';
    await loadEditor();
  } catch (caught) { onApiError(caught); }
  finally { loadingBuildings.value = false; }
});
</script>

<style scoped>
.editor-page { display:grid; gap:18px; color:#33372f; }
.editor-header { display:flex; align-items:center; justify-content:space-between; gap:20px; }
.eyebrow { margin:0 0 6px; color:#929082; font-size:10px; font-weight:700; letter-spacing:.13em; }
h1 { margin:0; font-size:25px; font-weight:650; letter-spacing:-.04em; }
.intro { margin:7px 0 0; color:#858477; font-size:12px; }
.toolbar { display:flex; align-items:center; gap:9px; padding:12px; border:1px solid #e8e6dd; border-radius:10px; background:#fffefa; }
.toolbar :deep(.el-select) { width:190px; }
.toolbar-spacer { flex:1; }
.version { color:#8e8b7e; font-size:11px; font-variant-numeric:tabular-nums; }
.workspace { display:grid; grid-template-columns:minmax(0,1fr) 260px; align-items:start; gap:14px; }
.canvas-card,.unplaced-card { overflow:hidden; border:1px solid #e8e6dd; border-radius:11px; background:#fffefa; }
.canvas-heading { display:flex; align-items:center; justify-content:space-between; padding:14px 16px; border-bottom:1px solid #efede6; }
.canvas-heading div { display:grid; gap:5px; }.canvas-heading strong { font-size:13px; }.canvas-heading div span,.layout-tag { color:#8b897d; font-size:10px; }
.layout-tag { padding:5px 8px; border-radius:20px; background:#f1f0e9; }
.canvas-scroll { overflow:auto; padding:18px; background:#f7f6f1; }
.plan-canvas { display:block; width:min(100%, 900px); min-width:500px; height:auto; margin:0 auto; border:1px solid #dddcd3; touch-action:none; }
.room-rect { fill:#e7eee2; stroke:#829477; stroke-width:2; cursor:move; }.room-polygon { fill:#f4ead6; stroke:#ae956a; stroke-width:2; cursor:default; }
.selected .room-rect,.selected .room-polygon { stroke:#3d674d; stroke-width:3; }.draggable { cursor:move; }.room-label { fill:#414a3e; font-size:13px; font-weight:600; pointer-events:none; user-select:none; }
.resize-handle { fill:#55775b; stroke:white; stroke-width:2; cursor:nwse-resize; }.canvas-foot { display:flex; justify-content:space-between; padding:10px 15px; color:#929082; font-size:10px; }
.canvas-empty { padding:90px 20px; text-align:center; color:#8c897d; }.unplaced-card { padding:16px; }.aside-heading { display:flex; align-items:center; justify-content:space-between; }.aside-heading h2 { margin:0; font-size:15px; }.count { display:grid; place-items:center; width:27px; height:27px; border-radius:50%; background:#f0eee7; color:#67685d; font-size:11px; }
.aside-copy { margin:12px 0; color:#8c897d; font-size:11px; line-height:1.7; }.room-list { display:grid; gap:5px; margin:0; padding:0; list-style:none; }.room-list li { display:flex; align-items:center; gap:9px; padding:9px 8px; border-radius:6px; background:#f8f7f2; font-size:12px; }.room-dot { width:7px; height:7px; border-radius:50%; background:#c79656; }.room-list small { margin-left:auto; color:#a39782; font-size:10px; }
.all-placed { display:grid; justify-items:center; gap:8px; padding:30px 8px; color:#667b5e; text-align:center; }.all-placed>span { display:grid; place-items:center; width:32px; height:32px; border-radius:50%; background:#edf2e9; }.all-placed strong { font-size:12px; }.all-placed p { margin:0; color:#929082; font-size:10px; line-height:1.6; }
.empty-state { padding:70px 20px; border:1px dashed #dedbd1; border-radius:10px; text-align:center; }.empty-state strong { font-size:14px; }.empty-state p { color:#8d8a7d; font-size:11px; }
@media(max-width:850px) { .workspace { grid-template-columns:1fr; }.unplaced-card { order:2; }.toolbar { flex-wrap:wrap; }.toolbar-spacer { display:none; }.toolbar :deep(.el-select) { flex:1; min-width:140px; }.canvas-foot { flex-direction:column; gap:5px; } }
</style>
