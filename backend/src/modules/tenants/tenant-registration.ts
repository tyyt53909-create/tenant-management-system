import { ConflictException } from '@nestjs/common';
import type { RegistrationStatus } from '@prisma/client';

/**
 * 居住登记状态机（SEC-08 / T271）。
 *
 * NOT_REGISTERED 只能前进；REGISTERED / REJECTED 之间允许纠错，但任何状态都不能回到 NOT_REGISTERED。
 */
export const REGISTRATION_TRANSITIONS: Record<RegistrationStatus, RegistrationStatus[]> = {
  NOT_REGISTERED: ['PENDING', 'REGISTERED'],
  PENDING: ['REGISTERED', 'REJECTED'],
  REJECTED: ['PENDING', 'REGISTERED'],
  REGISTERED: ['PENDING', 'REJECTED'],
};

export function assertRegistrationTransition(
  from: RegistrationStatus,
  to: RegistrationStatus,
): void {
  if (from === to) return;
  if (!REGISTRATION_TRANSITIONS[from].includes(to)) {
    throw new ConflictException(`居住登记状态不能从 ${from} 变更为 ${to}`);
  }
}
