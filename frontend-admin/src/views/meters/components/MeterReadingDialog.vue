<template>
  <el-dialog
    :model-value="modelValue"
    title="登记读数"
    width="520px"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <el-descriptions :column="2" border size="small" style="margin-bottom: 16px">
      <el-descriptions-item label="表号">{{ meter?.meterNumber }}</el-descriptions-item>
      <el-descriptions-item label="单价">
        ¥{{ ((meter?.unitPrice || 0) / 100).toFixed(2) }}/{{ unitMap[meter?.meterType || ''] || '' }}
      </el-descriptions-item>
    </el-descriptions>

    <el-alert
      v-if="readingResultText"
      :title="readingResultText"
      :type="readingResultType"
      show-icon
      :closable="false"
      style="margin-bottom: 16px"
    />

    <el-form ref="formRef" :model="form" :rules="rules" label-width="110px">
      <el-form-item label="读数模式">
        <el-radio-group v-model="form.mode">
          <el-radio label="NORMAL">日常抄表</el-radio>
          <el-radio label="INITIAL">登记初始底数（不计费）</el-radio>
        </el-radio-group>
      </el-form-item>
      <el-form-item label="当前读数" prop="currentReading">
        <el-input-number v-model="form.currentReading" :min="0" :precision="2" :step="10" />
      </el-form-item>
      <el-form-item v-if="form.mode === 'NORMAL'" label="自动结算扣费">
        <el-switch v-model="form.autoSettle" active-text="即时扣费" inactive-text="仅采集记录（周期结算）" />
      </el-form-item>
      <el-form-item label="读数时间">
        <el-date-picker
          v-model="form.readingTime"
          type="datetime"
          placeholder="缺省为当前时间"
          value-format="YYYY-MM-DDTHH:mm:ss"
        />
      </el-form-item>
      <el-form-item label="备注">
        <el-input v-model="form.notes" placeholder="选填" />
      </el-form-item>
    </el-form>

    <template #footer>
      <el-button @click="$emit('update:modelValue', false)">关闭</el-button>
      <el-button type="primary" :loading="submitLoading" @click="handleSubmit">确定</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, reactive, watch } from 'vue';
import { ElMessage } from 'element-plus';
import type { FormInstance } from 'element-plus';
import { createMeterReading } from '@/api/meters';
import type { Meter } from '@/types';

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
const readingResultText = ref('');
const readingResultType = ref<'success' | 'warning'>('success');

const unitMap: Record<string, string> = {
  ELECTRICITY: '度',
  WATER: '吨',
  GAS: '立方米',
};

const form = reactive({
  mode: 'NORMAL',
  currentReading: 0,
  autoSettle: true,
  readingTime: '',
  notes: '',
});

const rules = {
  currentReading: [{ required: true, message: '请输入当前读数', trigger: 'blur' }],
};

watch(
  () => [props.modelValue, props.meter] as const,
  ([visible]) => {
    if (visible) {
      form.mode = 'NORMAL';
      form.currentReading = 0;
      form.autoSettle = true;
      form.readingTime = '';
      form.notes = '';
      readingResultText.value = '';
    }
  },
  { immediate: true }
);

const handleSubmit = async () => {
  const meter = props.meter;
  if (!formRef.value || !meter) return;

  await formRef.value.validate(async (valid) => {
    if (!valid) return;
    submitLoading.value = true;
    try {
      const isInitial = form.mode === 'INITIAL';
      const result = await createMeterReading(meter.id, {
        currentReading: form.currentReading,
        isInitial,
        autoSettle: isInitial ? false : form.autoSettle,
        readingTime: form.readingTime || undefined,
        notes: form.notes || undefined,
      });

      const usage = Number(result.reading.usage).toFixed(2);
      const deduction = result.deduction;
      if (!deduction.applied) {
        readingResultText.value = `登记成功（用量 ${usage}）；扣费提示：${deduction.reason}`;
        readingResultType.value = 'warning';
      } else if (deduction.shortfall > 0) {
        readingResultText.value = `用量 ${usage}；已扣费 ¥${(deduction.deducted / 100).toFixed(2)}；余额不足，已生成补缴账单 ¥${(deduction.shortfall / 100).toFixed(2)}`;
        readingResultType.value = 'warning';
      } else {
        readingResultText.value = `用量 ${usage}；已从预付账户扣费 ¥${(deduction.deducted / 100).toFixed(2)}`;
        readingResultType.value = 'success';
      }
      ElMessage.success('读数登记成功');
      emit('success');
    } catch {
      // Handled by request interceptor
    } finally {
      submitLoading.value = false;
    }
  });
};
</script>
