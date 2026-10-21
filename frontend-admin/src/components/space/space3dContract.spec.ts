import { describe, expect, it } from 'vitest';
import { authoredSpaceFixture, autoSpaceFixture, largeSpaceFixture } from '@/utils/__fixtures__/spaceModel.fixture';
import { createRoomGeometry, roomAlertColor, SPACE_STATE_STYLE } from './space3dContract';

describe('contract 3D renderer data layer', () => {
  it('creates extruded rectangle and authored polygon geometries from fixture', () => {
    const authored = authoredSpaceFixture.floors.flatMap((floor) => floor.rooms);
    const polygon = authored.find((room) => room.shape.kind === 'POLYGON')!;
    expect(polygon.shape.kind).toBe('POLYGON');
    const polygonGeometry = createRoomGeometry(polygon.shape, 2.4);
    const rectGeometry = createRoomGeometry(authored.find((room) => room.shape.kind === 'RECT')!.shape, 2.4);
    expect(polygonGeometry.attributes.position.count).toBeGreaterThan(10);
    expect(polygonGeometry.boundingBox!.max.y - polygonGeometry.boundingBox!.min.y).toBeCloseTo(2.4);
    expect(rectGeometry.boundingBox!.max.y - rectGeometry.boundingBox!.min.y).toBeCloseTo(2.4);
    polygonGeometry.dispose(); rectGeometry.dispose();
  });

  it('maps all six operational states and alert severities to visible colors', () => {
    expect(Object.keys(SPACE_STATE_STYLE)).toHaveLength(7);
    const rooms = autoSpaceFixture.floors.flatMap((floor) => floor.rooms);
    expect(roomAlertColor({ ...rooms[0]!, alerts: [{ type: 'REPAIR', severity: 'info' }] })).toBe('#397b9b');
    expect(roomAlertColor({ ...rooms[0]!, alerts: [{ type: 'OVERDUE' }] })).toBe('#c7473d');
  });

  it('accepts the 168-room performance fixture with geometry data for every placed room', () => {
    const rooms = largeSpaceFixture.floors.flatMap((floor) => floor.rooms);
    expect(rooms).toHaveLength(168);
    for (const room of rooms) expect(room.shape.kind).toBe('RECT');
  });
});
