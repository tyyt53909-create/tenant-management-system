import { describe, it, expect, vi, beforeEach } from 'vitest';
import { downloadCsv } from './export';
import request from './request';
import { ElMessage } from 'element-plus';

vi.mock('./request', () => ({
  default: {
    get: vi.fn(),
  },
}));

vi.mock('element-plus', () => ({
  ElMessage: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

describe('downloadCsv', () => {
  let mockClick: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockClick = vi.fn();
    (globalThis as any).window = {
      URL: {
        createObjectURL: vi.fn().mockReturnValue('blob:http://localhost/test-uuid'),
        revokeObjectURL: vi.fn(),
      },
    };
    (globalThis as any).Blob = class MockBlob {
      parts: any[];
      options: any;
      constructor(parts: any[], options?: any) {
        this.parts = parts;
        this.options = options;
      }
    };
    (globalThis as any).document = {
      body: {
        appendChild: vi.fn(),
        removeChild: vi.fn(),
      },
      createElement: vi.fn().mockReturnValue({
        href: '',
        download: '',
        click: mockClick,
      }),
    };
  });

  it('成功请求并触发 a 标签下载', async () => {
    const mockBlobData = 'test,csv,data';
    vi.mocked(request.get).mockResolvedValueOnce(mockBlobData);

    await downloadCsv('/bills/export', { status: 'PAID' }, 'bills_test.csv');

    expect(request.get).toHaveBeenCalledWith('/bills/export', {
      params: { status: 'PAID' },
      responseType: 'blob',
    });
    expect((globalThis as any).window.URL.createObjectURL).toHaveBeenCalled();
    expect(mockClick).toHaveBeenCalled();
    expect((globalThis as any).window.URL.revokeObjectURL).toHaveBeenCalledWith('blob:http://localhost/test-uuid');
    expect(ElMessage.success).toHaveBeenCalledWith('导出成功，文件已开始下载');
  });

  it('请求失败时抛出错误并提示', async () => {
    vi.mocked(request.get).mockRejectedValueOnce(new Error('Network Error'));

    await expect(downloadCsv('/bills/export')).rejects.toThrow('Network Error');
    expect(ElMessage.error).toHaveBeenCalledWith('Network Error');
  });
});
