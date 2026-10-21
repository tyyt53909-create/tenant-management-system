import * as THREE from 'three';
import type { SpaceRoomContract, SpaceShape, SpaceState } from '@/types/space';

export const SPACE_STATE_STYLE: Record<SpaceState, { label: string; color: string }> = {
  OCCUPIED: { label: '已出租', color: '#6b8ba6' },
  RESERVED: { label: '已预订', color: '#9a84a8' },
  RENTABLE: { label: '可出租', color: '#6f9a66' },
  PENDING_CLEAN: { label: '待清洁', color: '#d47a55' },
  CLEANING: { label: '清洁中', color: '#c45d4c' },
  MAINTENANCE: { label: '维修中', color: '#a6473c' },
  UNKNOWN: { label: '状态异常', color: '#9b8fa8' },
};

export function createRoomGeometry(shape: SpaceShape, height: number): THREE.ExtrudeGeometry {
  const path = new THREE.Shape();
  if (shape.kind === 'RECT') {
    path.moveTo(shape.x, -shape.y);
    path.lineTo(shape.x + shape.width, -shape.y);
    path.lineTo(shape.x + shape.width, -(shape.y + shape.depth));
    path.lineTo(shape.x, -(shape.y + shape.depth));
  } else {
    shape.points.forEach(([x, y], index) => {
      if (index === 0) path.moveTo(x, -y);
      else path.lineTo(x, -y);
    });
  }
  path.closePath();
  const geometry = new THREE.ExtrudeGeometry(path, { depth: height, bevelEnabled: false, steps: 1 });
  geometry.rotateX(-Math.PI / 2);
  geometry.computeBoundingBox();
  return geometry;
}

export function roomAlertColor(room: SpaceRoomContract): string | undefined {
  if (!room.alerts.length) return undefined;
  if (room.alerts.some((alert) => alert.severity === 'danger' || alert.type === 'OVERDUE')) return '#c7473d';
  if (room.alerts.some((alert) => alert.severity === 'warning' || alert.type === 'EXPIRING')) return '#d18a2e';
  return '#397b9b';
}
