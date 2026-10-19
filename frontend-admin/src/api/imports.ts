import request from '@/utils/request';

export type ImportEntity = 'tenants' | 'contracts' | 'bills';

export interface ImportRowError {
  line: number;
  message: string;
}

export interface ImportResult {
  entity: ImportEntity;
  totalRows: number;
  skipped: number;
  imported: number;
  errors: ImportRowError[];
  dryRun: boolean;
}

/** 下载模板 CSV（UTF-8 BOM，Excel 直接打开不乱码） */
export async function downloadTemplate(entity: ImportEntity): Promise<Blob> {
  const response = await request.get(`/imports/${entity}/template`, { responseType: 'blob' });
  return response.data as Blob;
}

/** 预检：返回逐行错误与跳过数，不写库 */
export function previewImport(entity: ImportEntity, file: File, buildingId?: string): Promise<ImportResult> {
  const form = new FormData();
  form.append('file', file);
  return request.post(`/imports/${entity}/preview`, form, {
    params: buildingId ? { buildingId } : undefined,
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 60000,
  });
}

/** 写入：dryRun 默认 true，只有显式传 false 才真正落库 */
export function commitImport(
  entity: ImportEntity,
  file: File,
  options: { buildingId?: string; dryRun?: boolean } = {},
): Promise<ImportResult> {
  const form = new FormData();
  form.append('file', file);
  return request.post(`/imports/${entity}/commit`, form, {
    params: { ...options },
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 60000,
  });
}
