import { ElMessage } from 'element-plus';
import { AxiosError, AxiosHeaders } from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  markApiErrorNotified,
  notifyApiError,
  notifyLocalError,
  wasApiErrorNotified,
} from './notify';

vi.mock('element-plus', () => ({ ElMessage: { error: vi.fn() } }));

function axiosError(status: number, data: Record<string, unknown>) {
  const config = { headers: new AxiosHeaders() } as never;
  return new AxiosError('failed', 'ERR_BAD_REQUEST', config, undefined, {
    status,
    statusText: 'Error',
    data,
    headers: new AxiosHeaders(),
    config,
  });
}

describe('notifyApiError（COM-05）', () => {
  beforeEach(() => {
    vi.mocked(ElMessage.error).mockClear();
  });

  it('请求层已提示过的错误不再重复弹窗', () => {
    const error = axiosError(409, { code: 'COMMON_CONFLICT', message: '冲突' });
    markApiErrorNotified(error);

    expect(wasApiErrorNotified(error)).toBe(true);
    expect(notifyApiError(error, '删除失败')).toBe(false);
    expect(ElMessage.error).not.toHaveBeenCalled();
  });

  it('未提示过的错误按统一解析展示后端原因', () => {
    const error = axiosError(422, { code: 'BILL_ALREADY_PAID', message: 'bill paid' });
    expect(notifyApiError(error, '删除失败')).toBe(true);
    expect(ElMessage.error).toHaveBeenCalledWith('账单已缴清');
    // 标记后第二次不再重复
    expect(notifyApiError(error, '删除失败')).toBe(false);
    expect(ElMessage.error).toHaveBeenCalledTimes(1);
  });

  it('用户取消不提示', () => {
    const canceled = new AxiosError('canceled', 'ERR_CANCELED');
    expect(notifyApiError(canceled, '操作失败')).toBe(false);
    expect(ElMessage.error).not.toHaveBeenCalled();
  });

  it('本地错误直接提示', () => {
    notifyLocalError('只支持 CSV 文件');
    expect(ElMessage.error).toHaveBeenCalledWith('只支持 CSV 文件');
  });
});
