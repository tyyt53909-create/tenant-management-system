<template>
  <div ref="host" class="space-scene">
    <canvas ref="canvas" class="space-scene-canvas" :aria-label="`${model.buildingName} 3D 房源模型`" />
    <div v-if="unsupported" class="space-scene-fallback" role="status">
      <strong>当前浏览器无法启用 3D</strong>
      <span>已保留 2D 剖面视图，可继续查看房源状态。</span>
    </div>
    <div v-if="hoveredRoom" class="space-scene-tooltip" :style="tooltipStyle">
      <div class="space-scene-tooltip-head">
        <strong>{{ hoveredRoom.roomNumber }}</strong>
        <span :style="{ color: stateMeta(hoveredRoom).color }">{{ stateMeta(hoveredRoom).label }}</span>
      </div>
      <p v-if="hoveredRoom.tenantName">租客：{{ hoveredRoom.tenantName }}</p>
      <p v-if="hoveredRoom.rentAmount != null">月租：{{ formatMoney(hoveredRoom.rentAmount) }}</p>
      <p v-if="hoveredRoom.contractEnd">到期：{{ hoveredRoom.contractEnd.slice(0, 10) }}</p>
      <p v-if="hoveredRoom.state === 'PENDING_CLEAN'" class="space-scene-tooltip-note">
        已空置但尚未清洁，暂不可出租
      </p>
    </div>
    <div class="space-scene-hint">拖拽旋转 · 滚轮缩放 · 点击房间查看</div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import type { SpaceModel, SpaceRoom } from '@/utils/spaceModel';
import { SPACE_LAYOUT, SPACE_STATE_META } from '@/utils/spaceModel';
import { formatMoney } from '@/utils/table';

const props = defineProps<{
  model: SpaceModel;
  selectedId?: string;
}>();

const emit = defineEmits<{
  select: [room: SpaceRoom];
  unsupported: [];
}>();

const host = ref<HTMLElement>();
const canvas = ref<HTMLCanvasElement>();
const hoveredRoom = ref<SpaceRoom>();
const tooltipX = ref(0);
const tooltipY = ref(0);
const unsupported = ref(false);

const tooltipStyle = computed(() => ({
  left: `${tooltipX.value}px`,
  top: `${tooltipY.value}px`,
}));

let renderer: THREE.WebGLRenderer | undefined;
let labelRenderer: CSS2DRenderer | undefined;
let scene: THREE.Scene | undefined;
let camera: THREE.OrthographicCamera | undefined;
let controls: OrbitControls | undefined;
let buildingGroup: THREE.Group | undefined;
let selectionHelper: THREE.BoxHelper | undefined;
let resizeObserver: ResizeObserver | undefined;
let renderQueued = false;
let animationFrame = 0;
let disposed = false;
let pointerDown: { x: number; y: number } | null = null;

const floorGroups: THREE.Group[] = [];
const floorLabels: { floor: number; object: CSS2DObject }[] = [];
const roomMeshes: THREE.Mesh[] = [];
const stateMaterials = new Map<string, THREE.MeshStandardMaterial>();
let slabMaterial: THREE.MeshStandardMaterial | undefined;
let slabEdgeMaterial: THREE.LineBasicMaterial | undefined;
let floorIsolation: number | null = null;
let exploded = false;

const stateMeta = (room: SpaceRoom) => SPACE_STATE_META[room.state];

function materialFor(room: SpaceRoom) {
  const meta = stateMeta(room);
  let material = stateMaterials.get(meta.color);
  if (!material) {
    material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(meta.color),
      roughness: 0.82,
      metalness: 0.02,
    });
    stateMaterials.set(meta.color, material);
  }
  return material;
}

function requestRender() {
  if (disposed || renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    if (!renderer || !scene || !camera || !controls) return;
    controls.update();
    renderer.render(scene, camera);
    labelRenderer?.render(scene, camera);
  });
}

