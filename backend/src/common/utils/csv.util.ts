export interface CsvColumn<T = Record<string, unknown>> {
  header: string;
  key?: keyof T;
  formatter?: (row: T) => string | number | null | undefined;
}

/**
 * 生成带 UTF-8 BOM 的 CSV 文本内容
 * Excel 打开时不乱码（UTF-8 BOM: \uFEFF）
 */
export function generateCsv<T = Record<string, unknown>>(columns: CsvColumn<T>[], rows: T[]): string {
  const escapeCell = (val: unknown): string => {
    if (val === null || val === undefined) {
      return '';
    }
    const str = neutralizeSpreadsheetFormula(String(val));
    if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

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

/** Excel 会把以 = + - @ 开头的单元格当公式。纯数字（含负数）保持原样。 */
export function neutralizeSpreadsheetFormula(value: string): string {
  if (/^-?\d+(\.\d+)?$/.test(value)) return value;
  // oxlint-disable-next-line no-control-regex
  if (/^[\s\u0000-\u001f]*[=+\-@]/.test(value) || /^[\t\r]/.test(value)) {
    return `'${value}`;
  }
  return value;
}
