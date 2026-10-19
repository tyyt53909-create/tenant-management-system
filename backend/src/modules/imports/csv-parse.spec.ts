import { describe, it, expect } from 'vitest';
import { parseCsv, toRecords } from './csv-parse.js';

describe('parseCsv', () => {
  it('去掉 BOM、支持 CRLF 与空行', () => {
    const parsed = parseCsv('﻿name,phone\r\n张三,13800138000\r\n\r\n李四,13900139000\r\n');
    expect(parsed.header).toEqual(['name', 'phone']);
    expect(parsed.rows.map((row) => row.values)).toEqual([
      ['张三', '13800138000'],
      ['李四', '13900139000'],
    ]);
  });

  it('处理引号、字段内逗号与换行', () => {
    const parsed = parseCsv('name,notes\n"张,三","第一行\n第二行"\n');
    expect(parsed.rows[0].values).toEqual(['张,三', '第一行\n第二行']);
  });

  it('双引号转义', () => {
    const parsed = parseCsv('name\n"他说""你好"""\n');
    expect(parsed.rows[0].values[0]).toBe('他说"你好"');
  });

  it('保留行号（用于回传错误位置）', () => {
    const parsed = parseCsv('a\n1\n2\n');
    expect(parsed.rows.map((row) => row.line)).toEqual([2, 3]);
  });

  it('空文件返回空表头', () => {
    expect(parseCsv('').header).toEqual([]);
  });
});

describe('toRecords', () => {
  it('按表头映射并 trim', () => {
    const records = toRecords(parseCsv('name,phone\n 张三 ,13800138000\n'));
    expect(records[0].record).toEqual({ name: '张三', phone: '13800138000' });
  });

  it('缺少的列补空串', () => {
    const records = toRecords(parseCsv('name,phone,email\n张三,13800138000\n'));
    expect(records[0].record.email).toBe('');
  });
});
