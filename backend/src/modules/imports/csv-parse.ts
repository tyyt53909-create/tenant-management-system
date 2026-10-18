/**
 * 极简 CSV 解析（T216）。
 *
 * 不引入第三方依赖：导入文件由本系统导出模板产生，字段固定，
 * 只需要正确处理 BOM、CRLF、引号转义与字段内换行。
 */
export interface ParsedCsv {
  header: string[];
  /** 从第 2 行开始，line 是文件里的物理行号（1 基，含表头偏移） */
  rows: { line: number; values: string[] }[];
}

export function parseCsv(input: string): ParsedCsv {
  const text = input.replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const rows: { line: number; values: string[] }[] = [];
  let fields: string[] = [];
  let field = '';
  let inQuotes = false;
  let line = 1;
  let rowLine = 1;

  const pushField = () => {
    fields.push(field);
    field = '';
  };
  const pushRow = () => {
    pushField();
    rows.push({ line: rowLine, values: fields });
    fields = [];
  };

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        if (char === '\n') line++;
        field += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      pushField();
    } else if (char === '\n') {
      pushRow();
      line++;
      rowLine = line;
    } else {
      field += char;
    }
  }
  if (field.length > 0 || fields.length > 0) pushRow();

  const [headerRow, ...rest] = rows;
  return {
    header: headerRow ? headerRow.values.map((value) => value.trim()) : [],
    // 跳过完全空行
    rows: rest.filter((row) => row.values.some((value) => value.trim() !== '')),
  };
}

/** 转为 { 列名: 值 }，未识别的列忽略 */
export function toRecords(parsed: ParsedCsv): { line: number; record: Record<string, string> }[] {
  return parsed.rows.map(({ line, values }) => {
    const record: Record<string, string> = {};
    parsed.header.forEach((name, index) => {
      record[name] = (values[index] ?? '').trim();
    });
    return { line, record };
  });
}
