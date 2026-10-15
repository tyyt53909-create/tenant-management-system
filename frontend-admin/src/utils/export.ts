import request from './request';
import { ElMessage } from 'element-plus';

/**
 * 统一 CSV 文件下载工具
 * @param url 导出接口路径（如 '/bills/export'）
 * @param params 查询参数过滤项
 * @param defaultFilename 默认保存文件名
 */
export async function downloadCsv(
  url: string,
  params: Record<string, any> = {},
  defaultFilename: string = 'export.csv'
): Promise<void> {
  try {
    const data: any = await request.get(url, {
      params,
      responseType: 'blob',
    });

    const blob = new Blob([data], { type: 'text/csv;charset=utf-8;' });
    const blobUrl = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = defaultFilename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(blobUrl);
    ElMessage.success('导出成功，文件已开始下载');
  } catch (err: any) {
    ElMessage.error(err?.message || '导出失败，请稍后重试');
    throw err;
  }
}
