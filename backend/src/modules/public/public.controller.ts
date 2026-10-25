import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../../common/decorators/public.decorator.js';
import { PublicService } from './public.service.js';
import { QueryPublicRoomsDto } from './dto/query-public-rooms.dto.js';
import { BillReceiptService } from '../bills/bill-receipt.service.js';

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
