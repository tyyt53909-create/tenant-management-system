import { Controller, Get, Param, Post, Body, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { CurrentUser, resolveAuthUser, type CurrentUserParam } from '../../common/decorators/current-user.decorator.js';
import { DepositsService } from './deposits.service.js';
import { DepositAmountDto, TransferDepositDto } from './dto/deposit.dto.js';

@Controller('deposits')
@UseGuards(JwtAuthGuard)
export class DepositsController {
  constructor(private readonly depositsService: DepositsService) {}

  /** 押金台账（ADMIN 任意，TENANT 仅自己的合同） */
  @Get(':contractId')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'TENANT')
  async get(@CurrentUser() userParam: CurrentUserParam, @Param('contractId') contractId: string) {
    const user = resolveAuthUser(userParam);
    if (user.role === 'TENANT') {
      return this.depositsService.getForTenant(contractId, user.tenantId ?? '');
    }
    return this.depositsService.getByContract(contractId);
  }

  @Post(':contractId/deduct')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  deduct(
    @CurrentUser() userParam: CurrentUserParam,
    @Param('contractId') contractId: string,
    @Body() dto: DepositAmountDto,
  ) {
    const user = resolveAuthUser(userParam);
    return this.depositsService.deduct(contractId, dto.amount, dto.reason, user.userId, dto.idempotencyKey);
  }

  @Post(':contractId/refund')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  refund(
    @CurrentUser() userParam: CurrentUserParam,
    @Param('contractId') contractId: string,
    @Body() dto: DepositAmountDto,
  ) {
    const user = resolveAuthUser(userParam);
    return this.depositsService.refund(contractId, dto.amount, dto.reason, user.userId, dto.idempotencyKey);
  }

  @Post(':contractId/transfer')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  transfer(
    @CurrentUser() userParam: CurrentUserParam,
    @Param('contractId') contractId: string,
    @Body() dto: TransferDepositDto,
  ) {
    const user = resolveAuthUser(userParam);
    return this.depositsService.transfer(contractId, dto.toContractId, user.userId, dto.idempotencyKey);
  }
}