function fitCamera(target: THREE.Object3D | null = buildingGroup ?? null) {
  if (!camera || !controls || !host.value || !buildingGroup) return;
  const width = host.value.clientWidth || 800;
  const height = host.value.clientHeight || 440;
  const aspect = width / height;
  const box = new THREE.Box3().setFromObject(target ?? buildingGroup);
  if (box.isEmpty()) return;
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const span = Math.max(size.x, size.y, size.z, 8);
  const direction = new THREE.Vector3(1, 1.18, 1).normalize();

  camera.up.set(0, 1, 0);
  camera.position.copy(center).addScaledVector(direction, span * 3);
  camera.lookAt(center);
  camera.near = 0.1;
  camera.far = span * 12;
  camera.updateMatrixWorld();

  const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
  const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
  let maxX = 0;
  let maxY = 0;
  for (const x of [box.min.x, box.max.x]) {
    for (const y of [box.min.y, box.max.y]) {
      for (const z of [box.min.z, box.max.z]) {
        const point = new THREE.Vector3(x, y, z).sub(center);
        maxX = Math.max(maxX, Math.abs(point.dot(right)));
        maxY = Math.max(maxY, Math.abs(point.dot(up)));
      }
    }
  }

  let viewWidth = Math.max(maxX * 2 * 1.12, 4);
  let viewHeight = Math.max(maxY * 2 * 1.12, 4);
  if (viewWidth / viewHeight < aspect) {
    viewWidth = viewHeight * aspect;
  } else {
    viewHeight = viewWidth / aspect;
  }

  camera.left = -viewWidth / 2;
  camera.right = viewWidth / 2;
  camera.top = viewHeight / 2;
  camera.bottom = -viewHeight / 2;
  camera.zoom = 1;
  camera.updateProjectionMatrix();

  controls.target.copy(center);
  controls.minZoom = 0.55;
  controls.maxZoom = 3.5;
  controls.minPolarAngle = Math.PI * 0.16;
  controls.maxPolarAngle = Math.PI * 0.48;
  controls.update();
}

function buildScene() {
  if (!scene) return;
  if (buildingGroup) {
    scene.remove(buildingGroup);
    disposeGroup(buildingGroup);
    buildingGroup = undefined;
  }
  if (selectionHelper) {
    scene.remove(selectionHelper);
    selectionHelper.geometry.dispose();
    (selectionHelper.material as THREE.Material).dispose();
    selectionHelper = undefined;
  }
  floorGroups.length = 0;
  for (const item of floorLabels) item.object.element?.remove();
  floorLabels.length = 0;
  roomMeshes.length = 0;
  stateMaterials.forEach((material) => material.dispose());
  stateMaterials.clear();

  buildingGroup = new THREE.Group();
  buildingGroup.position.set(-props.model.width / 2, 0, -props.model.depth / 2);
  scene.add(buildingGroup);

  slabMaterial ??= new THREE.MeshStandardMaterial({
    color: new THREE.Color('#ece5d8'),
    roughness: 0.96,
    metalness: 0,
    transparent: true,
    opacity: 0.38,
    depthWrite: false,
  });
  slabEdgeMaterial ??= new THREE.LineBasicMaterial({
    color: new THREE.Color('#d8d0c2'),
    transparent: true,
    opacity: 0.7,
  });

  for (const floor of props.model.floors) {
    const group = new THREE.Group();
    group.userData.floor = floor.floor;
    group.userData.level = floor.level;
    group.userData.baseY = floor.level * (SPACE_LAYOUT.roomHeight + SPACE_LAYOUT.floorGap);
    group.position.y =
      (group.userData.baseY as number) + (exploded ? floor.level * 1.15 + 0.35 : 0);
    buildingGroup.add(group);
    floorGroups.push(group);

    const slabWidth = props.model.width + 0.8;
    const slabDepth = props.model.depth + 0.8;
    const slabGeometry = new THREE.BoxGeometry(slabWidth, 0.18, slabDepth);
    const slab = new THREE.Mesh(slabGeometry, slabMaterial);
    slab.position.set(props.model.width / 2, -0.09, props.model.depth / 2);
    // 楼板只保留边缘线，不铺满整块实体；否则上层楼板会遮住下层的房间颜色。
    slab.visible = false;
    group.add(slab);

    const slabEdges = new THREE.LineSegments(
      new THREE.EdgesGeometry(slabGeometry),
      slabEdgeMaterial,
    );
    slabEdges.position.copy(slab.position);
    group.add(slabEdges);

    const label = document.createElement('div');
    label.className = 'space-scene-floor-label';
    label.textContent = `${floor.floor}F`;
    const labelObject = new CSS2DObject(label);
    labelObject.position.set(-0.9, SPACE_LAYOUT.roomHeight * 0.55, props.model.depth / 2);
    group.add(labelObject);
    floorLabels.push({ floor: floor.floor, object: labelObject });

    for (const room of floor.rooms) {
      const geometry = new THREE.BoxGeometry(
        room.width * 0.9,
        SPACE_LAYOUT.roomHeight,
        room.depth * 0.82,
      );
      const mesh = new THREE.Mesh(geometry, materialFor(room));
      mesh.position.set(
        room.x + room.width / 2,
        SPACE_LAYOUT.roomHeight / 2 + 0.02,
        room.y + room.depth / 2,
      );
      mesh.userData.room = room;
      group.add(mesh);
      roomMeshes.push(mesh);
    }
  }

  const helperAnchor = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
  const helper = new THREE.BoxHelper(helperAnchor, 0x303b2d);
  helperAnchor.geometry.dispose();
  helper.visible = false;
  scene.add(helper);
  selectionHelper = helper;

  updateFloorLabels();
  fitCamera();
  applySelection();
  requestRender();
}

