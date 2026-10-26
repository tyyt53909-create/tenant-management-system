import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { Prisma, AppointmentStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { QueryAppointmentsDto } from './dto/query-appointments.dto.js';
import {
  ConfirmAppointmentDto,
  CompleteAppointmentDto,
  CancelAppointmentDto,
} from './dto/update-appointment.dto.js';
import { NotificationsService } from '../notifications/notifications.service.js';

@Injectable()
export class AppointmentsService {
  private readonly logger = new Logger(AppointmentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async findAll(query: QueryAppointmentsDto) {
    const { page = 1, limit = 20, status, roomId, phone, startDate, endDate } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.ViewingAppointmentWhereInput = {};
    if (status) where.status = status;
    if (roomId) where.roomId = roomId;
    if (phone) where.phone = { contains: phone };

    if (startDate || endDate) {
      where.appointmentTime = {
        ...(startDate ? { gte: new Date(startDate) } : {}),
        ...(endDate ? { lte: new Date(endDate) } : {}),
      };
    }

    const [data, total] = await Promise.all([
      this.prisma.viewingAppointment.findMany({
        where,
        skip,
        take: limit,
        orderBy: { appointmentTime: 'desc' },
        include: {
          room: {
            select: {
              id: true,
              roomNumber: true,
              floor: true,
              roomType: true,
              listingPrice: true,
              building: { select: { id: true, name: true, address: true } },
            },
          },
        },
      }),
      this.prisma.viewingAppointment.count({ where }),
    ]);

    return {
      data,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findMy(userId: string, userPhone?: string) {
    let phone = userPhone;
    if (!phone) {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { phone: true },
      });
      phone = user?.phone || undefined;
    }

    const where: Prisma.ViewingAppointmentWhereInput = {
      OR: [
        { userId },
        ...(phone ? [{ phone }] : []),
      ],
    };

    return this.prisma.viewingAppointment.findMany({
      where,
      orderBy: { appointmentTime: 'desc' },
      include: {
        room: {
          select: {
            id: true,
            roomNumber: true,
            floor: true,
            roomType: true,
            listingPrice: true,
            building: { select: { id: true, name: true, address: true } },
            photos: {
              select: { fileUrl: true, thumbnail: true, sortOrder: true },
              orderBy: { sortOrder: 'asc' },
              take: 1,
            },
          },
        },
      },
    });
  }

  async findOne(id: string) {
    const appointment = await this.prisma.viewingAppointment.findUnique({
      where: { id },
      include: {
        room: {
          select: {
            id: true,
            roomNumber: true,
            floor: true,
            roomType: true,
            listingPrice: true,
            facilities: true,
            description: true,
            building: { select: { id: true, name: true, address: true } },
            photos: {
              select: { fileUrl: true, thumbnail: true, sortOrder: true },
              orderBy: { sortOrder: 'asc' },
            },
          },
        },
      },
    });

    if (!appointment) {
      throw new NotFoundException('看房预约不存在');
    }

    return appointment;
  }

  /** 管理员确认排期 */
  async confirm(id: string, dto: ConfirmAppointmentDto, operatorId: string) {
    const appointment = await this.findOne(id);
    if (appointment.status !== 'PENDING') {
      throw new BadRequestException(`只有待确认状态的预约可确认排期，当前状态为 ${appointment.status}`);
    }

    const updated = await this.prisma.viewingAppointment.update({
      where: { id },
      data: {
        status: 'CONFIRMED',
        confirmedBy: operatorId,
        confirmedAt: new Date(),
        notes: dto.notes ? `${appointment.notes ? appointment.notes + '\n' : ''}[确认排期] ${dto.notes}` : appointment.notes,
      },
      include: { room: { include: { building: true } } },
    });

    // 触发通知给预约人（若绑定账号）
    if (updated.userId) {
      this.notificationsService.create({
        userId: updated.userId,
        title: '看房预约已确认',
        body: `您预约的 ${updated.room.building.name} ${updated.room.roomNumber}室 看房申请已确认，管家将准时接待。`,
        priority: 'NORMAL' as any,
        data: { appointmentId: updated.id, roomId: updated.roomId },
      }).catch((err) => {
        this.logger.error(`通知预约用户失败: ${err.message}`);
      });
    }

    return updated;
  }

  /** 现场带看完成 */
  async complete(id: string, dto: CompleteAppointmentDto) {
    const appointment = await this.findOne(id);
    if (appointment.status !== 'CONFIRMED') {
      throw new BadRequestException(`只有已排期确认的预约可标记为已看房，当前状态为 ${appointment.status}`);
    }

    return this.prisma.viewingAppointment.update({
      where: { id },
      data: {
        status: 'COMPLETED',
        feedback: dto.feedback,
      },
    });
  }

  /** 取消预约 */
  async cancel(
    id: string,
    dto: CancelAppointmentDto,
    operatorId: string,
    role: string,
    userId?: string,
  ) {
    const appointment = await this.findOne(id);
    if (appointment.status === 'COMPLETED' || appointment.status === 'CANCELLED') {
      throw new BadRequestException(`已完成或已取消的预约不能重复取消，当前状态为 ${appointment.status}`);
    }

    // 租客只能取消自己创建的预约
    if (role === 'TENANT') {
      if (!appointment.userId || appointment.userId !== userId) {
        throw new ForbiddenException('您无权取消他人的看房预约');
      }
    }

    return this.prisma.viewingAppointment.update({
      where: { id },
      data: {
        status: 'CANCELLED',
        cancelledReason: dto.reason || '用户或管家主动取消',
      },
    });
  }
}
