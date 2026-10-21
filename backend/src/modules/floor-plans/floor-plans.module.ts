import { Module } from '@nestjs/common';
import { FloorPlansController } from './floor-plans.controller.js';
import { FloorPlansService } from './floor-plans.service.js';

@Module({ controllers: [FloorPlansController], providers: [FloorPlansService], exports: [FloorPlansService] })
export class FloorPlansModule {}