function applySelection() {
  if (!selectionHelper) return;
  const selected = roomMeshes.find((mesh) => mesh.userData.room?.id === props.selectedId);
  const selectedVisible = !!selected && selected.parent?.visible !== false;
  selectionHelper.visible = selectedVisible;
  if (selected && selectedVisible) {
    selectionHelper.setFromObject(selected);
    selectionHelper.update();
  }
  requestRender();
}

function updateFloorLabels() {
  for (const item of floorLabels) {
    const floorVisible = floorIsolation == null || item.floor === floorIsolation;
    item.object.visible = floorVisible && (exploded || floorIsolation != null);
  }
}

function fitCurrentView() {
  const target =
    floorIsolation == null
      ? buildingGroup
      : floorGroups.find((group) => group.userData.floor === floorIsolation);
  fitCamera(target ?? buildingGroup ?? null);
}

function setFloorVisibility() {
  for (const group of floorGroups) {
    const visible = floorIsolation == null || group.userData.floor === floorIsolation;
    group.visible = visible;
  }
  updateFloorLabels();
  applySelection();
  fitCurrentView();
  requestRender();
}

function animateExplode() {
  cancelAnimationFrame(animationFrame);
  const start = performance.now();
  const duration = 420;
  const from = floorGroups.map((group) => group.position.y);
  const to = floorGroups.map((group) => {
    const baseY = group.userData.baseY as number;
    const level = group.userData.level as number;
    return exploded ? baseY + level * 1.15 + 0.35 : baseY;
  });
  const step = (now: number) => {
    const progress = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - progress, 3);
    floorGroups.forEach((group, index) => {
      group.position.y = from[index]! + (to[index]! - from[index]!) * eased;
    });
    requestRender();
    if (progress < 1) {
      animationFrame = requestAnimationFrame(step);
    } else {
      updateFloorLabels();
      fitCurrentView();
      requestRender();
    }
  };
  animationFrame = requestAnimationFrame(step);
}

function pointerPosition(event: PointerEvent) {
  const rect = canvas.value?.getBoundingClientRect();
  if (!rect) return null;
  return {
    x: ((event.clientX - rect.left) / rect.width) * 2 - 1,
    y: -((event.clientY - rect.top) / rect.height) * 2 + 1,
    left: event.clientX - rect.left,
    top: event.clientY - rect.top,
  };
}

