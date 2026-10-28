import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { CreateCleaningTaskDto } from './create-cleaning-task.dto.js';
import { QueryCleaningTasksDto } from './query-cleaning-tasks.dto.js';
import { AssignCleanerDto } from './assign-cleaner.dto.js';
import { CompleteCleaningDto } from './complete-cleaning.dto.js';
import { AcceptCleaningDto, RejectCleaningDto } from './accept-cleaning.dto.js';
import { CleaningTaskStatus, CleaningTaskType } from '@prisma/client';

describe('Cleaning DTOs', () => {
  it('CreateCleaningTaskDto 实例化与属性赋值', () => {
    const dto = new CreateCleaningTaskDto();
    dto.roomId = 'r1';
    dto.type = CleaningTaskType.CHECKOUT;
    dto.cleanerId = 'c1';
    dto.beforePhotos = ['p1.jpg'];
    dto.notes = 'note';
    expect(dto.roomId).toBe('r1');
    expect(dto.type).toBe(CleaningTaskType.CHECKOUT);
    expect(dto.cleanerId).toBe('c1');
    expect(dto.beforePhotos).toEqual(['p1.jpg']);
    expect(dto.notes).toBe('note');
  });

  it('QueryCleaningTasksDto 默认值与参数赋值', () => {
    const dto = new QueryCleaningTasksDto();
    expect(dto.page).toBe(1);
    expect(dto.limit).toBe(20);
    dto.status = CleaningTaskStatus.PENDING;
    dto.type = CleaningTaskType.DAILY;
    dto.buildingId = 'b1';
    dto.roomId = 'r1';
    dto.cleanerId = 'c1';
    dto.page = 2;
    dto.limit = 50;
    expect(dto.status).toBe(CleaningTaskStatus.PENDING);
    expect(dto.type).toBe(CleaningTaskType.DAILY);
    expect(dto.buildingId).toBe('b1');
  });

  it('AssignCleanerDto 属性赋值', () => {
    const dto = new AssignCleanerDto();
    dto.cleanerId = 'cleaner-1';
    expect(dto.cleanerId).toBe('cleaner-1');
  });

  it('CompleteCleaningDto 属性赋值', () => {
    const dto = new CompleteCleaningDto();
    dto.afterPhotos = ['photo.jpg'];
    dto.notes = 'cleaned';
    expect(dto.afterPhotos).toEqual(['photo.jpg']);
    expect(dto.notes).toBe('cleaned');
  });

  it('AcceptCleaningDto 与 RejectCleaningDto 属性赋值', () => {
    const acceptDto = new AcceptCleaningDto();
    acceptDto.rating = 5;
    acceptDto.acceptanceNotes = 'great job';
    expect(acceptDto.rating).toBe(5);
    expect(acceptDto.acceptanceNotes).toBe('great job');

    const rejectDto = new RejectCleaningDto();
    rejectDto.reason = 'need rework';
    expect(rejectDto.reason).toBe('need rework');
  });
});
