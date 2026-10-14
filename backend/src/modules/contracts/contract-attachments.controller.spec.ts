import { Test } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext, INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdtemp, rm, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { FilesService } from '../files/files.service.js';
import { FilesController } from '../files/files.controller.js';
import { ContractAttachmentsService } from './contract-attachments.service.js';
import { ContractAttachmentsController } from './contract-attachments.controller.js';

// 真实 multipart 与临时磁盘存储；数据库桩保留上传记录，鉴权桩仅注入已验证身份。
// RolesGuard 和合同归属验证均使用实际实现，不访问或修改开发数据库。
describe('合同图片 HTTP 上传、重读与授权', () => {
  let app: INestApplication;
  let storage: string;
  let files: FilesService;
  let records: any[];
  let assets: any[];
  let prisma: any;
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
  const actors: Record<string, any> = {
    admin: { userId: 'admin-1', role: 'ADMIN' },
    tenant: { userId: 'user-1', role: 'TENANT', tenantId: 'tenant-1' },
    other: { userId: 'user-2', role: 'TENANT', tenantId: 'tenant-2' },
    cleaner: { userId: 'cleaner-1', role: 'CLEANER' },
  };

  beforeEach(async () => {
    storage = await mkdtemp(join(tmpdir(), 'qiju-contract-images-'));
    vi.stubEnv('UPLOAD_DIR', storage);
    records = []; assets = [];
    prisma = {
      contract: { findUnique: vi.fn(async ({ where }: any) => {
        if (where.id === 'c1') return { id: 'c1', tenantId: 'tenant-1' };
        if (where.id === 'c2') return { id: 'c2', tenantId: 'tenant-2' };
        return null;
      }) },
      contractAttachment: {
        create: vi.fn(async ({ data }: any) => {
          const item = { id: `a${records.length + 1}`, ...data, createdAt: new Date() };
          records.push(item); return item;
        }),
        findMany: vi.fn(async ({ where, select }: any) => records.filter(item => item.contractId === where.contractId && item.type === where.type)
          .map(item => Object.fromEntries(Object.keys(select).map(key => [key, item[key]])))),
        findFirst: vi.fn(async ({ where }: any) => records.find(item => item.id === where.id && item.contractId === where.contractId && item.type === where.type) || null),
      },
      fileAsset: {
        create: vi.fn(async ({ data }: any) => { assets.push(data); return data; }),
        findUnique: vi.fn(async ({ where }: any) => assets.find(item => item.key === where.key) || null),
      },
    };
    files = new FilesService({ get: vi.fn() } as unknown as ConfigService, prisma);
    const attachments = new ContractAttachmentsService(prisma, files);
    const module = await Test.createTestingModule({
      controllers: [ContractAttachmentsController, FilesController],
      providers: [RolesGuard, { provide: ContractAttachmentsService, useValue: attachments }, { provide: FilesService, useValue: files }],
    }).overrideGuard(JwtAuthGuard).useValue({ canActivate(context: ExecutionContext) {
      const req = context.switchToHttp().getRequest();
      const identity = req.headers.authorization?.replace('Bearer ', '');
      if (!actors[identity]) throw new UnauthorizedException();
      req.user = actors[identity]; return true;
    } }).compile();
    app = module.createNestApplication(); app.setGlobalPrefix('api'); await app.init();
  });
  afterEach(async () => {
    await app?.close();
    if (storage) await rm(storage, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  async function upload() {
    const result = await request(app.getHttpServer()).post('/api/contracts/c1/attachments')
      .set('Authorization', 'Bearer admin').attach('file', png, { filename: 'contract.png', contentType: 'image/png' }).expect(201);
    return result.body;
  }

  it('上传后重新查询仍有附件，本合同租客可取原图，通用文件接口不扩大权限', async () => {
    const saved = await upload();
    const listed = await request(app.getHttpServer()).get('/api/contracts/c1/attachments').set('Authorization', 'Bearer tenant').expect(200);
    expect(listed.body).toEqual([expect.objectContaining({ id: saved.id, fileName: 'contract.png', downloadUrl: saved.downloadUrl })]);
    expect(listed.body[0]).not.toHaveProperty('uploadedBy');
    expect(listed.body[0]).not.toHaveProperty('fileUrl');
    const image = await request(app.getHttpServer()).get(saved.downloadUrl).set('Authorization', 'Bearer tenant').expect(200);
    expect(image.body).toEqual(png);
    expect(image.headers['content-type']).toBe('image/png');
    expect(image.headers['cache-control']).toBe('private, no-store');
    expect(image.headers['x-content-type-options']).toBe('nosniff');
    await request(app.getHttpServer()).get(records[0].fileUrl).set('Authorization', 'Bearer tenant').expect(404);
  });

  it('另一租客、错合同路径与未登录均不能取附件', async () => {
    const saved = await upload();
    await request(app.getHttpServer()).get('/api/contracts/c1/attachments').set('Authorization', 'Bearer other').expect(404);
    await request(app.getHttpServer()).get(saved.downloadUrl).set('Authorization', 'Bearer other').expect(404);
    await request(app.getHttpServer()).get('/api/contracts/c2/attachments/a1/file').set('Authorization', 'Bearer other').expect(404);
    await request(app.getHttpServer()).get(saved.downloadUrl).expect(401);
    await request(app.getHttpServer()).get('/api/contracts/c1/attachments').expect(401);
  });

  it('租客与保洁不能上传，保洁也不能读取合同图片', async () => {
    for (const role of ['tenant', 'cleaner']) {
      await request(app.getHttpServer()).post('/api/contracts/c1/attachments').set('Authorization', `Bearer ${role}`)
        .attach('file', png, { filename: 'contract.png', contentType: 'image/png' }).expect(403);
    }
    await request(app.getHttpServer()).get('/api/contracts/c1/attachments').set('Authorization', 'Bearer cleaner').expect(403);
    expect(records).toHaveLength(0); expect(assets).toHaveLength(0);
  });

  it('不接受超限、空文件或伪装成图片的文件', async () => {
    await request(app.getHttpServer()).post('/api/contracts/c1/attachments').set('Authorization', 'Bearer admin').expect(400);
    await request(app.getHttpServer()).post('/api/contracts/c1/attachments').set('Authorization', 'Bearer admin')
      .attach('file', Buffer.from('<script>not a PNG</script>'), { filename: 'fake.png', contentType: 'image/png' }).expect(400);
    await request(app.getHttpServer()).post('/api/contracts/c1/attachments').set('Authorization', 'Bearer admin')
      .attach('file', Buffer.alloc(10 * 1024 * 1024 + 1), { filename: 'large.png', contentType: 'image/png' }).expect(413);
    expect(records).toHaveLength(0); expect(assets).toHaveLength(0);
  });

  it('原文件缺失返回 404，不误报服务端 500', async () => {
    const saved = await upload(); await unlink(files.filePath(assets[0].key));
    await request(app.getHttpServer()).get(saved.downloadUrl).set('Authorization', 'Bearer tenant').expect(404);
    await request(app.getHttpServer()).get(records[0].fileUrl).set('Authorization', 'Bearer admin').expect(404);
  });
  it('中文文件名正确保存，图片不能以 HTML 扩展名上传',async()=>{
    const result=await request(app.getHttpServer()).post('/api/contracts/c1/attachments').set('Authorization','Bearer admin')
      .attach('file',png,{filename:'合同签字页.png',contentType:'image/png'}).expect(201);
    expect(result.body.fileName).toBe('合同签字页.png');
    await request(app.getHttpServer()).post('/api/contracts/c1/attachments').set('Authorization','Bearer admin')
      .attach('file',png,{filename:'polyglot.html',contentType:'image/png'}).expect(400);
    expect(records).toHaveLength(1);
  });
});
