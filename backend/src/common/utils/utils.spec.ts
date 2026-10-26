import { describe, it, expect } from 'vitest';
import { generateCsv } from './csv.util.js';
import { centsToChineseRMB, centsToYuanString } from './currency.util.js';

describe('csv.util', () => {
  it('应当生成带 UTF-8 BOM 的 CSV 文本', () => {
    const columns = [
      { header: '编号', key: 'id' as const },
      { header: '名称', key: 'name' as const },
    ];
    const rows = [
      { id: 1, name: '房间101' },
      { id: 2, name: '房间102' },
    ];
    const csv = generateCsv(columns, rows);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('编号,名称');
    expect(csv).toContain('1,房间101');
    expect(csv).toContain('2,房间102');
  });

  it('应当正确转义包含逗号、换行和双引号的单元格', () => {
    const columns = [
      { header: '说明', key: 'text' as const },
      { header: '格式化值', formatter: (r: any) => `¥${r.amount / 100}` },
    ];
    const rows = [
      { text: 'A,B', amount: 1000 },
      { text: 'He said "hello"', amount: 2000 },
      { text: 'line1\nline2', amount: 3000 },
    ];
    const csv = generateCsv(columns, rows);
    expect(csv).toContain('"A,B",¥10');
    expect(csv).toContain('"He said ""hello""",¥20');
    expect(csv).toContain('"line1\nline2",¥30');
  });

  it('应当防御 CSV 公式注入（CWE-1236）并保留合法负数/正数', () => {
    const columns = [
      { header: '内容', key: 'val' as const },
    ];
    const rows = [
      { val: '=1+1' },
      { val: '@SUM(A1:A10)' },
      { val: '+cmd|"/C calc"!A0' },
      { val: '-cmd|"/C calc"!A0' },
      { val: -100 },
      { val: '+50' },
      { val: '-12.50' },
    ];
    const csv = generateCsv(columns, rows);
    expect(csv).toContain("'=1+1");
    expect(csv).toContain("'@SUM(A1:A10)");
    expect(csv).toContain("'+cmd");
    expect(csv).toContain("'-cmd");
    expect(csv).toContain('-100');
    expect(csv).toContain('+50');
    expect(csv).toContain('-12.50');
  });
});

describe('currency.util', () => {
  it('应当将常见金额分正确转换为中文大写人民币', () => {
    expect(centsToChineseRMB(0)).toBe('零元整');
    expect(centsToChineseRMB(100)).toBe('壹元整');
    expect(centsToChineseRMB(125000)).toBe('壹仟贰佰伍拾元整');
    expect(centsToChineseRMB(10050)).toBe('壹佰元伍角整');
    expect(centsToChineseRMB(10005)).toBe('壹佰元零伍分');
    expect(centsToChineseRMB(10550)).toBe('壹佰零伍元伍角整');
    expect(centsToChineseRMB(100000000)).toBe('壹佰万元整');
    expect(centsToChineseRMB(-5000)).toBe('负伍拾元整');
  });

  it('应当正确格式化分为两位小数元', () => {
    expect(centsToYuanString(125000)).toBe('1250.00');
    expect(centsToYuanString(50)).toBe('0.50');
    expect(centsToYuanString(5)).toBe('0.05');
    expect(centsToYuanString(0)).toBe('0.00');
    expect(centsToYuanString(null)).toBe('0.00');
  });
});
