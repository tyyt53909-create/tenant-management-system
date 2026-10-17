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
