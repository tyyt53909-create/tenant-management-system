<template>
  <div ref="host" class="campus-scene">
    <canvas v-show="!unsupported" ref="canvas" class="campus-canvas" :aria-label="`${buildings.length} 栋楼的小区模型`" />
    <div v-if="unsupported" class="campus-fallback" role="status">
      当前浏览器无法显示 3D 小区模型，请使用下方楼栋列表进入。
    </div>
    <div v-if="hovered" class="campus-tooltip" :style="tooltipStyle">
      <strong>{{ hovered.name }}</strong>
      <span>{{ hovered.floors }} 层 · {{ hovered.total }} 间</span>
      <p>可租 {{ hovered.rentable }} · 已租 {{ hovered.occupied }}</p>
      <p v-if="hovered.pendingClean + hovered.cleaning + hovered.maintenance > 0" class="warn">
        待处理 {{ hovered.pendingClean + hovered.cleaning + hovered.maintenance }} 间
      </p>
      <small>点击进入楼层视图</small>
    </div>
    <div class="campus-hint">点击楼栋进入 2D 楼层视图 · 拖拽旋转 · 滚轮缩放</div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import type { CampusBuildingSummary } from '@/types/space';

const props = defineProps<{ buildings: CampusBuildingSummary[] }>();
const emit = defineEmits<{ select: [id: string] }>();

const host = ref<HTMLElement>();
const canvas = ref<HTMLCanvasElement>();
const unsupported = ref(false);
const hovered = ref<CampusBuildingSummary>();
const tooltipX = ref(0);
const tooltipY = ref(0);

const tooltipStyle = computed(() => ({ left: `${tooltipX.value}px`, top: `${tooltipY.value}px` }));

let renderer: THREE.WebGLRenderer | undefined;
let labelRenderer: CSS2DRenderer | undefined;
let scene: THREE.Scene | undefined;
let camera: THREE.OrthographicCamera | undefined;
let controls: OrbitControls | undefined;
let root: THREE.Group | undefined;
let built: THREE.Group | undefined;
let resizeObserver: ResizeObserver | undefined;
let frame = 0;
let disposed = false;
let pointerDown: { x: number; y: number } | null = null;
const meshes: THREE.Mesh[] = [];
const labels: CSS2DObject[] = [];

function statusColor(building: CampusBuildingSummary) {
  const issues = building.pendingClean + building.cleaning + building.maintenance;
  if (building.rentable > 0) return '#6f9a66';
  if (issues > 0) return '#c45d4c';
  if (building.occupied > 0) return '#6b8ba6';
  return '#b8b0a0';
}

function requestRender() {
  if (disposed || frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    if (!renderer || !scene || !camera) return;
    renderer.render(scene, camera);
    labelRenderer?.render(scene, camera);
  });
}

function fit() {
  if (!camera || !controls || !host.value) return;
  const target = built ?? root;
  if (!target) return;
  const box = new THREE.Box3().setFromObject(target);
  if (box.isEmpty()) return;
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const span = Math.max(size.x, size.z, 24);
  const aspect = (host.value.clientWidth || 800) / (host.value.clientHeight || 440);
  const viewHeight = Math.max(span * 0.95, (size.y + 12) * 1.2);
  camera.left = (-viewHeight * aspect) / 2;
  camera.right = (viewHeight * aspect) / 2;
  camera.top = viewHeight / 2;
  camera.bottom = -viewHeight / 2;
  camera.near = 0.1;
  camera.far = span * 20;
  camera.position.copy(center).add(new THREE.Vector3(1, 1.15, 1).normalize().multiplyScalar(span * 2.2));
  camera.lookAt(center);
  camera.updateProjectionMatrix();
  controls.target.copy(center);
  controls.minZoom = 0.6;
  controls.maxZoom = 2.8;
  controls.minPolarAngle = Math.PI * 0.18;
  controls.maxPolarAngle = Math.PI * 0.48;
  controls.update();
  requestRender();
}

function disposeRoot() {
  if (!root) return;
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    mesh.geometry?.dispose();
    if (mesh.userData.temporaryMaterial) (mesh.material as THREE.Material).dispose();
  });
  for (const label of labels) label.element?.remove();
  labels.length = 0;
  meshes.length = 0;
  scene?.remove(root);
  root = undefined;
  built = undefined;
}

