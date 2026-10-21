<template>
  <section ref="host" class="contract-scene" :aria-label="`${model.building.name} 3D 空间`">
    <canvas ref="canvas" class="scene-canvas" :aria-label="`${model.building.name} 3D 房源模型`" />
    <div class="toolbar">
      <label>楼层
        <select v-model="floorFilter" aria-label="楼层隔离" @change="applyFloor">
          <option value="all">全部</option>
          <option v-for="floor in model.floors" :key="floor.floor" :value="String(floor.floor)">{{ floor.floor }}F</option>
        </select>
      </label>
      <button type="button" @click="toggleExploded">{{ exploded ? '合拢' : '展开' }}</button>
      <button type="button" @click="resetView">重置视角</button>
    </div>
    <div v-if="unsupported" class="fallback" role="status">
      <strong>3D 暂不可用，已切换平面视图</strong>
      <div class="fallback-rooms">
        <button v-for="room in visibleRooms" :key="room.id" type="button" :class="['room-card', { selected: selectedId === room.id }]" @click="emit('select', room)">
          <b>{{ room.roomNumber }}</b><span>{{ SPACE_STATE_STYLE[room.state].label }}</span><i v-if="room.alerts.length">{{ room.alerts[0]?.label || '有提醒' }}</i>
        </button>
      </div>
    </div>
    <div v-else-if="hovered" class="tooltip" :style="tooltipStyle">
      <b>{{ hovered.roomNumber }}</b><span :style="{ color: SPACE_STATE_STYLE[hovered.state].color }">{{ SPACE_STATE_STYLE[hovered.state].label }}</span>
      <p v-if="hovered.tenantName && model.capabilities.canSeeTenant">租客：{{ hovered.tenantName }}</p>
      <p v-for="alert in hovered.alerts" :key="`${alert.type}-${alert.label}`" class="alert">{{ alert.label || alert.type }}</p>
    </div>
    <div class="hint">拖拽旋转 · 滚轮缩放 · 点击房间选择</div>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { SpaceModelContract, SpaceRoomContract } from '@/types/space';
import { createRoomGeometry, roomAlertColor, SPACE_STATE_STYLE } from './space3dContract';

const props = defineProps<{ model: SpaceModelContract; selectedId?: string }>();
const emit = defineEmits<{ select: [room: SpaceRoomContract]; unsupported: [] }>();
const host = ref<HTMLElement>();
const canvas = ref<HTMLCanvasElement>();
const unsupported = ref(false);
const hovered = ref<SpaceRoomContract>();
const tooltipStyle = ref<Record<string, string>>({});
const floorFilter = ref('all');
const exploded = ref(false);
const visibleRooms = computed(() => props.model.floors.filter((floor) => floorFilter.value === 'all' || String(floor.floor) === floorFilter.value).flatMap((floor) => floor.rooms));
let renderer: THREE.WebGLRenderer | undefined;
let scene: THREE.Scene | undefined;
let camera: THREE.OrthographicCamera | undefined;
let controls: OrbitControls | undefined;
let resizeObserver: ResizeObserver | undefined;
let root: THREE.Group | undefined;
let floors: THREE.Group[] = [];
let meshes: THREE.Mesh[] = [];
let frame = 0;
let disposed = false;
let pointerDown: { x: number; y: number } | undefined;
let materialMap = new Map<string, THREE.MeshStandardMaterial>();
let selectionLines: THREE.LineSegments | undefined;

