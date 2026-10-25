import { describe, it, expect, vi, beforeEach } from 'vitest';
import { downloadCsvFromServer, toCsv, csvCell } from './csv';
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

describe('CSV 单一管道（T275）', () => {
  let mockClick: ReturnType<typeof vi.fn>;

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
      body: { appendChild: vi.fn(), removeChild: vi.fn() },
      createElement: vi.fn().mockReturnValue({ href: '', download: '', click: mockClick }),
    };
  });

  it('本地生成：带 BOM、转义引号并防公式注入', () => {
    const csv = toCsv(
      [{ name: '=SUM(A1:A2)', note: '含,逗号' }],
      [
        { label: '名称', value: (row) => row.name },
        { label: '备注', value: (row) => row.note },
      ],
    );
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain(`"'=SUM(A1:A2)"`);
    expect(csvCell('a"b')).toBe('"a""b"');
  });

  it('后端导出：成功请求并触发 a 标签下载', async () => {
    vi.mocked(request.get).mockResolvedValueOnce('test,csv,data');

    await downloadCsvFromServer('/bills/export', { status: 'PAID' }, 'bills_test.csv');

    expect(request.get).toHaveBeenCalledWith('/bills/export', {
      params: { status: 'PAID' },
      responseType: 'blob',
    });
    expect((globalThis as any).window.URL.createObjectURL).toHaveBeenCalled();
    expect(mockClick).toHaveBeenCalled();
    expect((globalThis as any).window.URL.revokeObjectURL).toHaveBeenCalledWith(
      'blob:http://localhost/test-uuid',
    );
    expect(ElMessage.success).toHaveBeenCalledWith('导出成功，文件已开始下载');
  });

  it('后端导出：失败时按统一错误解析提示并抛出', async () => {
    const failure = new Error('Network Error');
    vi.mocked(request.get).mockRejectedValueOnce(failure);

    await expect(downloadCsvFromServer('/bills/export')).rejects.toThrow('Network Error');
    // T285：不再把浏览器英文原文弹给用户，统一成中文网络错误提示
    expect(ElMessage.error).toHaveBeenCalledWith('网络错误，请检查网络连接');
  });
});
