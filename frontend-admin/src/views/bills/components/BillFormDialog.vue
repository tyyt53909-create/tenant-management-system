<template>
  <el-dialog
    :model-value="modelValue"
    :title="isEdit ? '编辑账单' : '新增账单'"
    width="500px"
    @update:model-value="$emit('update:modelValue', $event)"
    @closed="handleClosed"
  >
    <el-form ref="formRef" :model="formData" :rules="rules" label-width="100px">
      <el-form-item label="关联合同" prop="contractId">
        <EntitySelect v-model="formData.contractId" resource="contracts" />
      </el-form-item>
      <el-form-item label="账单类型" prop="billType">
        <el-select v-model="formData.billType">
          <el-option label="租金" value="RENT" />
          <el-option label="水电费" value="UTILITY" />
          <el-option label="其他" value="OTHER" />
        </el-select>
      </el-form-item>
      <el-form-item label="账期" prop="period">
        <el-input v-model="formData.period" placeholder="例如：2026-01" />
      </el-form-item>
      <el-form-item label="金额(元)" prop="amount">
        <el-input-number v-model="formData.amount" :min="0" :precision="2" />
      </el-form-item>
      <el-form-item label="到期日期" prop="dueDate">
        <el-date-picker v-model="formData.dueDate" type="date" placeholder="选择日期" value-format="YYYY-MM-DD" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="$emit('update:modelValue', false)">取消</el-button>
      <el-button type="primary" :loading="submitLoading" @click="handleSubmit">确定</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, reactive, watch, computed } from 'vue';
import { ElMessage } from 'element-plus';
import type { FormInstance } from 'element-plus';
import EntitySelect from '@/components/common/EntitySelect.vue';
import { createBill, updateBill } from '@/api/bills';
import type { Bill } from '@/types';

export interface BillFormModel {
  contractId: string;
  billType: string;
  period: string;
  amount: number;
  dueDate: string;
}

const props = defineProps<{
  modelValue: boolean;
  bill?: Bill | null;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', val: boolean): void;
  (e: 'success'): void;
}>();

const formRef = ref<FormInstance>();
const submitLoading = ref(false);

const isEdit = computed(() => !!props.bill?.id);

const formData = reactive<BillFormModel>({
  contractId: '',
  billType: 'RENT',
  period: '',
  amount: 0,
  dueDate: '',
});

const rules = {
  contractId: [{ required: true, message: '请输入合同ID', trigger: 'blur' }],
  billType: [{ required: true, message: '请选择账单类型', trigger: 'change' }],
  period: [{ required: true, message: '请输入账期', trigger: 'blur' }],
  amount: [{ required: true, message: '请输入金额', trigger: 'blur' }],
  dueDate: [{ required: true, message: '请选择到期日期', trigger: 'change' }],
};

watch(
  () => props.bill,
  (val) => {
    if (val) {
      formData.contractId = val.contractId || '';
      formData.billType = val.billType || 'RENT';
      formData.period = val.period || '';
      formData.amount = (val.amount || 0) / 100;
      formData.dueDate = val.dueDate ? val.dueDate.split('T')[0] : '';
    } else {
      resetForm();
    }
  },
  { immediate: true }
);

function resetForm() {
  formData.contractId = '';
  formData.billType = 'RENT';
  formData.period = '';
  formData.amount = 0;
  formData.dueDate = '';
  formRef.value?.clearValidate();
}

function handleClosed() {
  resetForm();
}

const handleSubmit = async () => {
  if (!formRef.value) return;
  await formRef.value.validate(async (valid) => {
    if (!valid) return;
    if (submitLoading.value) return;
    submitLoading.value = true;
    try {
      const payload: any = {
        ...formData,
        amount: Math.round(formData.amount * 100),
      };
      if (isEdit.value && props.bill?.id) {
        await updateBill(props.bill.id, payload);
        ElMessage.success('更新成功');
      } else {
        await createBill(payload);
        ElMessage.success('创建成功');
      }
      emit('update:modelValue', false);
      emit('success');
    } catch {
      ElMessage.error('操作失败');
    } finally {
      submitLoading.value = false;
    }
  });
};
</script>
