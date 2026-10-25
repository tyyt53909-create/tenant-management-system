export interface CsvColumn<T>{label:string;value:(row:T)=>unknown}
/** 保留引号、换行及中文；防止用户输入被 Excel 当成公式执行。 */
export function csvCell(value:unknown){
  if(value==null)return '""';
  let text=String(value);
  // oxlint-disable-next-line no-control-regex
  if(typeof value==='string' && (/^[\s\u0000-\u001f]*[=+\-@]/.test(text)||/^[\t\r]/.test(text)))text=`'${text}`;
  return `"${text.replace(/"/g,'""')}"`;
}
export function toCsv<T>(rows:T[],columns:CsvColumn<T>[]){return '\uFEFF'+[columns.map(column=>csvCell(column.label)).join(','),...rows.map(row=>columns.map(column=>csvCell(column.value(row))).join(','))].join('\r\n');}
export function downloadCsv(content:string,fileName:string){const url=URL.createObjectURL(new Blob([content],{type:'text/csv;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download=fileName;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}

/**
 * 后端导出接口下载（原独立 export 模块，T275 合并到本文件）。
 * 动态 import 请求层与提示组件，保证 `toCsv` 的纯函数单测不加载浏览器依赖。
 */
export async function downloadCsvFromServer(
  url: string,
  params: Record<string, unknown> = {},
  defaultFilename = 'export.csv',
): Promise<void> {
  const [{ default: request }, { ElMessage }] = await Promise.all([
    import('./request'),
    import('element-plus'),
  ]);
  try {
    const data = await request.get(url, { params, responseType: 'blob' });
    const blob = new Blob([data as unknown as BlobPart], { type: 'text/csv;charset=utf-8;' });
    const blobUrl = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = defaultFilename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(blobUrl);
    ElMessage.success('导出成功，文件已开始下载');
  } catch (err: unknown) {
    // 统一解析 + 标记已提示，避免调用页面再弹一次「导出失败」（COM-05 / T285）
    const [{ apiErrorMessage }, { markApiErrorNotified }] = await Promise.all([
      import('./apiError'),
      import('./notify'),
    ]);
    ElMessage.error(apiErrorMessage(err, '导出失败，请稍后重试'));
    markApiErrorNotified(err);
    throw err;
  }
}
