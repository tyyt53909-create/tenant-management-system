import { describe,it,expect } from 'vitest';
import { detailSections,recordLabel,protectedFilePath } from './resource';
import { csvColumns } from './resourceCsv';
describe('业务详情呈现',()=>{
  it('保留零楼层/零面积，不把 0 当作无数据',()=>{const fields=detailSections('rooms',{floor:0,area:0})[0]!.fields;expect(fields.find(f=>f.label==='楼层')?.value).toBe('0 楼');expect(fields.find(f=>f.label==='面积')?.value).toBe('0 m²');});
  it('账单分转换为元且不把已缴金额当作待缴',()=>{const s=detailSections('bills',{amount:12345,paidAmount:2345});expect(s[1]!.fields[2]!.value).toBe('¥100.00');});
  it('取消、部分缴纳和已缴清在详情及当前页导出使用相同未收口径',()=>{
    for (const [status, paidAmount, expected] of [['CANCELLED',2345,0], ['PARTIAL',2345,10000], ['PAID',12345,0]] as const) {
      const row={status,amount:12345,paidAmount};
      const fields=detailSections('bills',row)[1]!.fields;
      expect(fields.map(f=>f.value).slice(0,3)).toEqual(['¥123.45', `¥${(paidAmount/100).toFixed(2)}`, `¥${(expected/100).toFixed(2)}`]);
      const columns=csvColumns('bills');
      expect(columns.find(c=>c.label==='账单未收(元)')!.value(row)).toBe(expected/100);
      expect(row).toEqual({status,amount:12345,paidAmount});
    }
  });
  it('租客详情只展示脱敏证件号',()=>{const fields=detailSections('tenants',{name:'林女士',idNumberMasked:'4401**********1234'})[0]!.fields;expect(fields.find(f=>f.label==='证件号')?.value).toBe('4401**********1234');expect(detailSections('tenants',{})[0]!.fields.find(f=>f.label==='证件号')?.value).toBe('未登记');});
  it('租客详情列出标签名称，未打标签时明示',()=>{const fields=detailSections('tenants',{tags:[{id:'t1',name:'学生'},{id:'t2',name:'有宠物'}]})[2]!.fields;expect(fields[0]!.value).toBe('学生、有宠物');expect(detailSections('tenants',{tags:[]})[2]!.fields[0]!.value).toBe('尚未打标签');});
  it('合同选项展示名称而非裸 ID',()=>{expect(recordLabel('contracts',{id:'internal',contractNumber:'HT01',room:{roomNumber:'101'},tenant:{name:'林女士'}})).toContain('HT01 · 101 · 林女士');});
  it('照片鉴权只允许本系统文件，不把 token 发送到外站',()=>{expect(protectedFilePath('/api/files/key.png')).toBe('/files/key.png');for(const value of ['https://example.com/photo','javascript:alert(1)','/files/../secret'])expect(protectedFilePath(value)).toBeNull();});
  it('合同图片仅允许限定的附件下载路由',()=>{expect(protectedFilePath('/api/contracts/c1/attachments/a1/file')).toBe('/contracts/c1/attachments/a1/file');for(const value of ['/api/contracts/c1/attachments','/api/contracts/../attachments/a1/file','/api/contracts/c1/attachments/a1/file?token=secret','https://evil.test/api/contracts/c1/attachments/a1/file'])expect(protectedFilePath(value)).toBeNull();});
});
