import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Response } from 'express';
import { PublicController } from './public.controller.js';
import { PublicService } from './public.service.js';
import { BillReceiptService } from '../bills/bill-receipt.service.js';

describe('PublicController', () => {
  let controller: PublicController;
  let publicService: any;
  let receiptService: {
    verifyReceipt: ReturnType<typeof vi.fn>;
    generatePublicReceiptPdf: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    publicService = {
      listBuildings: vi.fn(),
      listRooms: vi.fn(),
      getRoom: vi.fn(),
    };
    receiptService = {
      verifyReceipt: vi.fn(),
      generatePublicReceiptPdf: vi.fn(),
    };
    controller = new PublicController(
      publicService as unknown as PublicService,
      receiptService as unknown as BillReceiptService,
      { verifyToken: vi.fn().mockResolvedValue({ sub: 'user-1' }) } as any,
    );
  });

  describe('room browsing', () => {
    it('listBuildings delegates to service', async () => {
      publicService.listBuildings.mockResolvedValue([{ id: 'b1', name: 'Building 1' }]);
      const res = await controller.listBuildings();
      expect(res).toEqual([{ id: 'b1', name: 'Building 1' }]);
      expect(publicService.listBuildings).toHaveBeenCalled();
    });

    it('listRooms delegates to service', async () => {
      publicService.listRooms.mockResolvedValue({ total: 1, items: [{ id: 'r1' }] });
      const res = await controller.listRooms({ page: 1, limit: 10 });
      expect(res).toEqual({ total: 1, items: [{ id: 'r1' }] });
      expect(publicService.listRooms).toHaveBeenCalledWith({ page: 1, limit: 10 });
    });

    it('getRoom delegates to service', async () => {
      publicService.getRoom.mockResolvedValue({ id: 'r1', roomNumber: '101' });
      const res = await controller.getRoom('r1');
      expect(res).toEqual({ id: 'r1', roomNumber: '101' });
      expect(publicService.getRoom).toHaveBeenCalledWith('r1');
    });

    it('getRoomShareInfo, createLead, createAppointment 正常委托 service 处理', async () => {
      publicService.getRoomShareInfo = vi.fn().mockResolvedValue({ title: '分享' });
      publicService.createLead = vi.fn().mockResolvedValue({ id: 'lead-1' });
      publicService.createAppointment = vi.fn().mockResolvedValue({ id: 'appt-1' });

      expect(await controller.getRoomShareInfo('r1')).toEqual({ title: '分享' });
      expect(await controller.createLead({ name: '张', phone: '13800000000' } as any)).toEqual({ id: 'lead-1' });
      expect(await controller.createAppointment({ roomId: 'r1' } as any, { headers: {} } as any)).toEqual({ id: 'appt-1' });
    });
  });

  describe('receipt verification and pdf export', () => {
    it('verifyReceipt by path param delegates to receiptService', async () => {
      receiptService.verifyReceipt.mockResolvedValue({
        valid: true,
        receiptNumber: 'R20261025000001',
      });
      const res = await controller.verifyReceipt('R20261025000001', 'CODE123');
      expect(res.valid).toBe(true);
      expect(receiptService.verifyReceipt).toHaveBeenCalledWith('R20261025000001', 'CODE123');
    });

    it('verifyReceiptByQuery delegates to receiptService', async () => {
      receiptService.verifyReceipt.mockResolvedValue({
        valid: true,
        receiptNumber: 'R20261025000001',
      });
      const res = await controller.verifyReceiptByQuery('R20261025000001', 'CODE123');
      expect(res.valid).toBe(true);
      expect(receiptService.verifyReceipt).toHaveBeenCalledWith('R20261025000001', 'CODE123');
    });

    it('getPublicReceiptPdf writes pdf buffer to response stream', async () => {
      const mockPdfBuffer = Buffer.from('%PDF-1.4 test content %%EOF');
      receiptService.generatePublicReceiptPdf.mockResolvedValue(mockPdfBuffer);

      const res = {
        setHeader: vi.fn(),
        end: vi.fn(),
      } as unknown as Response;

      await controller.getPublicReceiptPdf('R20261025000001', res);

      expect(receiptService.generatePublicReceiptPdf).toHaveBeenCalledWith('R20261025000001');
      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/pdf');
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        'inline; filename="receipt-R20261025000001.pdf"',
      );
      expect(res.end).toHaveBeenCalledWith(mockPdfBuffer);
    });
  });
});
