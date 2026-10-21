<template>
  <div class="space-plan-scroll">
    <svg
      class="space-plan"
      :width="svgWidth"
      :height="svgHeight"
      :viewBox="`0 0 ${svgWidth} ${svgHeight}`"
      role="img"
      :aria-label="`${model.buildingName} 房源楼层剖面`"
    >
      <g v-for="layout in floorLayouts" :key="layout.floor.floor">
        <rect
          class="space-plan-floor-band"
          :x="labelWidth"
          :y="layout.top - 5"
          :width="Math.max(0, svgWidth - labelWidth - padding)"
          :height="layout.height + 10"
          rx="6"
        />
        <line
          class="space-plan-floor-line"
          :x1="labelWidth"
          :x2="svgWidth - padding"
          :y1="layout.top + 11"
          :y2="layout.top + 11"
        />
        <text
          class="space-plan-floor-label"
          :x="padding"
          :y="layout.top + 15"
        >
          {{ layout.floor.floor }}F
        </text>

        <text
          v-if="layout.floor.rooms.length === 0"
          class="space-plan-empty"
          :x="labelWidth + 10"
          :y="layout.top + 15"
        >
          此层暂无房源
        </text>

        <g
          v-for="room in layout.floor.rooms"
          :key="room.id"
          class="space-plan-room"
          :class="{ 'is-selected': room.id === selectedId }"
          role="button"
          tabindex="0"
          :aria-label="roomAriaLabel(room)"
          @click="$emit('select', room)"
          @keydown.enter.prevent="$emit('select', room)"
          @keydown.space.prevent="$emit('select', room)"
        >
          <title>{{ roomTooltip(room) }}</title>
          <rect
            :x="roomX(room)"
            :y="roomY(layout, room)"
            :width="roomWidth"
            :height="roomHeight"
            rx="4"
            :fill="stateMeta(room).soft"
            :stroke="room.id === selectedId ? '#303b2d' : stateMeta(room).color"
            :stroke-width="room.id === selectedId ? 2 : 1"
          />
          <rect
            :x="roomX(room)"
            :y="roomY(layout, room)"
            :width="roomWidth"
            :height="3"
            rx="1.5"
            :fill="stateMeta(room).color"
          />
          <text
            :class="['space-plan-room-number', { 'is-compact': roomLabel(room).length > 5 }]"
            :x="roomX(room) + roomWidth / 2"
            :y="roomY(layout, room) + 17"
          >
            {{ roomLabel(room) }}
          </text>
          <text
            class="space-plan-room-state"
            :x="roomX(room) + roomWidth / 2"
            :y="roomY(layout, room) + 30"
            :fill="stateMeta(room).color"
          >
            {{ stateMeta(room).short }}
          </text>
        </g>
      </g>
    </svg>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { SpaceModel, SpaceRoom } from '@/utils/spaceModel';
import { SPACE_LAYOUT, SPACE_STATE_META } from '@/utils/spaceModel';
import { formatMoney } from '@/utils/table';

const props = defineProps<{
  model: SpaceModel;
  selectedId?: string;
}>();

defineEmits<{
  select: [room: SpaceRoom];
}>();

const scale = 12.5;
const padding = 14;
const labelWidth = 38;
const rowGap = 9;
const floorGap = 18;
const roomWidth = SPACE_LAYOUT.roomWidth * scale;
const roomHeight = SPACE_LAYOUT.roomDepth * scale;
const rowStride = roomHeight + rowGap;

const svgWidth = computed(() =>
  Math.max(360, labelWidth + padding * 2 + props.model.width * scale),
);

const floorLayouts = computed(() => {
  let top = padding;
  return props.model.floors.map((floor) => {
    const rows = Math.max(1, floor.rows);
    const height = rows * roomHeight + Math.max(0, rows - 1) * rowGap;
    const layout = { floor, top, height };
    top += height + floorGap;
    return layout;
  });
});

const svgHeight = computed(() => {
  const last = floorLayouts.value[floorLayouts.value.length - 1];
  return last ? last.top + last.height + padding : padding * 2;
});

const stateMeta = (room: SpaceRoom) => SPACE_STATE_META[room.state];
const roomX = (room: SpaceRoom) => labelWidth + padding + room.x * scale;
const roomY = (layout: { top: number }, room: SpaceRoom) =>
  layout.top + room.row * rowStride;
const roomLabel = (room: SpaceRoom) => {
  const value = room.roomNumber || '—';
  // 长房号（导入数据常见）保留尾部唯一部分，例如 …7h7B；短房号完整显示。
  return value.length > 5 ? `…${value.slice(-4)}` : value;
};

const roomTooltip = (room: SpaceRoom) => {
  const lines = [`${room.roomNumber} · ${stateMeta(room).label}`];
  if (room.tenantName) lines.push(`租客：${room.tenantName}`);
  if (room.rentAmount != null) lines.push(`月租：${formatMoney(room.rentAmount)}`);
  if (room.contractEnd) lines.push(`到期：${room.contractEnd.slice(0, 10)}`);
  if (room.state === 'PENDING_CLEAN') lines.push('已空置但尚未清洁，暂不可出租');
  return lines.join('\n');
};

const roomAriaLabel = (room: SpaceRoom) =>
  `${room.roomNumber}，${stateMeta(room).label}${room.tenantName ? `，租客 ${room.tenantName}` : ''}`;
</script>

<style scoped>
.space-plan-scroll {
  width: 100%;
  max-width: 100%;
  overflow: auto;
  padding: 2px 0 4px;
}

.space-plan {
  display: block;
  max-width: none;
  margin: 0 auto;
  overflow: visible;
}

.space-plan-floor-band {
  fill: #fbfaf6;
  stroke: #f0ece4;
  stroke-width: 0.8;
}

.space-plan-floor-line {
  stroke: #ece7de;
  stroke-width: 1;
}

.space-plan-floor-label {
  fill: #8b8478;
  font-size: 11px;
  font-weight: 650;
  letter-spacing: 0.04em;
}

.space-plan-empty {
  fill: #aaa294;
  font-size: 10px;
}

.space-plan-room {
  cursor: pointer;
  outline: none;
}

.space-plan-room rect {
  transition:
    fill 0.2s ease,
    stroke 0.2s ease,
    filter 0.2s ease;
}

.space-plan-room:hover rect:first-of-type,
.space-plan-room:focus-visible rect:first-of-type {
  filter: brightness(0.985);
}

.space-plan-room:focus-visible rect:first-of-type {
  stroke-width: 2;
}

.space-plan-room-number {
  fill: #36362f;
  font-size: 9px;
  font-weight: 650;
  text-anchor: middle;
  pointer-events: none;
}

.space-plan-room-number.is-compact {
  font-size: 8px;
  letter-spacing: -0.02em;
}

.space-plan-room-state {
  font-size: 7.5px;
  font-weight: 550;
  text-anchor: middle;
  pointer-events: none;
}

.space-plan-room.is-selected rect:first-of-type {
  filter: drop-shadow(0 3px 5px rgba(47, 56, 40, 0.12));
}
</style>