function requestRender() {
  if (disposed || frame) return;
  frame = requestAnimationFrame(() => { frame = 0; if (renderer && scene && camera) renderer.render(scene, camera); });
}
function fit(target: THREE.Object3D = root!) {
  if (!camera || !controls || !host.value || !target) return;
  const bounds = new THREE.Box3().setFromObject(target);
  if (bounds.isEmpty()) return;
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  const span = Math.max(size.x, size.y, size.z, 10);
  camera.position.copy(center).add(new THREE.Vector3(1, 1.2, 1).normalize().multiplyScalar(span * 2.6));
  camera.lookAt(center);
  camera.left = -span * (host.value.clientWidth / Math.max(host.value.clientHeight, 1)) / 2;
  camera.right = -camera.left;
  camera.top = span / 2;
  camera.bottom = -camera.top;
  camera.updateProjectionMatrix();
  controls.target.copy(center);
  controls.update();
  requestRender();
}
function materialFor(room: SpaceRoomContract) {
  const alertColor = roomAlertColor(room);
  const color = alertColor || SPACE_STATE_STYLE[room.state].color;
  if (!materialMap.has(color)) materialMap.set(color, new THREE.MeshStandardMaterial({ color, roughness: 0.78, metalness: 0.02 }));
  return materialMap.get(color)!;
}
function disposeRoot() {
  if (!root) return;
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    mesh.geometry?.dispose();
    if (mesh.userData.temporaryMaterial) (mesh.material as THREE.Material).dispose();
  });
  scene?.remove(root);
  materialMap.forEach((material) => material.dispose());
  materialMap.clear();
}
function build() {
  if (!scene) return;
  if (selectionLines) {
    scene.remove(selectionLines); selectionLines.geometry.dispose();
    (selectionLines.material as THREE.Material).dispose(); selectionLines = undefined;
  }
  disposeRoot();
  root = new THREE.Group(); floors = []; meshes = [];
  const maxWidth = Math.max(1, ...props.model.floors.map((floor) => floor.width + floor.rooms.filter((room) => room.unplaced).length * 5));
  const maxDepth = Math.max(1, ...props.model.floors.map((floor) => floor.depth));
  root.position.set(-maxWidth / 2, 0, -maxDepth / 2);
  for (const floor of props.model.floors) {
    const group = new THREE.Group();
    group.userData.floor = floor.floor;
    group.userData.level = floor.level;
    group.userData.baseY = floor.level * 3.2;
    group.position.y = (group.userData.baseY as number) + (exploded ? floor.level * 1.5 : 0);
    root.add(group); floors.push(group);
    const slab = new THREE.Mesh(new THREE.BoxGeometry(maxWidth + 0.8, 0.12, maxDepth + 0.8), new THREE.MeshStandardMaterial({ color: '#ded8cb', transparent: true, opacity: 0.3 }));
    slab.position.set(maxWidth / 2, -0.12, maxDepth / 2); slab.userData.temporaryMaterial = true; group.add(slab);
    floor.rooms.forEach((room, index) => {
      const unplacedIndex = floor.rooms.slice(0, index).filter((item) => item.unplaced).length;
      const shape = room.unplaced && room.shape.kind === 'RECT'
        ? { ...room.shape, x: floor.width + unplacedIndex * 4.5, y: 0 }
        : room.shape;
      const mesh = new THREE.Mesh(createRoomGeometry(shape, 2.4), materialFor(room));
      mesh.position.y += 0.04;
      mesh.userData.room = room; mesh.userData.floor = floor.floor;
      group.add(mesh); meshes.push(mesh);
      if (room.alerts.length) {
        const marker = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), new THREE.MeshBasicMaterial({ color: roomAlertColor(room) }));
        const box = new THREE.Box3().setFromObject(mesh);
        marker.position.set(box.max.x - root!.position.x - 0.28, 2.65, box.min.z - root!.position.z + 0.28);
        group.add(marker);
      }
    });
  }
  scene.add(root);
  selectionLines = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), new THREE.LineBasicMaterial({ color: '#29352c', linewidth: 2 }));
  selectionLines.visible = false; scene.add(selectionLines);
  applyFloor(); fit(); updateSelection();
}
function updateSelection() {
  const selected = meshes.find((mesh) => (mesh.userData.room as SpaceRoomContract).id === props.selectedId);
  if (!selectionLines || !selected) { if (selectionLines) selectionLines.visible = false; requestRender(); return; }
  selectionLines.position.set(0, 0, 0);
  selectionLines.scale.set(1, 1, 1);
  selectionLines.updateMatrix();
  selectionLines.geometry.dispose();
  selectionLines.geometry = new THREE.EdgesGeometry(selected.geometry);
  selectionLines.position.copy(selected.position);
  selectionLines.parent?.remove(selectionLines);
  selected.parent?.add(selectionLines);
  selectionLines.visible = selected.parent?.visible !== false;
  requestRender();
}
function applyFloor() {
  floors.forEach((group) => { group.visible = floorFilter.value === 'all' || String(group.userData.floor) === floorFilter.value; });
  const active = floorFilter.value === 'all' ? root : floors.find((group) => String(group.userData.floor) === floorFilter.value);
  if (active) fit(active);
}
function toggleExploded() {
  exploded.value = !exploded.value;
  floors.forEach((group) => { group.position.y = (group.userData.baseY as number) + (exploded.value ? Number(group.userData.level) * 1.5 : 0); });
  fit();
}
function resetView() { fit(floorFilter.value === 'all' ? root! : floors.find((group) => String(group.userData.floor) === floorFilter.value)!); }
function pick(event: PointerEvent) {
  if (!camera || !canvas.value) return undefined;
  const rect = canvas.value.getBoundingClientRect();
  const ray = new THREE.Raycaster();
  ray.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1), camera);
  return (ray.intersectObjects(meshes, false).find((hit) => hit.object.parent?.visible !== false)?.object as THREE.Mesh | undefined)?.userData.room as SpaceRoomContract | undefined;
}
function onMove(event: PointerEvent) {
  const room = pick(event); hovered.value = room;
  if (room && host.value) tooltipStyle.value = { left: `${Math.min(event.clientX - host.value.getBoundingClientRect().left + 12, host.value.clientWidth - 190)}px`, top: `${Math.max(8, event.clientY - host.value.getBoundingClientRect().top + 10)}px` };
  if (canvas.value) canvas.value.style.cursor = room ? 'pointer' : 'grab';
}
function onUp(event: PointerEvent) {
  if (pointerDown && Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y) < 5) { const room = pick(event); if (room) emit('select', room); }
  pointerDown = undefined;
}
function resize() {
  if (!renderer || !camera || !host.value) return;
  const width = host.value.clientWidth || 878; const height = host.value.clientHeight || 450;
  renderer.setSize(width, height, false); camera.left = -height * width / height / 2; camera.right = -camera.left; camera.top = height / 2; camera.bottom = -height / 2; camera.updateProjectionMatrix(); fit(floorFilter.value === 'all' ? root! : floors.find((group) => String(group.userData.floor) === floorFilter.value)!);
}
onMounted(() => {
  if (!canvas.value || !host.value) return;
  try { renderer = new THREE.WebGLRenderer({ canvas: canvas.value, alpha: true, antialias: true, powerPreference: 'high-performance' }); }
  catch { unsupported.value = true; emit('unsupported'); return; }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  scene = new THREE.Scene(); camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 2000);
  scene.add(new THREE.HemisphereLight(0xfffaf0, 0xd7d0c0, 1.5));
  const light = new THREE.DirectionalLight(0xffffff, 1.4); light.position.set(12, 20, 10); scene.add(light);
  controls = new OrbitControls(camera, canvas.value); controls.enableDamping = false; controls.addEventListener('change', requestRender);
  build(); resize();
  canvas.value.addEventListener('pointermove', onMove); canvas.value.addEventListener('pointerleave', () => { hovered.value = undefined; });
  canvas.value.addEventListener('pointerdown', (event) => { pointerDown = { x: event.clientX, y: event.clientY }; }); canvas.value.addEventListener('pointerup', onUp);
  resizeObserver = new ResizeObserver(resize); resizeObserver.observe(host.value);
});
watch(() => props.model, build);
watch(() => props.selectedId, updateSelection);
onBeforeUnmount(() => {
  disposed = true; if (frame) cancelAnimationFrame(frame); resizeObserver?.disconnect(); controls?.removeEventListener('change', requestRender); controls?.dispose();
  if (root) disposeRoot(); selectionLines?.geometry.dispose(); (selectionLines?.material as THREE.Material | undefined)?.dispose(); renderer?.dispose(); renderer?.forceContextLoss();
});
defineExpose({ resetView, isolateFloor(floor: number | null) { floorFilter.value = floor == null ? 'all' : String(floor); applyFloor(); }, setExploded(value: boolean) { if (exploded.value !== value) toggleExploded(); } });
</script>