function pickRoom(pointer: { x: number; y: number }) {
  if (!camera) return undefined;
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(new THREE.Vector2(pointer.x, pointer.y), camera);
  const hit = raycaster
    .intersectObjects(roomMeshes, false)
    .find((item) => item.object.parent?.visible !== false);
  return hit?.object.userData.room as SpaceRoom | undefined;
}

function onPointerMove(event: PointerEvent) {
  if (!camera || !renderer) return;
  const pointer = pointerPosition(event);
  if (!pointer) return;
  const room = pickRoom(pointer);
  if (room) {
    hoveredRoom.value = room;
    tooltipX.value = Math.min(pointer.left + 14, (host.value?.clientWidth ?? 800) - 210);
    tooltipY.value = Math.min(pointer.top + 14, (host.value?.clientHeight ?? 440) - 130);
    if (canvas.value) canvas.value.style.cursor = 'pointer';
  } else {
    hoveredRoom.value = undefined;
    if (canvas.value) canvas.value.style.cursor = 'grab';
  }
}

function onPointerLeave() {
  hoveredRoom.value = undefined;
  if (canvas.value) canvas.value.style.cursor = 'grab';
}

function onPointerDown(event: PointerEvent) {
  pointerDown = { x: event.clientX, y: event.clientY };
}

function onPointerUp(event: PointerEvent) {
  if (!camera) return;
  const start = pointerDown;
  pointerDown = null;
  if (!start || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 5) return;
  const pointer = pointerPosition(event);
  if (!pointer) return;
  const room = pickRoom(pointer);
  if (room) emit('select', room);
}

function onResize() {
  if (!renderer || !labelRenderer || !camera || !host.value) return;
  const width = host.value.clientWidth || 800;
  const height = host.value.clientHeight || 440;
  renderer.setSize(width, height, false);
  labelRenderer.setSize(width, height);
  camera.left = (-height * (width / height)) / 2;
  camera.right = (height * (width / height)) / 2;
  camera.top = height / 2;
  camera.bottom = -height / 2;
  fitCurrentView();
  requestRender();
}

function init() {
  if (!canvas.value || !host.value) return;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas: canvas.value,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
  } catch {
    unsupported.value = true;
    emit('unsupported');
    return;
  }

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  scene = new THREE.Scene();
  camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1000);

  const hemi = new THREE.HemisphereLight(0xfffaf0, 0xd7d0c0, 1.35);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xfff4df, 1.6);
  key.position.set(10, 20, 8);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xdfe8ef, 0.55);
  fill.position.set(-12, 8, -10);
  scene.add(fill);

  controls = new OrbitControls(camera, canvas.value);
  controls.enableDamping = false;
  controls.enablePan = true;
  controls.zoomSpeed = 0.9;
  controls.rotateSpeed = 0.65;
  controls.addEventListener('change', requestRender);

  labelRenderer = new CSS2DRenderer();
  labelRenderer.domElement.className = 'space-scene-labels';
  labelRenderer.domElement.style.position = 'absolute';
  labelRenderer.domElement.style.inset = '0';
  labelRenderer.domElement.style.overflow = 'hidden';
  labelRenderer.domElement.style.pointerEvents = 'none';
  host.value.appendChild(labelRenderer.domElement);

  buildScene();
  onResize();
  canvas.value.addEventListener('pointermove', onPointerMove);
  canvas.value.addEventListener('pointerleave', onPointerLeave);
  canvas.value.addEventListener('pointerdown', onPointerDown);
  canvas.value.addEventListener('pointerup', onPointerUp);

  resizeObserver = new ResizeObserver(onResize);
  resizeObserver.observe(host.value);
  requestRender();
}

function disposeGroup(group: THREE.Group) {
  group.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
  });
}

