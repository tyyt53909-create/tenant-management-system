import { ref, reactive, onMounted } from 'vue';
import type { Ref } from 'vue';
import { ElMessage } from 'element-plus';
import { apiErrorMessage } from '@/utils/apiError';

export interface UsePagedTableOptions<T, Q extends Record<string, any> = Record<string, any>> {
  fetchApi: (params: Q & { page: number; limit: number }) => Promise<any>;
  defaultQuery?: Q;
  defaultLimit?: number;
  immediate?: boolean;
  onSuccess?: (data: T[], res: any) => void;
  onError?: (error: any) => void;
}

export function usePagedTable<T, Q extends Record<string, any> = Record<string, any>>(
  options: UsePagedTableOptions<T, Q>,
) {
  const loading = ref(false);
  const loadError = ref<string | null>(null);
  const tableData = ref([]) as Ref<T[]>;
  const pagination = reactive({
    page: 1,
    limit: options.defaultLimit ?? 20,
    total: 0,
  });

  const queryForm = reactive<Q>({ ...(options.defaultQuery || ({} as Q)) }) as Q;

  const fetchData = async () => {
    loading.value = true;
    loadError.value = null;
    try {
      const params = {
        page: pagination.page,
        limit: pagination.limit,
        ...queryForm,
      };
      const res = await options.fetchApi(params);
      tableData.value = (res?.data || res?.items || res || []) as T[];
      pagination.total = res?.meta?.total ?? res?.total ?? (Array.isArray(res) ? res.length : 0);
      options.onSuccess?.(tableData.value, res);
    } catch (error: any) {
      const msg = apiErrorMessage(error, '获取数据失败');
      loadError.value = msg;
      if (options.onError) {
        options.onError(error);
      } else {
        ElMessage.error(msg);
      }
    } finally {
      loading.value = false;
    }
  };

  const handleQuery = () => {
    pagination.page = 1;
    fetchData();
  };

  const handleReset = () => {
    if (options.defaultQuery) {
      Object.assign(queryForm, options.defaultQuery);
    } else {
      for (const key of Object.keys(queryForm)) {
        (queryForm as any)[key] = undefined;
      }
    }
    pagination.page = 1;
    fetchData();
  };

  const handlePageChange = (page: number) => {
    pagination.page = page;
    fetchData();
  };

  const handleSizeChange = (limit: number) => {
    pagination.limit = limit;
    pagination.page = 1;
    fetchData();
  };

  if (options.immediate !== false) {
    onMounted(() => {
      fetchData();
    });
  }

  return {
    loading,
    loadError,
    tableData,
    pagination,
    queryForm,
    fetchData,
    handleQuery,
    handleReset,
    handlePageChange,
    handleSizeChange,
  };
}
