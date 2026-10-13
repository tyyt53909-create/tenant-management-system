import { Controller, Get, Post, Body, Patch, Param, Delete, Query, UseGuards, Request } from '@nestjs/common';
import { MetersService } from './meters.service.js';
import { CreateMeterDto } from './dto/create-meter.dto.js';
import { UpdateMeterDto } from './dto/update-meter.dto.js';
import { QueryMetersDto } from './dto/query-meters.dto.js';
import { CreateMeterReadingDto } from './dto/create-meter-reading.dto.js';
import { QueryMeterReadingsDto } from './dto/query-meter-readings.dto.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles } from '../../common/decorators/roles.decorator.js';

@Controller('meters')
@UseGuards(JwtAuthGuard)
export class MetersController {
  constructor(private readonly metersService: MetersService) {}

  @Post()
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  create(@Body() createMeterDto: CreateMeterDto) {
    return this.metersService.create(createMeterDto);
  }

  // 水电表档案：仅管理者（docs/03-权限矩阵.md §3.5，租客仅可看自己房间读数）
  @Get()
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  findAll(@Query() query: QueryMetersDto) {
    return this.metersService.findAll(query);
  }

  // 登記讀數（自動扣費，僅 ADMIN）
  @Post(':id/readings')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  createReading(
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: CreateMeterReadingDto,
  ) {
    return this.metersService.createReading(id, dto, req.user.userId);
  }

  // 讀數歷史（分頁）
  @Get(':id/readings')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  findReadings(@Param('id') id: string, @Query() query: QueryMeterReadingsDto) {
    return this.metersService.findReadings(id, query);
  }

  @Get(':id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  findOne(@Param('id') id: string) {
    return this.metersService.findOne(id);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  update(@Param('id') id: string, @Body() updateMeterDto: UpdateMeterDto) {
    return this.metersService.update(id, updateMeterDto);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  remove(@Param('id') id: string) {
    return this.metersService.remove(id);
  }
}
