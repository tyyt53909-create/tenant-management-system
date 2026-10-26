import { Controller, Get, Post, Body, Param, Query, Res, Req } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Public } from '../../common/decorators/public.decorator.js';
import { PublicService } from './public.service.js';
import { QueryPublicRoomsDto } from './dto/query-public-rooms.dto.js';
import { CreatePublicLeadDto } from './dto/create-lead.dto.js';
import { CreatePublicAppointmentDto } from './dto/create-appointment.dto.js';
import { BillReceiptService } from '../bills/bill-receipt.service.js';
import { JwtAuthService } from '../auth/jwt.service.js';

/**
 * 公开接口（看房、收据验真与下载）—— **无需登录**。
 *
 * 路由置于 /public 前缀下，便于在网关或反代层单独限流。
 */
@Controller('public')
@Public()
export class PublicController {
  constructor(
    private readonly publicService: PublicService,
    private readonly receiptService: BillReceiptService,
    private readonly jwtAuthService: JwtAuthService,
  ) {}

  /** 可租楼栋列表 */
  @Get('buildings')
  listBuildings() {
    return this.publicService.listBuildings();
  }

  /** 可租房源列表 */
  @Get('rooms')
  listRooms(@Query() query: QueryPublicRoomsDto) {
    return this.publicService.listRooms(query);
  }

  /** 可租房源详情（不可租/不存在均 404） */
  @Get('rooms/:id')
  getRoom(@Param('id') id: string) {
    return this.publicService.getRoom(id);
  }

  /** 获取房源标准化微信分享卡片与海报数据（LSE-01 / T298） */
  @Get('rooms/:id/share')
  getRoomShareInfo(@Param('id') id: string) {
    return this.publicService.getRoomShareInfo(id);
  }

  /** 访客提交找房意向留资（免登录） */
  @Post('leads')
  createLead(@Body() dto: CreatePublicLeadDto) {
    return this.publicService.createLead(dto);
  }

  /** 访客/租客发起预约看房（免登录或携带用户 Token） */
  @Post('appointments')
  async createAppointment(@Body() dto: CreatePublicAppointmentDto, @Req() req: Request) {
    let userId: string | undefined = (req as any).user?.userId || (req as any).user?.id;
    if (!userId) {
      const authHeader = req.headers['authorization'];
      if (authHeader && typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
        const token = authHeader.slice(7);
        try {
          const payload = await this.jwtAuthService.verifyToken(token);
          userId = payload.sub;
        } catch {
          // 可选鉴权失败忽略
        }
      }
    }
    return this.publicService.createAppointment(dto, userId);
  }

  /**
   * 收据公开防伪验真（按收据编号路径）
   */
  @Get('receipts/:receiptNumber/verify')
  verifyReceipt(
    @Param('receiptNumber') receiptNumber: string,
    @Query('code') code?: string,
  ) {
    return this.receiptService.verifyReceipt(receiptNumber, code);
  }

  /**
   * 收据公开防伪验真（按 query 参数）
   */
  @Get('receipts/verify')
  verifyReceiptByQuery(
    @Query('receiptNumber') receiptNumber: string,
    @Query('code') code?: string,
  ) {
    return this.receiptService.verifyReceipt(receiptNumber, code);
  }

  /**
   * 验真收据 PDF 文档公开导出下载
   */
  @Get('receipts/:receiptNumber/pdf')
  async getPublicReceiptPdf(
    @Param('receiptNumber') receiptNumber: string,
    @Res() res: Response,
  ) {
    const pdfBuffer = await this.receiptService.generatePublicReceiptPdf(receiptNumber);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="receipt-${receiptNumber}.pdf"`);
    res.end(pdfBuffer);
  }
}
