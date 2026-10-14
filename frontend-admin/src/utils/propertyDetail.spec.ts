import { describe,expect,it } from 'vitest';
import { contractReminder,currentLeaseQuery,detailTabs,displayMoney,propertyPhotos,roomFacts,stateTone } from './propertyDetail';

describe('原型详情的数据呈现边界',()=>{
  it('房源与合同有对应的实际分组，合同扫描件可单独进入',()=>{
    expect(detailTabs('rooms').map(tab=>tab.id)).toEqual(['overview','leases','bills','audit']);
    expect(detailTabs('contracts').map(tab=>tab.id)).toEqual(['overview','tenant','room','bills','files']);
  });
  it('保留 0 层、0 面积和零元租金，不把缺失金额冒充 0 元',()=>{
    const fields=roomFacts({floor:0,area:0},{rentAmount:0});
    expect(fields.find(field=>field.label==='楼层')?.value).toBe('0 楼');
    expect(fields.find(field=>field.label==='建筑面积')?.value).toBe('0 m²');
    expect(fields.find(field=>field.label==='租约月租')?.value).toBe('¥0.00');
    expect(displayMoney(undefined)).toBe('—');
    expect(displayMoney(123456)).toBe('¥1,234.56');
  });
  it('预订房源查草稿合同，其他房态只查询生效合同而不是过期租约',()=>{
    expect(currentLeaseQuery({id:'r1',status:'RESERVED'})).toEqual({roomId:'r1',status:'DRAFT',limit:1});
    expect(currentLeaseQuery({id:'r1',status:'VACANT'}).status).toBe('ACTIVE');
  });
  it('封面仅来自房源照片，与合同扫描件区分，外站不带鉴权加载',()=>{
    const room={photos:[{fileUrl:'/api/files/room.png'},{fileUrl:'https://evil.test/room.png'}]};
    expect(propertyPhotos('rooms',room)).toHaveLength(1);
    expect(propertyPhotos('contracts',{room,attachments:[{fileUrl:'/api/files/scan.png'}]})).toEqual([{fileUrl:'/api/files/room.png'}]);
    expect(propertyPhotos('rooms',null)).toEqual([]);
  });
  it('生效日期提示不虚构已缴费或已经生成下一张账单',()=>{
    const reminder=contractReminder({status:'ACTIVE',endDate:'2027-10-14'},new Date(2026,9,14));
    expect(reminder.title).toBe('合同生效中');expect(reminder.text).toContain('365 天');
    expect(reminder.text).toContain('缴费情况请查看账单记录');
  });
  it('在自然日边界正确显示今日、即将与已经到期',()=>{
    const now=new Date(2026,9,14,23,59);
    expect(contractReminder({status:'ACTIVE',endDate:'2026-10-14'},now).title).toBe('合同今日到期');
    expect(contractReminder({status:'ACTIVE',endDate:'2026-10-15'},now).text).toContain('1 天');
    expect(contractReminder({status:'ACTIVE',endDate:'2026-10-13'},now).title).toBe('合同已到期');
  });
  it('草稿、终止与续签不显示正常履约或假倒计时',()=>{
    expect(contractReminder({status:'DRAFT',endDate:'2027-10-14'}).title).toBe('合同尚未生效');
    expect(contractReminder({status:'TERMINATED'}).title).toBe('合同已终止');
    expect(contractReminder({status:'RENEWED'}).title).toBe('原合同已续签');
    expect(contractReminder({status:'ACTIVE',endDate:'bad'}).title).toBe('到期日未记录');
  });
  it('房态、清洁与合同状态用独立的低饱和颜色层级',()=>{
    expect(stateTone('CLEAN')).toBe('success');expect(stateTone('RESERVED')).toBe('info');
    expect(stateTone('PENDING_CLEAN')).toBe('warning');expect(stateTone('EXPIRED')).toBe('danger');
  });
});
