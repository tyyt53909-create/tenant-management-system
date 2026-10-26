export interface CsvColumn<T = Record<string, unknown>> {
  header: string;
  key?: keyof T;
  formatter?: (row: T) => string | number | null | undefined;
}

/**
 * 单元格防注入与转义处理（CWE-1236）
 */
export function escapeCell(val: unknown): string {
  if (val === null || val === undefined) {
    return '';
  }
  let str = String(val);
  // CWE-1236: CSV Formula Injection 防御
  // 若单元格以 =, +, -, @, \t, \r 开头且非合法纯数字（例如 -100 或 +20 为合法数字），加单引号转义
  if (/^[=+\-@\t\r]/.test(str) && !/^[-+]?\d+(\.\d+)?$/.test(str)) {
    str = `'${str}`;
  }
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * 生成带 UTF-8 BOM 的 CSV 文本内容
 * Excel 打开时不乱码（UTF-8 BOM: \uFEFF）
 */
export function generateCsv<T = Record<string, unknown>>(columns: CsvColumn<T>[], rows: T[]): string {
  const headerLine = columns.map((col) => escapeCell(col.header)).join(',');
  const rowLines = rows.map((row) =>
    columns
      .map((col) => {
        const val = col.formatter ? col.formatter(row) : col.key ? row[col.key] : '';
        return escapeCell(val);
      })
      .join(','),
  );

  return '\uFEFF' + [headerLine, ...rowLines].join('\r\n');
}
