import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { QueryPublicRoomsDto } from './dto/query-public-rooms.dto.js';
import { CreatePublicLeadDto } from './dto/create-lead.dto.js';
import { CreatePublicAppointmentDto } from './dto/create-appointment.dto.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { centsToYuanString } from '../../common/utils/currency.util.js';

/**
 * 公开看房（P1 / T155 & T298 / LSE-01）
 *
 * 安全红线：本服务**只**返回以下白名单字段，
 * 且列表仅包含可出租房源（VACANT + CLEAN + isListed: true）。
 *
 * ❌ 绝不返回：租客信息（姓名/手机号/证件）、合同与金额、内部备注、
 *    cleanStatus 之外的状态细节、楼栋地址以外的房东元数据。
 *
 * 实现方式：用 Prisma select 显式白名单（而非 findUnique 后裁剪），
 * 从数据源头杜绝字段泄露；配套测试断言响应中不含租客相关键。
 */
const PUBLIC_ROOM_SELECT = {
  id: true,
  roomNumber: true,
  floor: true,
  roomType: true,
  area: true,
  facilities: true,
  description: true,
  listingPrice: true,
  isListed: true,
  availableDate: true,
  building: { select: { id: true, name: true, address: true } },
  photos: {
    select: { fileUrl: true, thumbnail: true, sortOrder: true },
    orderBy: { sortOrder: 'asc' as const },
  },
  roomShape: {
    select: {
      id: true,
      kind: true,
      x: true,
      y: true,
      width: true,
      depth: true,
      polygon: true,
      rotation: true,
      floorPlanId: true,
    },
  },
} as const;

