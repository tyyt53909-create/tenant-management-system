import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ContractAttachmentsService } from './contract-attachments.service.js';

describe('合同扫描件归属与保存', () => {
  let service: ContractAttachmentsService;
  let prisma: any;
  let files: any;
  const admin = { userId:'admin-1', role:'ADMIN' };
  const tenant = { userId:'user-1', role:'TENANT', tenantId:'tenant-1' };
  const png = { originalname:'合同第一页.png', mimetype:'image/png', size:8, buffer:Buffer.from([137,80,78,71,13,10,26,10]) };
  beforeEach(() => {
    prisma={contract:{findUnique:vi.fn().mockResolvedValue({id:'c1',tenantId:'tenant-1'})},contractAttachment:{findMany:vi.fn().mockResolvedValue([{id:'a1',fileName:'合同.png'}]),create:vi.fn().mockResolvedValue({id:'a1',fileName:'合同.png',fileSize:8,mimeType:'image/png'}),findFirst:vi.fn().mockResolvedValue({id:'a1',contractId:'c1',type:'CONTRACT_SCAN',fileUrl:'/api/files/photo.png',mimeType:'image/png',fileName:'合同.png'})}};
    files={save:vi.fn().mockResolvedValue({url:'/api/files/photo.png',fileName:'合同.png',fileSize:8,mimeType:'image/png'}),read:vi.fn().mockResolvedValue(Buffer.from('png'))};
    service=new ContractAttachmentsService(prisma,files);
  });
  it('管理员上传的图片保存为关联当前合同的扫描件',async()=>{
    const result=await service.upload('c1',png,admin);
    expect(files.save).toHaveBeenCalledWith(png,admin);
    expect(prisma.contractAttachment.create).toHaveBeenCalledWith({data:expect.objectContaining({contractId:'c1',type:'CONTRACT_SCAN',uploadedBy:'admin-1',fileUrl:'/api/files/photo.png'})});
    expect(result.downloadUrl).toBe('/api/contracts/c1/attachments/a1/file');
  });
  it('仅本人合同租客可列出管理员上传的扫描件',async()=>{
    expect((await service.list('c1',tenant))[0].downloadUrl).toBe('/api/contracts/c1/attachments/a1/file');
    expect(prisma.contractAttachment.findMany).toHaveBeenCalledWith(expect.objectContaining({where:{contractId:'c1',type:'CONTRACT_SCAN'}}));
  });
  it('另一位租客不能探测合同附件',async()=>{
    await expect(service.list('c1',{...tenant,tenantId:'other'})).rejects.toThrow(NotFoundException);
    expect(prisma.contractAttachment.findMany).not.toHaveBeenCalled();
  });
  it('租客没有身份关联时拒绝且不查询数据库',async()=>{
    await expect(service.list('c1',{userId:'user',role:'TENANT'})).rejects.toThrow(NotFoundException);
    expect(prisma.contract.findUnique).not.toHaveBeenCalled();
  });
  it('租客不能上传合同扫描件',async()=>{
    await expect(service.upload('c1',png,tenant)).rejects.toThrow(NotFoundException);
    expect(files.save).not.toHaveBeenCalled();
  });
  it('假冒图片或 PDF 被拒绝',async()=>{
    await expect(service.upload('c1',{...png,buffer:Buffer.from('<script>bad</script>')},admin)).rejects.toThrow(BadRequestException);
    await expect(service.upload('c1',{...png,mimetype:'application/pdf'},admin)).rejects.toThrow(BadRequestException);
    expect(files.save).not.toHaveBeenCalled();
  });
  it('不存在的合同不会先上传文件',async()=>{
    prisma.contract.findUnique.mockResolvedValue(null);
    await expect(service.upload('missing',png,admin)).rejects.toThrow(NotFoundException);
    expect(files.save).not.toHaveBeenCalled();
  });
  it('图片下载要求附件属于请求的合同',async()=>{
    await expect(service.file('c1','a1',tenant)).resolves.toMatchObject({mimeType:'image/png',body:Buffer.from('png')});
    expect(files.read).toHaveBeenCalledWith('photo.png');
    expect(prisma.contractAttachment.findFirst).toHaveBeenCalledWith({where:{id:'a1',contractId:'c1',type:'CONTRACT_SCAN'}});
    prisma.contractAttachment.findFirst.mockResolvedValue(null);
    await expect(service.file('c1','another',tenant)).rejects.toThrow(NotFoundException);
  });
  it('不下载外部 URL、路径穿越或证件附件',async()=>{
    for(const patch of [{fileUrl:'https://evil.test/photo.png'},{fileUrl:'/api/files/../secret'},{mimeType:'image/svg+xml'}]){
      prisma.contractAttachment.findFirst.mockResolvedValue({fileUrl:'/api/files/a.png',mimeType:'image/png',fileName:'a',...patch});
      await expect(service.file('c1','a1',tenant)).rejects.toThrow(NotFoundException);
    }
    expect(files.read).not.toHaveBeenCalled();
  });
});
