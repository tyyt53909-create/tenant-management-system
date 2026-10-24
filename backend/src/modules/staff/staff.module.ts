import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { StaffController } from './staff.controller.js';
import { StaffService } from './staff.service.js';

@Module({ imports: [PrismaModule, AuthModule], controllers: [StaffController], providers: [StaffService] })
export class StaffModule {}
