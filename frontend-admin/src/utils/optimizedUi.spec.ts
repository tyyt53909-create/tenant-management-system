import { describe,it,expect } from 'vitest';
import { csvCell,toCsv } from './csv';
import { csvColumns } from './resourceCsv';
import { metricValue,MANAGEMENT_METRICS } from './managementMetrics';
import { parsePreferences } from './preferences';

describe('V3 真数据与导出边界',()=>{
  it('缺少统计不显示为零，金额从分转换为元',()=>{
    const metric=MANAGEMENT_METRICS.bills.find(m=>m.key==='remaining')!;
    expect(metricValue(metric)).toBe('—');expect(metricValue(metric,{remaining:12345})).toBe('¥123.45');expect(metricValue(metric,{remaining:0})).toBe('¥0.00');
  });
  it('所有页面摘要有各自口径，不复制示例值或虚构预约任务',()=>{
    expect(Object.keys(MANAGEMENT_METRICS)).toHaveLength(10);
    expect(MANAGEMENT_METRICS.cleaning.some(metric=>/预约|排期/.test(metric.label))).toBe(false);
    expect(MANAGEMENT_METRICS.bills.some(metric=>metric.note.includes('不含另计滞纳金'))).toBe(true);
  });
  it('CSV 使用 UTF-8 BOM，保留引号与换行',()=>{
    const csv=toCsv([{name:'张"三\n备注'}],[{label:'姓名',value:r=>r.name}]);
    expect(csv).toBe('\uFEFF"姓名"\r\n"张""三\n备注"');
  });
  it('防止用户文本被表格应用当成公式，同时保留真正的负数',()=>{
    for(const value of ['=1+1','+SUM(A1)','-1+2','@cmd','  =HYPERLINK("bad")','\t=1'])expect(csvCell(value)).toMatch(/^"'/);
    expect(csvCell(-125)).toBe('"-125"');
  });
  it('导出明确字段，不包含租客证件号或内部密码；账单金额单位正确',()=>{
    const tenant=toCsv([{name:'林女士',phone:'13800000000',idNumber:'PRIVATE-ID',passwordHash:'PRIVATE-HASH'}],csvColumns('tenants'));
    expect(tenant).not.toContain('PRIVATE');
    const bills=toCsv([{billNumber:'B1',amount:12345,paidAmount:2345,status:'PARTIAL'}],csvColumns('bills'));
    expect(bills).toContain('"123.45"');expect(bills).toContain('"100"');
  });
  it('非法偏好安全回到默认值，字符串 true 不冒充布尔值',()=>{
    expect(parsePreferences('{bad')).toEqual({compact:false,reduceMotion:false});
    expect(parsePreferences('{"compact":"true","reduceMotion":true,"resetDatabase":true}')).toEqual({compact:false,reduceMotion:true});
  });
});