function disposeScene() {
  if (scene) {
    scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
    });
    scene.clear();
  }
  stateMaterials.forEach((material) => material.dispose());
  stateMaterials.clear();
  slabMaterial?.dispose();
  slabEdgeMaterial?.dispose();
  slabMaterial = undefined;
  slabEdgeMaterial = undefined;
  renderer?.dispose();
  controls?.dispose();
  labelRenderer?.domElement.remove();
  resizeObserver?.disconnect();
}

onMounted(init);

watch(
  () => props.model,
  (next, previous) => {
    if (!scene) return;
    if (previous && previous.buildingId !== next.buildingId) {
      exploded = false;
      floorIsolation = null;
    }
    buildScene();
  },
);

watch(
  () => props.selectedId,
  () => applySelection(),
);

onBeforeUnmount(() => {
  disposed = true;
  cancelAnimationFrame(animationFrame);
  if (canvas.value) {
    canvas.value.removeEventListener('pointermove', onPointerMove);
    canvas.value.removeEventListener('pointerleave', onPointerLeave);
    canvas.value.removeEventListener('pointerdown', onPointerDown);
    canvas.value.removeEventListener('pointerup', onPointerUp);
  }
  disposeScene();
});

defineExpose({
  resetView() {
    fitCurrentView();
    requestRender();
  },
  isolateFloor(floor: number | null) {
    floorIsolation = floor;
    setFloorVisibility();
  },
  setExploded(value: boolean) {
    exploded = value;
    animateExplode();
  },
});
</script>

<style scoped>
.space-scene {
  position: relative;
  width: 100%;
  min-height: 430px;
  height: 430px;
  overflow: hidden;
  border: 1px solid #e8e2d7;
  border-radius: 12px;
  background:
    radial-gradient(circle at 50% 72%, rgba(83, 91, 67, 0.06), transparent 34%),
    linear-gradient(180deg, #fbfaf6 0%, #f4f1e9 100%);
}

.space-scene-canvas {
  display: block;
  width: 100%;
  height: 100%;
  cursor: grab;
}

.space-scene-canvas:active {
  cursor: grabbing;
}

.space-scene-labels {
  overflow: hidden;
}

.space-scene :deep(.space-scene-floor-label) {
  padding: 2px 6px;
  border: 1px solid #e4ddd0;
  border-radius: 5px;
  background: rgba(255, 253, 248, 0.88);
  color: #777267;
  font-size: 10px;
  font-weight: 650;
  letter-spacing: 0.04em;
  white-space: nowrap;
}

.space-scene-tooltip {
  position: absolute;
  z-index: 2;
  width: 196px;
  padding: 10px 11px;
  border: 1px solid #e2dbcd;
  border-radius: 9px;
  background: rgba(255, 253, 248, 0.97);
  box-shadow: 0 12px 32px rgba(48, 47, 42, 0.12);
  pointer-events: none;
  font-size: 11px;
  color: #6f6a60;
}

.space-scene-tooltip-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
}

.space-scene-tooltip-head strong {
  color: #302f2a;
  font-size: 13px;
}

.space-scene-tooltip-head span {
  font-size: 10px;
  font-weight: 650;
}

.space-scene-tooltip p {
  margin: 3px 0;
  line-height: 1.5;
}

.space-scene-tooltip-note {
  color: #a17342;
}

.space-scene-hint {
  position: absolute;
  right: 12px;
  bottom: 10px;
  color: #9a9387;
  font-size: 10px;
  letter-spacing: 0.02em;
  pointer-events: none;
}

.space-scene-fallback {
  position: absolute;
  inset: 0;
  z-index: 3;
  display: grid;
  place-content: center;
  gap: 6px;
  padding: 24px;
  background: rgba(250, 248, 242, 0.94);
  text-align: center;
  color: #6f6a60;
  font-size: 12px;
}

.space-scene-fallback strong {
  color: #302f2a;
  font-size: 14px;
}

@media (max-width: 760px) {
  .space-scene {
    min-height: 360px;
    height: 360px;
  }

  .space-scene-hint {
    display: none;
  }
}
</style>
