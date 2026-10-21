import { describe, expect, it } from 'vitest';
import { authoredSpaceFixture, autoSpaceFixture } from '@/utils/__fixtures__/spaceModel.fixture';
import { buildSpaceContractModel, contractRoomLabel } from '@/utils/spaceContractModel';

describe('space contract renderer adapter', () => {
  it('preserves contract summary and sorts floors/room numbers naturally', () => {
    const model = buildSpaceContractModel(autoSpaceFixture);
    expect(model.layoutMode).toBe('AUTO');
    expect(model.summary).toEqual(autoSpaceFixture.summary);
    expect(model.floors.map((floor) => floor.floor)).toEqual([4, 3, 2, 1]);
    expect(model.floors[1]?.rooms.map((room) => room.roomNumber)).toEqual(['301', '302', '303']);
    expect(model.floors[1]?.layoutMode).toBe('AUTO');
  });

  it('supports AUTHORED RECT/POLYGON and keeps unplaced rooms visible separately', () => {
    const model = buildSpaceContractModel(authoredSpaceFixture);
    expect(model.layoutMode).toBe('AUTHORED');
    expect(model.floors[0]?.rooms[0]?.shape.kind).toBe('POLYGON');
    expect(model.floors[1]?.unplacedRooms.map((room) => room.roomNumber)).toEqual(['102']);
    expect(model.floors[1]?.rooms[0]?.shape.kind).toBe('RECT');
  });

  it('retains all six render states and alerts', () => {
    const model = buildSpaceContractModel(autoSpaceFixture);
    const states = new Set(model.floors.flatMap((floor) => floor.rooms.map((room) => room.state)));
    expect(states).toEqual(new Set(['OCCUPIED', 'RESERVED', 'RENTABLE', 'PENDING_CLEAN', 'CLEANING', 'MAINTENANCE', 'UNKNOWN']));
    expect(model.floors.flatMap((floor) => floor.rooms).some((room) => room.alerts.length > 0)).toBe(true);
  });

  it('truncates long labels to the unique suffix while retaining source room number', () => {
    const model = buildSpaceContractModel(autoSpaceFixture);
    const longRoom = model.floors.flatMap((floor) => floor.rooms).find((room) => room.roomNumber === 'PW2b8oy7h7B');
    expect(longRoom?.label).toBe('…7h7B');
    expect(longRoom?.roomNumber).toBe('PW2b8oy7h7B');
    expect(contractRoomLabel('102')).toBe('102');
  });

  it('keeps empty floors in AUTO layouts', () => {
    const model = buildSpaceContractModel(autoSpaceFixture);
    expect(model.floors.find((floor) => floor.floor === 4)?.rooms).toEqual([]);
  });
});
