import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { describe, expect, it } from 'vitest';
import {
  CreateStaffDto,
  UpdateStaffDto,
  QueryStaffDto,
  AssignStaffBuildingsDto,
  STAFF_ROLES,
} from './staff.dto.js';

const validateDto = (dto: object) =>
  validate(dto, { whitelist: true, forbidNonWhitelisted: true });

describe('Staff DTOs validation', () => {
  it('CreateStaffDto validates valid staff roles and accepts buildingIds', async () => {
    for (const role of STAFF_ROLES) {
      const dto = plainToInstance(CreateStaffDto, {
        email: `staff-${role.toLowerCase()}@example.com`,
        password: '{{SECRET_x7jpt5g6}}',
        role,
        buildingIds: ['b-1', 'b-2'],
      });
      const errors = await validateDto(dto);
      expect(errors).toHaveLength(0);
    }
  });

  it('CreateStaffDto rejects TENANT role or invalid email', async () => {
    const dto = plainToInstance(CreateStaffDto, {
      email: 'not-an-email',
      password: 'short',
      role: 'TENANT',
    });
    const errors = await validateDto(dto);
    expect(errors.some((e) => e.property === 'role')).toBe(true);
    expect(errors.some((e) => e.property === 'email')).toBe(true);
    expect(errors.some((e) => e.property === 'password')).toBe(true);
  });

  it('UpdateStaffDto validates role and buildingIds', async () => {
    const dto = plainToInstance(UpdateStaffDto, {
      role: 'FINANCIAL',
      isActive: false,
      buildingIds: ['b-1'],
    });
    const errors = await validateDto(dto);
    expect(errors).toHaveLength(0);
  });

  it('AssignStaffBuildingsDto requires string array', async () => {
    const valid = plainToInstance(AssignStaffBuildingsDto, { buildingIds: ['b1', 'b2'] });
    expect(await validateDto(valid)).toHaveLength(0);

    const invalid = plainToInstance(AssignStaffBuildingsDto, { buildingIds: 'not-an-array' });
    const errors = await validateDto(invalid);
    expect(errors.some((e) => e.property === 'buildingIds')).toBe(true);
  });
});
