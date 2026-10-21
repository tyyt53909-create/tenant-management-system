import request from '@/utils/request';

/** `POST /files/upload` 的返回结构（与 FilesService.save 对齐）。 */
export interface UploadedFile {
  key: string;
  url: string;
  fileName?: string;
  fileSize: number;
  mimeType: string;
  thumbnail?: string;
}

/** 上传单张图片；业务侧只保存返回的 url / thumbnail / fileSize。 */
export const uploadFile = (file: File): Promise<UploadedFile> => {
  const body = new FormData();
  body.append('file', file);
  return request.post('/files/upload', body, {
    // 让浏览器自动补 multipart boundary；axios 在浏览器端会移除手动设置的 Content-Type。
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 60000,
    silentError: true,
  });
};