function build() {
  if (!scene) return;
  disposeRoot();
  root = new THREE.Group();
  built = new THREE.Group();
  root.add(built);
  scene.add(root);

  const count = props.buildings.length;
  const columns = Math.max(1, Math.ceil(Math.sqrt(count)));
  const rows = Math.max(1, Math.ceil(count / columns));
  const spacing = 17;
  const offsetX = ((columns - 1) * spacing) / 2;
  const offsetZ = ((rows - 1) * spacing) / 2;

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(Math.max(80, columns * spacing + 30), Math.max(80, rows * spacing + 30)),
    new THREE.MeshStandardMaterial({ color: '#f2efe7', roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.12;
  ground.userData.temporaryMaterial = true;
  root.add(ground);
  const grid = new THREE.GridHelper(Math.max(80, columns * spacing + 30), 24, 0xe2ddd2, 0xece8df);
  grid.position.y = -0.08;
  (grid.material as THREE.Material).transparent = true;
  (grid.material as THREE.Material).opacity = 0.55;
  root.add(grid);

  props.buildings.forEach((building, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const group = new THREE.Group();
    group.position.set(column * spacing - offsetX, 0, row * spacing - offsetZ);
    built!.add(group);

    const height = Math.max(6, building.floors * 1.1 + 1.6);
    const color = statusColor(building);

    const plinth = new THREE.Mesh(
      new THREE.BoxGeometry(8.6, 0.35, 8.6),
      new THREE.MeshStandardMaterial({ color: '#ded7ca', roughness: 0.95 }),
    );
    plinth.position.y = 0.18;
    plinth.userData.temporaryMaterial = true;
    group.add(plinth);

    const tower = new THREE.Mesh(
      new THREE.BoxGeometry(6.4, height, 6.4),
      new THREE.MeshStandardMaterial({ color, roughness: 0.82, metalness: 0.01 }),
    );
    tower.position.y = height / 2 + 0.35;
    tower.userData.building = building;
    tower.userData.temporaryMaterial = true;
    group.add(tower);
    meshes.push(tower);

    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(6.45, height, 6.45)),
      new THREE.LineBasicMaterial({ color: '#5e6258', transparent: true, opacity: 0.22 }),
    );
    edges.position.copy(tower.position);
    group.add(edges);

    for (let floor = 0; floor < Math.max(1, building.floors); floor += 1) {
      const band = new THREE.Mesh(
        new THREE.BoxGeometry(6.58, 0.075, 6.58),
        new THREE.MeshBasicMaterial({ color: '#f7f3ea', transparent: true, opacity: 0.75 }),
      );
      band.position.y = 0.55 + floor * 1.1;
      band.userData.temporaryMaterial = true;
      group.add(band);
    }

    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(6.75, 0.22, 6.75),
      new THREE.MeshStandardMaterial({ color: '#d8d0c2', roughness: 0.95 }),
    );
    roof.position.y = height + 0.46;
    roof.userData.temporaryMaterial = true;
    group.add(roof);

    const label = document.createElement('div');
    label.className = 'campus-building-label';
    const name = document.createElement('strong');
    name.textContent = building.name;
    const stats = document.createElement('span');
    stats.textContent = `可租 ${building.rentable} · 已租 ${building.occupied}`;
    label.append(name, stats);
    const labelObject = new CSS2DObject(label);
    labelObject.position.set(0, height + 2.4, 0);
    group.add(labelObject);
    labels.push(labelObject);
  });

  fit();
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

function pick(event: PointerEvent) {
  if (!camera) return undefined;
  const pointer = pointerPosition(event);
  if (!pointer) return undefined;
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(new THREE.Vector2(pointer.x, pointer.y), camera);
  return raycaster.intersectObjects(meshes, false)[0]?.object.userData.building as CampusBuildingSummary | undefined;
}

function onMove(event: PointerEvent) {
  const building = pick(event);
  hovered.value = building;
  if (building) {
    const pointer = pointerPosition(event);
    if (pointer) {
      tooltipX.value = Math.min(pointer.left + 14, (host.value?.clientWidth ?? 800) - 220);
      tooltipY.value = Math.min(pointer.top + 14, (host.value?.clientHeight ?? 440) - 140);
    }
  }
  if (canvas.value) canvas.value.style.cursor = building ? 'pointer' : 'grab';
}

function onUp(event: PointerEvent) {
  if (!pointerDown || Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y) > 5) {
    pointerDown = null;
    return;
  }
  pointerDown = null;
  const building = pick(event);
  if (building) emit('select', building.id);
}

function onResize() {
  if (!renderer || !labelRenderer || !camera || !host.value) return;
  const width = host.value.clientWidth || 800;
  const height = host.value.clientHeight || 440;
  renderer.setSize(width, height, false);
  labelRenderer.setSize(width, height);
  fit();
}

