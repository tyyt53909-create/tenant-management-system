import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  SETTING_DEFINITIONS,
  SETTING_KEYS,
  SettingValidationError,
  getSettingDefinition,
  isSettingKey,
  type SettingDefinition,
  type SettingKey,
} from './settings.registry.js';
import type { ActorContext } from './settings.types.js';

export interface SettingView<T = unknown> {
  key: string;
  description: string;
  value: T;
  defaultValue: T;
  isDefault: boolean;
  updatedBy: string | null;
  updatedAt: Date | null;
}

/**
 * 业务设置中心（FIN-11 / T276）。
 *
 * - 读：数据库有值用数据库，否则用注册表默认值（显式返回 `isDefault`）。
 * - 写：先经注册表归一化/校验，再 upsert，并在同一事务内写 before/after 审计。
 * - 不做进程内缓存：M2 单机规模下每次读库更简单，也避免多实例不一致。
 */
@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<SettingView[]> {
    const rows = await this.prisma.systemSetting.findMany();
    const byKey = new Map(rows.map((row) => [row.key, row]));
    return SETTING_KEYS.map((key) => {
      const definition = getSettingDefinition(key);
      const row = byKey.get(key);
      return {
        key,
        description: definition.description,
        value: row?.value ?? definition.defaultValue,
        defaultValue: definition.defaultValue,
        isDefault: !row,
        updatedBy: row?.updatedBy ?? null,
        updatedAt: row?.updatedAt ?? null,
      };
    });
  }

  async getOne(key: string): Promise<SettingView> {
    const definition = this.requireDefinition(key);
    const row = await this.prisma.systemSetting.findUnique({ where: { key } });
    return {
      key,
      description: definition.description,
      value: row?.value ?? definition.defaultValue,
      defaultValue: definition.defaultValue,
      isDefault: !row,
      updatedBy: row?.updatedBy ?? null,
      updatedAt: row?.updatedAt ?? null,
    };
  }

  /** 业务代码读取单个设置值（含默认值），不返回设置元信息。 */
  async getValue<T>(key: SettingKey): Promise<T> {
    const row = await this.prisma.systemSetting.findUnique({ where: { key } });
    return (row?.value ?? getSettingDefinition(key).defaultValue) as T;
  }

  async update(key: string, rawValue: unknown, actor: ActorContext): Promise<SettingView> {
    const definition = this.requireDefinition(key);
    const value = this.normalize(definition, rawValue);

    const updated = await this.prisma.$transaction(async (tx) => {
      const before = await tx.systemSetting.findUnique({ where: { key } });
      const row = await tx.systemSetting.upsert({
        where: { key },
        create: {
          key,
          value: value as never,
          description: definition.description,
          updatedBy: actor.userId,
        },
        update: {
          value: value as never,
          description: definition.description,
          updatedBy: actor.userId,
        },
      });

      // 设置变更必须有 before/after；显式写审计（拦截器只记录请求体，没有 before）
      await tx.auditLog.create({
        data: {
          userId: actor.userId || null,
          action: 'UPDATE_SETTING',
          entityType: 'SystemSetting',
          entityId: key,
          changes: {
            before: before?.value ?? definition.defaultValue,
            after: value,
          } as never,
          ip: actor.ip || 'unknown',
          userAgent: actor.userAgent || 'unknown',
        },
      });

      return row;
    });

    return {
      key,
      description: definition.description,
      value: updated.value,
      defaultValue: definition.defaultValue,
      isDefault: false,
      updatedBy: updated.updatedBy,
      updatedAt: updated.updatedAt,
    };
  }

  private requireDefinition(key: string): SettingDefinition<unknown> {
    if (!isSettingKey(key)) {
      throw new NotFoundException(`未知设置项：${key}（可选：${SETTING_KEYS.join(', ')}）`);
    }
    if (!Object.hasOwn(SETTING_DEFINITIONS, key)) {
      throw new NotFoundException(`未知设置项：${key}`);
    }
    return getSettingDefinition(key);
  }

  private normalize(definition: SettingDefinition<unknown>, rawValue: unknown): unknown {
    try {
      return definition.normalize(rawValue);
    } catch (error) {
      if (error instanceof SettingValidationError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }
}
