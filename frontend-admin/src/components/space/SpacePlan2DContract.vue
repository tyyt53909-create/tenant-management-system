<template>
  <section class="contract-plan" :aria-label="`${renderModel.building.name} 空间平面`">
    <div class="plan-summary" aria-label="房源统计">
      <span>共 {{ renderModel.summary.total }} 间</span><span>已租 {{ renderModel.summary.occupied }}</span>
      <span>可租 {{ renderModel.summary.rentable }}</span><span>{{ renderModel.layoutMode }}</span>
    </div>
    <div v-for="floor in renderModel.floors" :key="floor.floor" class="floor-card">
      <header><strong>{{ floor.floor }}F</strong><span>{{ floor.layoutMode }}</span></header>
      <div v-if="floor.rooms.length === 0 && floor.unplacedRooms.length === 0" class="empty-floor">此层暂无房源</div>
      <svg v-else class="floor-svg" viewBox="0 0 820 250" role="group" :aria-label="`${floor.floor}层平面图`" preserveAspectRatio="xMidYMid meet">
        <g v-for="room in floor.rooms" :key="room.id" class="room" :class="{ selected: selectedId === room.id }"
          role="button" tabindex="0" :aria-label="`${room.roomNumber}，${CONTRACT_STATE_META[room.state].label}`"
          @click="$emit('select', room)" @keydown.enter.prevent="$emit('select', room)" @keydown.space.prevent="$emit('select', room)">
          <title>{{ tooltip(room) }}</title>
          <rect v-if="room.shape.kind === 'RECT'" :x="room.shape.x * scaleX" :y="room.shape.y * scaleY" :width="room.shape.width * scaleX" :height="room.shape.depth * scaleY" rx="4" :fill="CONTRACT_STATE_META[room.state].soft" :stroke="CONTRACT_STATE_META[room.state].color" />
          <polygon v-else :points="polygonPoints(room)" :fill="CONTRACT_STATE_META[room.state].soft" :stroke="CONTRACT_STATE_META[room.state].color" />
          <text :x="center(room).x" :y="center(room).y" text-anchor="middle">{{ room.label }}</text>
          <text class="state" :x="center(room).x" :y="center(room).y + 15" text-anchor="middle">{{ CONTRACT_STATE_META[room.state].short }}</text>
          <g v-if="room.alerts.length" class="alert"><circle :cx="bounds(room).x + bounds(room).width - 5" :cy="bounds(room).y + 5" r="9"/><text :x="bounds(room).x + bounds(room).width - 5" :y="bounds(room).y + 8" text-anchor="middle">{{ room.alerts.length }}</text></g>
        </g>
      </svg>
      <div v-if="floor.unplacedRooms.length" class="unplaced"><strong>未放置房间</strong>
        <button v-for="room in floor.unplacedRooms" :key="room.id" type="button" :title="room.roomNumber" :aria-label="`${room.roomNumber}，未放置，${CONTRACT_STATE_META[room.state].label}`" @click="$emit('select', room)">
          {{ room.label }} · {{ CONTRACT_STATE_META[room.state].short }}<span v-if="room.alerts.length" class="badge">{{ room.alerts.length }}</span>
        </button>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { SpaceModelContract, SpaceShape } from '@/types/space';
import { buildSpaceContractModel, CONTRACT_STATE_META, type ContractRenderRoom } from '@/utils/spaceContractModel';

const props = defineProps<{ model: SpaceModelContract; selectedId?: string }>();
defineEmits<{ select: [room: ContractRenderRoom] }>();
const renderModel = computed(() => buildSpaceContractModel(props.model));
const scaleX = computed(() => 760 / Math.max(1, ...renderModel.value.floors.map((floor) => floor.width)));
const scaleY = computed(() => 210 / Math.max(1, ...renderModel.value.floors.map((floor) => floor.depth)));
const bounds = (room: ContractRenderRoom) => {
  const shape = room.shape;
  if (shape.kind === 'RECT') return { x: shape.x * scaleX.value, y: shape.y * scaleY.value, width: shape.width * scaleX.value, height: shape.depth * scaleY.value };
  const xs = shape.points.map(([x]) => x); const ys = shape.points.map(([, y]) => y);
  return { x: Math.min(...xs) * scaleX.value, y: Math.min(...ys) * scaleY.value, width: (Math.max(...xs) - Math.min(...xs)) * scaleX.value, height: (Math.max(...ys) - Math.min(...ys)) * scaleY.value };
};
const center = (room: ContractRenderRoom) => { const b = bounds(room); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
const polygonPoints = (room: ContractRenderRoom) => (room.shape as Extract<SpaceShape, { kind: 'POLYGON' }>).points.map(([x, y]) => `${x * scaleX.value},${y * scaleY.value}`).join(' ');
const tooltip = (room: ContractRenderRoom) => `${room.roomNumber} · ${CONTRACT_STATE_META[room.state].label}${room.alerts.length ? `\n提醒：${room.alerts.map((a) => a.label || a.type).join('、')}` : ''}`;
</script>

<style scoped>
.contract-plan { width: 100%; min-width: 0; color: #34382f; }
.plan-summary { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; color: #777568; font-size: 12px; }
.plan-summary span, .floor-card { border: 1px solid #eeeae2; border-radius: 10px; background: #fff; }
.plan-summary span { padding: 5px 9px; }
.floor-card { margin: 10px 0; padding: 12px; }
.floor-card header { display: flex; justify-content: space-between; color: #78776e; font-size: 12px; }
.floor-svg { display: block; width: 100%; height: auto; max-height: 250px; }
.room { cursor: pointer; outline: none; }
.room rect, .room polygon { stroke-width: 1.5; vector-effect: non-scaling-stroke; }
.room.selected rect, .room.selected polygon, .room:focus-visible rect, .room:focus-visible polygon { stroke: #303b2d; stroke-width: 3; }
.room > text { fill: #36362f; font: 650 12px sans-serif; pointer-events: none; }
.room > .state { font-size: 10px; font-weight: 500; }
.alert circle { fill: #b35f55; stroke: white; stroke-width: 1.5; }.alert text { fill: white; font: 700 10px sans-serif; }
.empty-floor { padding: 24px 12px; color: #8b8478; text-align: center; }
.unplaced { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; padding-top: 8px; font-size: 12px; }
.unplaced button { border: 1px dashed #b6844f; border-radius: 6px; background: #fffaf1; padding: 6px 9px; color: #67543d; cursor: pointer; }
.badge { margin-left: 5px; border-radius: 10px; background: #b35f55; color: white; padding: 1px 5px; }
</style>
