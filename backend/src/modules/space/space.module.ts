import { Module } from '@nestjs/common';
import { SpaceController, PublicSpaceController } from './space.controller.js';
import { SpaceService } from './space.service.js';

@Module({ controllers: [SpaceController, PublicSpaceController], providers: [SpaceService], exports: [SpaceService] })
export class SpaceModule {}
