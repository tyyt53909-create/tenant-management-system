import { ref } from 'vue';
import type { FormInstance } from 'element-plus';
import { ElMessage } from 'element-plus';
import { apiErrorMessage } from '@/utils/apiError';

export interface UseDialogFormOptions<T> {
  defaultData?: () => T;
  submitFn?: (data: T, isEdit: boolean) => Promise<any>;
  onSuccess?: (res: any) => void;
}

export function useDialogForm<T extends Record<string, any>>(options: UseDialogFormOptions<T> = {}) {
  const visible = ref(false);
  const isEdit = ref(false);
  const submitting = ref(false);
  const formRef = ref<FormInstance>();
  const formData = ref<T>(options.defaultData ? options.defaultData() : ({} as T)) as { value: T };

  const openCreate = (initialData?: Partial<T>) => {
    isEdit.value = false;
    formData.value = options.defaultData ? options.defaultData() : ({} as T);
    if (initialData) {
      Object.assign(formData.value, initialData);
    }
    visible.value = true;
    formRef.value?.clearValidate();
  };

  const openEdit = (data: T) => {
    isEdit.value = true;
    formData.value = JSON.parse(JSON.stringify(data));
    visible.value = true;
    formRef.value?.clearValidate();
  };

  const close = () => {
    visible.value = false;
    formRef.value?.resetFields();
  };

  const submit = async (customSubmitFn?: (data: T, isEdit: boolean) => Promise<any>) => {
    const fn = customSubmitFn || options.submitFn;
    if (!fn) return;

    if (formRef.value) {
      const valid = await formRef.value.validate().catch(() => false);
      if (!valid) return;
    }

    submitting.value = true;
    try {
      const res = await fn(formData.value, isEdit.value);
      ElMessage.success(isEdit.value ? '更新成功' : '创建成功');
      visible.value = false;
      options.onSuccess?.(res);
      return res;
    } catch (error: any) {
      ElMessage.error(apiErrorMessage(error, '操作失败'));
      throw error;
    } finally {
      submitting.value = false;
    }
  };

  return {
    visible,
    isEdit,
    submitting,
    formRef,
    formData,
    openCreate,
    openEdit,
    close,
    submit,
  };
}
