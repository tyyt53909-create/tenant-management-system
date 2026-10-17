<template>
  <el-dialog
    :model-value="modelValue"
    title="房态流转与清洁状态"
    width="480px"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <el-descriptions :column="2" border size="small" style="margin-bottom: 16px">
      <el-descriptions-item label="房源">{{ room?.roomNumber }}</el-descriptions-item>
      <el-descriptions-item label="版本号">v{{ room?.version }}</el-descriptions-item>
      <el-descriptions-item label="当前房态">{{ roomStatusLabel(room?.status) }}</el-descriptions-item>
      <el-descriptions-item label="当前清洁">{{ cleanStatusLabel(room?.cleanStatus) }}</el-descriptions-item>
    </el-descriptions>
    <el-form label-width="110px">
      <el-form-item label="目标房态">
        <el-select v-model="form.status">
          <el-option label="空置" value="VACANT" />
          <el-option label="已预订" value="RESERVED" />
          <el-option label="已租" value="OCCUPIED" />
          <el-option label="维护中" value="MAINTENANCE" />
        </el-select>
      </el-form-item>
      <el-form-item label="目标清洁状态">
        <el-select v-model="form.cleanStatus">
          <el-option label="已清洁" value="CLEAN" />
          <el-option label="待清洁" value="PENDING_CLEAN" />
          <el-option label="清洁中" value="CLEANING" />
        </el-select>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="$emit('update:modelValue', false)">取消</el-button>
      <el-button type="primary" :loading="submitting" @click="handleSubmit">确定</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, reactive, watch } from 'vue';
import { ElMessage } from 'element-plus';
import type { Room, RoomStatus, CleanStatus } from '@/types';
import { roomStatusLabel, cleanStatusLabel } from '@/utils/roomStatus';
import { updateRoomStatus } from '@/api/rooms';

const props = defineProps<{
  modelValue: boolean;
  room: Room | null;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', val: boolean): void;
  (e: 'success'): void;
}>();

const submitting = ref(false);
const form = reactive<{ status: '' | RoomStatus; cleanStatus: '' | CleanStatus }>({
  status: '',
  cleanStatus: '',
});

watch(
  () => props.room,
  (newRoom) => {
    if (newRoom) {
      form.status = newRoom.status;
      form.cleanStatus = newRoom.cleanStatus;
    }
  },
  { immediate: true },
);

const handleSubmit = async () => {
  if (!props.room) return;
  submitting.value = true;
  try {
    await updateRoomStatus(props.room.id, {
      status: form.status || undefined,
      cleanStatus: form.cleanStatus || undefined,
      version: props.room.version,
    });
    ElMessage.success('状态流转成功');
    emit('update:modelValue', false);
    emit('success');
  } catch (err: any) {
    if (err?.response?.status === 409) {
      ElMessage.error('房态已被其他人更新，请刷新重试');
    } else {
      ElMessage.error(err?.response?.data?.message || '状态更新失败');
    }
  } finally {
    submitting.value = false;
  }
};
</script>
