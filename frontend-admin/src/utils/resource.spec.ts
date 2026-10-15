import { describe,it,expect } from 'vitest';
import { detailSections,recordLabel,protectedFilePath } from './resource';
describe('业务详情呈现',()=>{
  it('保留零楼层/零面积，不把 0 当作无数据',()=>{const fields=detailSections('rooms',{floor:0,area:0})[0]!.fields;expect(fields.find(f=>f.label==='楼层')?.value).toBe('0 楼');expect(fields.find(f=>f.label==='面积')?.value).toBe('0 m²');});
  it('账单分转换为元且不把已缴金额当作待缴',()=>{const s=detailSections('bills',{amount:12345,paidAmount:2345});expect(s[1]!.fields[2]!.value).toBe('¥100.00');});
  it('合同选项展示名称而非裸 ID',()=>{expect(recordLabel('contracts',{id:'internal',contractNumber:'HT01',room:{roomNumber:'101'},tenant:{name:'林女士'}})).toContain('HT01 · 101 · 林女士');});
  it('照片鉴权只允许本系统文件，不把 token 发送到外站',()=>{expect(protectedFilePath('/api/files/key.png')).toBe('/files/key.png');for(const value of ['https://example.com/photo','javascript:alert(1)','/files/../secret'])expect(protectedFilePath(value)).toBeNull();});
  it('合同图片仅允许限定的附件下载路由',()=>{expect(protectedFilePath('/api/contracts/c1/attachments/a1/file')).toBe('/contracts/c1/attachments/a1/file');for(const value of ['/api/contracts/c1/attachments','/api/contracts/../attachments/a1/file','/api/contracts/c1/attachments/a1/file?token=secret','https://evil.test/api/contracts/c1/attachments/a1/file'])expect(protectedFilePath(value)).toBeNull();});
});