<style scoped>
.contract-scene{position:relative;width:100%;height:450px;min-height:400px;overflow:hidden;border:1px solid #e8e2d7;border-radius:12px;background:linear-gradient(180deg,#fbfaf6,#f2efe7)}.scene-canvas{width:100%;height:100%;display:block;cursor:grab}.toolbar{position:absolute;z-index:2;top:12px;left:12px;display:flex;align-items:center;gap:8px;padding:7px;border:1px solid #e8e2d7;border-radius:9px;background:#fffdf4eF;color:#615e56;font-size:12px}.toolbar button,.toolbar select{border:1px solid #e2ddd2;border-radius:6px;background:#fffdf8;color:#4f5149;padding:5px 8px}.tooltip{position:absolute;z-index:3;display:grid;grid-template-columns:1fr auto;gap:5px 12px;min-width:150px;padding:9px 11px;border:1px solid #e2dbcd;border-radius:8px;background:#fffdf4ed;color:#615e56;font-size:12px;pointer-events:none}.tooltip p{grid-column:1/-1;margin:0}.tooltip .alert{color:#a8543d}.hint{position:absolute;right:12px;bottom:10px;color:#898478;font-size:10px;pointer-events:none}.fallback{position:absolute;inset:0;z-index:4;overflow:auto;padding:54px 14px 14px;background:#faf8f2;color:#514f47}.fallback>strong{display:block;margin-bottom:12px}.fallback-rooms{display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:8px}.room-card{display:grid;gap:4px;text-align:left;padding:9px;border:1px solid #e5dfd4;border-radius:8px;background:white;color:#56544d}.room-card.selected{outline:2px solid #75856b}.room-card span{font-size:11px}.room-card i{color:#a8543d;font-size:10px;font-style:normal}@media(max-width:600px){.contract-scene{height:400px}.hint{display:none}}
</style>
