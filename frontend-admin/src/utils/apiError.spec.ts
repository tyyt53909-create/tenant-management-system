import { AxiosError, AxiosHeaders } from 'axios';
import type { InternalAxiosRequestConfig } from 'axios';
import { describe, expect, it } from 'vitest';
import {
  apiErrorMessage,
  isCanceled,
  isRefreshRotationRace,
  NETWORK_ERROR_MESSAGE,
  parseApiError,
} from './apiError';

function axiosError(status: number, data: unknown, config?: InternalAxiosRequestConfig) {
  return new AxiosError('failed', 'ERR_BAD_REQUEST', config, undefined, {
    status,
    statusText: 'Error',
    data,
    headers: new AxiosHeaders(),
    config: config as InternalAxiosRequestConfig,
  });
}

describe('parseApiError（COM-05）', () => {
  it('按错误码取稳定文案，忽略后端中文 message', () => {
    const parsed = parseApiError(
      axiosError(403, { code: 'CAPABILITY_DENIED', message: '报修已被暂停' }),
    );
    expect(parsed.code).toBe('CAPABILITY_DENIED');
    expect(parsed.message).toBe('当前账号的这项功能已暂停');
    expect(parsed.status).toBe(403);
  });

  it('未登记的错误码回退后端 message，并保留 requestId', () => {
    const parsed = parseApiError(
      axiosError(400, { code: 'SOME_NEW_CODE', message: '新业务提示', requestId: 'req-1' }),
    );
    expect(parsed.message).toBe('新业务提示');
    expect(parsed.requestId).toBe('req-1');
  });

  it('校验错误优先展示 details 字段级信息', () => {
    const parsed = parseApiError(
      axiosError(400, {
        code: 'COMMON_VALIDATION_ERROR',
        message: '请求参数验证失败',
        details: ['邮箱不能为空', '邮箱格式不正确'],
      }),
    );
    expect(parsed.message).toBe('邮箱不能为空；邮箱格式不正确');
  });

  it('message 为数组时拼接展示', () => {
    const parsed = parseApiError(axiosError(400, { code: 'X', message: ['a', 'b'] }));
    expect(parsed.message).toBe('a；b');
  });

  it('无响应视为网络错误，取消请求单独识别', () => {
    const network = parseApiError(new AxiosError('Network Error', 'ERR_NETWORK'));
    expect(network.status).toBeUndefined();
    expect(network.message).toBe(NETWORK_ERROR_MESSAGE);

    const canceled = new AxiosError('canceled', 'ERR_CANCELED');
    expect(isCanceled(canceled)).toBe(true);
    expect(parseApiError(canceled).message).toBe('请求已取消');
  });

  it('调用方 fallback 只在后端没给文案时生效', () => {
    expect(apiErrorMessage(axiosError(500, {}), '删除失败')).toBe('删除失败');
    expect(apiErrorMessage(axiosError(404, { code: 'COMMON_RESOURCE_NOT_FOUND' }), '删除失败')).toBe(
      '资源不存在或已被删除',
    );
  });
});

describe('isRefreshRotationRace（T208 -> COM-05 错误码化）', () => {
  it('按 AUTH_REFRESH_ROTATING 判断，不依赖中文文案', () => {
    expect(
      isRefreshRotationRace(axiosError(401, { code: 'AUTH_REFRESH_ROTATING', message: '改了文案也认' })),
    ).toBe(true);
  });

  it('普通 401 不误判为竞态', () => {
    expect(isRefreshRotationRace(axiosError(401, { code: 'AUTH_TOKEN_INVALID' }))).toBe(false);
    expect(isRefreshRotationRace(axiosError(401, { message: '刷新令牌正在轮换中' }))).toBe(false);
  });
});