function init() {
  if (!canvas.value || !host.value) return;
  try {
    renderer = new THREE.WebGLRenderer({ canvas: canvas.value, antialias: true, alpha: true });
  } catch {
    unsupported.value = true;
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xfffaf0, 0xd7d0c0, 1.5));
  const sun = new THREE.DirectionalLight(0xfff4df, 1.6);
  sun.position.set(14, 22, 12);
  scene.add(sun);
  camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1000);
  controls = new OrbitControls(camera, canvas.value);
  controls.enableDamping = false;
  controls.addEventListener('change', requestRender);
  labelRenderer = new CSS2DRenderer();
  labelRenderer.domElement.className = 'campus-label-layer';
  labelRenderer.domElement.style.position = 'absolute';
  labelRenderer.domElement.style.inset = '0';
  labelRenderer.domElement.style.pointerEvents = 'none';
  labelRenderer.domElement.style.overflow = 'hidden';
  host.value.appendChild(labelRenderer.domElement);
  build();
  onResize();
  canvas.value.addEventListener('pointermove', onMove);
  canvas.value.addEventListener('pointerleave', () => { hovered.value = undefined; });
  canvas.value.addEventListener('pointerdown', (event) => { pointerDown = { x: event.clientX, y: event.clientY }; });
  canvas.value.addEventListener('pointerup', onUp);
  resizeObserver = new ResizeObserver(onResize);
  resizeObserver.observe(host.value);
  requestRender();
}

watch(() => props.buildings, build, { deep: true });

onMounted(init);
onBeforeUnmount(() => {
  disposed = true;
  if (frame) cancelAnimationFrame(frame);
  resizeObserver?.disconnect();
  controls?.dispose();
  disposeRoot();
  renderer?.dispose();
  labelRenderer?.domElement.remove();
});

defineExpose({ resetView: fit });
</script>

<style scoped>
.campus-scene {
  position: relative;
  width: 100%;
  height: 450px;
  min-height: 400px;
  overflow: hidden;
  border: 1px solid #e8e2d7;
  border-radius: 12px;
  background:
    radial-gradient(circle at 50% 28%, rgba(255, 255, 255, 0.7), transparent 42%),
    linear-gradient(180deg, #fbfaf6 0%, #f1eee6 100%);
}

.campus-canvas {
  display: block;
  width: 100%;
  height: 100%;
  cursor: grab;
}

.campus-canvas:active {
  cursor: grabbing;
}

.campus-tooltip {
  position: absolute;
  z-index: 2;
  display: grid;
  gap: 3px;
  width: 205px;
  padding: 10px 11px;
  border: 1px solid #e2dbcd;
  border-radius: 9px;
  background: rgba(255, 253, 248, 0.97);
  box-shadow: 0 12px 32px rgba(48, 47, 42, 0.12);
  pointer-events: none;
  color: #6f6a60;
  font-size: 11px;
}

.campus-tooltip strong {
  color: #302f2a;
  font-size: 13px;
}

.campus-tooltip span {
  color: #8a8377;
  font-size: 10px;
}

.campus-tooltip p {
  margin: 2px 0;
}

.campus-tooltip .warn {
  color: #b25a4a;
}

.campus-tooltip small {
  margin-top: 3px;
  color: #9b9488;
  font-size: 10px;
}

.campus-hint {
  position: absolute;
  right: 12px;
  bottom: 10px;
  color: #9a9387;
  font-size: 10px;
  pointer-events: none;
}

.campus-fallback {
  display: grid;
  place-items: center;
  height: 100%;
  padding: 24px;
  color: #8d8679;
  font-size: 12px;
  text-align: center;
}

:deep(.campus-building-label) {
  display: grid;
  gap: 2px;
  padding: 4px 7px;
  border: 1px solid rgba(216, 208, 194, 0.8);
  border-radius: 6px;
  background: rgba(255, 253, 248, 0.9);
  color: #5e5b52;
  font-size: 10px;
  white-space: nowrap;
  box-shadow: 0 4px 12px rgba(48, 47, 42, 0.08);
}

:deep(.campus-building-label strong) {
  color: #33352f;
  font-size: 11px;
}

:deep(.campus-building-label span) {
  color: #8b8478;
  font-size: 9px;
}

@media (max-width: 760px) {
  .campus-scene {
    height: 380px;
    min-height: 340px;
  }

  .campus-hint {
    display: none;
  }
}
</style>
