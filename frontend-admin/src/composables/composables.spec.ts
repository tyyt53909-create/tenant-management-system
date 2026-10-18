import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useMoney } from './useMoney';
import { usePagedTable } from './usePagedTable';
import { useDialogForm } from './useDialogForm';

vi.mock('element-plus', () => ({
  ElMessage: {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

describe('composables', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('useMoney', () => {
    it('formatMoney, centsToYuan, yuanToCents 应准确计算', () => {
      const { formatMoney, centsToYuan, yuanToCents } = useMoney();

      expect(formatMoney(150000)).toBe('¥1,500.00');
      expect(centsToYuan(150000)).toBe(1500);
      expect(yuanToCents(1500)).toBe(150000);
      expect(yuanToCents(12.34)).toBe(1234);
      expect(yuanToCents('56.78')).toBe(5678);
    });
  });

  describe('usePagedTable', () => {
    it('fetchData 能正确更新 tableData 和 pagination', async () => {
      const mockApi = vi.fn().mockResolvedValue({
        data: [{ id: 1 }, { id: 2 }],
        meta: { total: 2 },
      });

      const { tableData, pagination, fetchData, handleQuery, handleReset, queryForm } = usePagedTable({
        fetchApi: mockApi,
        defaultQuery: { keyword: 'test' },
        defaultLimit: 10,
        immediate: false,
      });

      expect(pagination.limit).toBe(10);
      expect(queryForm.keyword).toBe('test');

      await fetchData();

      expect(mockApi).toHaveBeenCalledWith({
        page: 1,
        limit: 10,
        keyword: 'test',
      });
      expect(tableData.value).toHaveLength(2);
      expect(pagination.total).toBe(2);

      queryForm.keyword = 'new';
      handleQuery();
      expect(mockApi).toHaveBeenCalledWith({
        page: 1,
        limit: 10,
        keyword: 'new',
      });

      handleReset();
      expect(queryForm.keyword).toBe('test');
    });
  });

  describe('useDialogForm', () => {
    it('openCreate, openEdit, close 状态流转', async () => {
      const submitFn = vi.fn().mockResolvedValue({ success: true });
      const { visible, isEdit, formData, openCreate, openEdit, close, submit } = useDialogForm({
        defaultData: () => ({ name: '', age: 18 }),
        submitFn,
      });

      expect(visible.value).toBe(false);

      openCreate({ name: 'Alice' });
      expect(visible.value).toBe(true);
      expect(isEdit.value).toBe(false);
      expect(formData.value.name).toBe('Alice');
      expect(formData.value.age).toBe(18);

      openEdit({ name: 'Bob', age: 30 });
      expect(visible.value).toBe(true);
      expect(isEdit.value).toBe(true);
      expect(formData.value.name).toBe('Bob');

      await submit();
      expect(submitFn).toHaveBeenCalledWith({ name: 'Bob', age: 30 }, true);
      expect(visible.value).toBe(false);

      close();
      expect(visible.value).toBe(false);
    });
  });
});
