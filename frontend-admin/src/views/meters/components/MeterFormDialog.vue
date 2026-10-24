<template>
  <el-dialog
    :model-value="modelValue"
    :title="isEdit ? '编辑水电表' : '新增水电表'"
    width="500px"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <el-form ref="formRef" :model="formData" :rules="rules" label-width="120px">
      <el-form-item label="楼栋" prop="buildingId">
        <EntitySelect v-model="formData.buildingId" resource="buildings" />
      </el-form-item>
      <el-form-item label="房源" prop="roomId">
        <EntitySelect
          v-model="formData.roomId"
          resource="rooms"
          placeholder="可选，公共区域留空"
          @selected="(row) => { if (row) formData.buildingId = row.buildingId; }"
        />
      </el-form-item>
      <el-form-item label="表类型" prop="meterType">
        <el-select v-model="formData.meterType">
          <el-option label="电表" value="ELECTRICITY" />
          <el-option label="水表" value="WATER" />
          <el-option label="燃气表" value="GAS" />
        </el-select>
      </el-form-item>
      <el-form-item label="表号" prop="meterNumber">
        <el-input v-model="formData.meterNumber" placeholder="请输入表号" />
      </el-form-item>
      <el-form-item v-if="!isEdit" label="设备初始底数" prop="initialReading">
        <el-input-number v-model="formData.initialReading" :min="0" :precision="2" placeholder="绑定时表底数（不计费）" />
      </el-form-item>
      <el-form-item label="单价(元)" prop="unitPrice">
        <el-input-number v-model="formData.unitPrice" :min="0" :precision="2" />
      </el-form-item>
      <el-form-item label="价格生效日期" prop="priceEffectiveDate">
        <el-date-picker v-model="formData.priceEffectiveDate" type="date" placeholder="选择日期" value-format="YYYY-MM-DD" />
      </el-form-item>
      <el-form-item label="状态" prop="isActive">
        <el-switch v-model="formData.isActive" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="$emit('update:modelValue', false)">取消</el-button>
      <el-button type="primary" :loading="submitLoading" @click="handleSubmit">确定</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch } from 'vue';
import { ElMessage } from 'element-plus';
import type { FormInstance } from 'element-plus';
import EntitySelect from '@/components/common/EntitySelect.vue';
import { createMeter, updateMeter } from '@/api/meters';
import type { Meter } from '@/types';
import { centsToYuan } from '@/utils/money';

const props = defineProps<{
  modelValue: boolean;
  meter?: Meter | null;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', val: boolean): void;
  (e: 'success'): void;
}>();

const formRef = ref<FormInstance>();
const submitLoading = ref(false);

const isEdit = computed(() => !!props.meter?.id);

const formData = reactive({
  buildingId: '',
  roomId: '',
  meterType: 'ELECTRICITY',
  meterNumber: '',
  initialReading: undefined as number | undefined,
  unitPrice: 0,
  priceEffectiveDate: '',
  isActive: true,
});

const rules = {
  buildingId: [{ required: true, message: '请选择楼栋', trigger: 'change' }],
  meterType: [{ required: true, message: '请选择表类型', trigger: 'change' }],
  meterNumber: [{ required: true, message: '请输入表号', trigger: 'blur' }],
  unitPrice: [{ required: true, message: '请输入单价', trigger: 'blur' }],
  priceEffectiveDate: [{ required: true, message: '请选择生效日期', trigger: 'change' }],
};

function resetForm() {
  Object.assign(formData, {
    buildingId: '',
    roomId: '',
    meterType: 'ELECTRICITY',
    meterNumber: '',
    initialReading: undefined,
    unitPrice: 0,
    priceEffectiveDate: '',
    isActive: true,
  });
  formRef.value?.clearValidate();
}

watch(
  () => [props.modelValue, props.meter] as const,
  ([visible, meter]) => {
    if (!visible) return;
    if (meter) {
      Object.assign(formData, {
        buildingId: meter.buildingId,
        roomId: meter.roomId || '',
        meterType: meter.meterType,
        meterNumber: meter.meterNumber,
        initialReading: undefined,
        unitPrice: centsToYuan(meter.unitPrice),
        priceEffectiveDate: meter.priceEffectiveDate.split('T')[0],
        isActive: meter.isActive,
      });
    } else {
      resetForm();
    }
  },
  { immediate: true }
);

const handleSubmit = async () => {
  if (!formRef.value) return;
  await formRef.value.validate(async (valid) => {
    if (!valid) return;
    submitLoading.value = true;
    try {
      const data: any = {
        ...formData,
        unitPrice: Math.round(formData.unitPrice * 100),
      };
      if (isEdit.value && props.meter?.id) {
        await updateMeter(props.meter.id, data);
        ElMessage.success('更新成功');
      } else {
        await createMeter(data);
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