@Injectable()
export class PublicService {
  private readonly logger = new Logger(PublicService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

  /** 可出租房源列表（VACANT + CLEAN + isListed），支持按楼栋/楼层/房型/价格筛选与分页 */
  async listRooms(query: QueryPublicRoomsDto) {
    const { page = 1, limit = 20, buildingId, floor, roomType, minPrice, maxPrice } = query;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {
      status: 'VACANT',
      cleanStatus: 'CLEAN',
      isListed: true,
    };
    if (buildingId) where.buildingId = buildingId;
    if (floor !== undefined) where.floor = floor;
    if (roomType) where.roomType = roomType;

    if (minPrice !== undefined || maxPrice !== undefined) {
      const priceFilter: Record<string, number> = {};
      if (minPrice !== undefined) priceFilter.gte = minPrice;
      if (maxPrice !== undefined) priceFilter.lte = maxPrice;
      where.listingPrice = priceFilter;
    }

    const [data, total] = await Promise.all([
      this.prisma.room.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ floor: 'asc' }, { roomNumber: 'asc' }],
        select: PUBLIC_ROOM_SELECT,
      }),
      this.prisma.room.count({ where }),
    ]);

    return {
      data: data.map((room) => this.withPublicPhotoUrls(room)),
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  /** 房源详情；仅可出租房源可见，其余一律 404（不暴露存在性） */
  async getRoom(id: string) {
    const room = await this.prisma.room.findFirst({
      where: { id, status: 'VACANT', cleanStatus: 'CLEAN', isListed: true },
      select: PUBLIC_ROOM_SELECT,
    });

    if (!room) throw new NotFoundException('房源不存在或暂不可租');
    return this.withPublicPhotoUrls(room);
  }

  /** 获取房源标准化分享卡片与海报数据（LSE-01 / T298） */
  async getRoomShareInfo(id: string) {
    const room = await this.getRoom(id);
    const coverPhoto = room.photos[0]?.thumbnail || room.photos[0]?.fileUrl || '';
    const priceText = room.listingPrice ? `¥${centsToYuanString(room.listingPrice)}/月` : '租金面议';
    const title = `${room.building.name} ${room.roomNumber}室 · ${room.roomType} (${priceText})`;

    return {
      roomId: room.id,
      title,
      description: room.description || `优质房源即刻出租，面积 ${room.area ?? '—'} ㎡，欢迎随时预约看房。`,
      priceText,
      listingPrice: room.listingPrice,
      coverImage: coverPhoto,
      path: `/pages/index/index?roomId=${room.id}`,
      buildingName: room.building.name,
      roomNumber: room.roomNumber,
      area: room.area,
      facilities: room.facilities,
      shareTime: new Date().toISOString(),
    };
  }

  /** 访客提交意向线索留资（免登录） */
  async createLead(dto: CreatePublicLeadDto) {
    // 若关联房源，校验该房源是否存在
    if (dto.roomId) {
      const room = await this.prisma.room.findUnique({
        where: { id: dto.roomId },
        select: { id: true, roomNumber: true },
      });
      if (!room) {
        throw new BadRequestException('关联意向房源不存在');
      }
    }

    const lead = await this.prisma.lead.create({
      data: {
        name: dto.name,
        phone: dto.phone,
        roomType: dto.roomType,
        budgetMin: dto.budgetMin,
        budgetMax: dto.budgetMax,
        expectedMoveIn: dto.expectedMoveIn ? new Date(dto.expectedMoveIn) : undefined,
        source: dto.source || 'MINIPROGRAM',
        notes: dto.notes,
        roomId: dto.roomId,
        status: 'NEW',
      },
    });

    // 异步通知管理员
    this.notifyAdmins({
      title: '收到新意向看房线索',
      body: `客户 ${dto.name} (${dto.phone.slice(0, 3)}****${dto.phone.slice(-4)}) 提交了找房意向，请及时跟进`,
      data: { leadId: lead.id, phone: dto.phone, source: lead.source },
    }).catch(() => {});

    return {
      id: lead.id,
      message: '意向信息已提交，专属管家将尽快与您联系',
      createdAt: lead.createdAt,
    };
  }

  /** 访客发起看房预约（免登录或携带当前账号） */
  async createAppointment(dto: CreatePublicAppointmentDto, userId?: string) {
    const room = await this.prisma.room.findFirst({
      where: { id: dto.roomId, status: 'VACANT', cleanStatus: 'CLEAN', isListed: true },
      include: { building: { select: { name: true } } },
    });

    if (!room) {
      throw new NotFoundException('预约房源不存在或暂不可预约');
    }

    const appointmentTime = new Date(dto.appointmentTime);
    if (isNaN(appointmentTime.getTime())) {
      throw new BadRequestException('预约时间格式无效');
    }

    if (appointmentTime.getTime() <= Date.now()) {
      throw new BadRequestException('预约看房时间必须为未来时间');
    }

    const appointment = await this.prisma.viewingAppointment.create({
      data: {
        roomId: dto.roomId,
        name: dto.name,
        phone: dto.phone,
        appointmentTime,
        visitorsCount: dto.visitorsCount ?? 1,
        notes: dto.notes,
        userId: userId || null,
        status: 'PENDING',
      },
    });

    // 异步通知管理员
    this.notifyAdmins({
      title: '收到新看房预约申请',
      body: `${dto.name} 预约于 ${appointmentTime.toLocaleString('zh-CN')} 查看 ${room.building.name} ${room.roomNumber}室`,
      data: { appointmentId: appointment.id, roomId: room.id },
    }).catch(() => {});

    return {
      id: appointment.id,
      status: appointment.status,
      appointmentTime: appointment.appointmentTime,
      roomNumber: room.roomNumber,
      buildingName: room.building.name,
      message: '看房预约已成功提交，管家将在确认排期后与您联系',
    };
  }

  private async notifyAdmins(content: { title: string; body: string; data: Record<string, unknown> }) {
    try {
      const admins = await this.prisma.user.findMany({
        where: { role: 'ADMIN', isActive: true },
        select: { id: true },
        take: 5,
      });

      for (const admin of admins) {
        await this.notificationsService.create({
          userId: admin.id,
          title: content.title,
          body: content.body,
          priority: 'NORMAL' as any,
          data: content.data,
        }).catch((err) => {
          this.logger.error(`通知管理员失败: ${err.message}`);
        });
      }
    } catch {
      // 容错不阻断
    }
  }

  /** 历史数据存的是 `/api/files/`，公开页统一改写到免鉴权的 `/api/public/files/`（T261）。 */
  private withPublicPhotoUrls<
    T extends { photos: Array<{ fileUrl: string; thumbnail: string | null }> },
  >(room: T): T {
    return {
      ...room,
      photos: room.photos.map((photo) => ({
        ...photo,
        fileUrl: this.toPublicUrl(photo.fileUrl),
        thumbnail: photo.thumbnail ? this.toPublicUrl(photo.thumbnail) : null,
      })),
    };
  }

  private toPublicUrl(url: string): string {
    return url.replace(/^\/api\/files\//, '/api/public/files/');
  }

  /** 可租楼栋列表（仅返回有可租房源的楼栋名称与地址） */
  async listBuildings() {
    return this.prisma.building.findMany({
      where: {
        isActive: true,
        rooms: { some: { status: 'VACANT', cleanStatus: 'CLEAN' } },
      },
      select: { id: true, name: true, address: true },
      orderBy: { name: 'asc' },
    });
  }
}
