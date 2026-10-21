import { Body, Controller, Get, Param, ParseIntPipe, Post, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { FloorPlansService } from './floor-plans.service.js';
import { SaveFloorPlanDto } from './dto/save-floor-plan.dto.js';

@Controller('buildings/:id/floor-plans')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class FloorPlansController {
  constructor(private readonly floorPlans: FloorPlansService) {}

  @Get()
  findAll(@Param('id') id: string) { return this.floorPlans.findAll(id); }

  @Put(':floor')
  save(@Param('id') id: string, @Param('floor', ParseIntPipe) floor: number, @Body() dto: SaveFloorPlanDto) {
    return this.floorPlans.save(id, floor, dto);
  }

  @Post(':floor/template')
  createTemplate(@Param('id') id: string, @Param('floor', ParseIntPipe) floor: number) {
    return this.floorPlans.createTemplate(id, floor);
  }
}
