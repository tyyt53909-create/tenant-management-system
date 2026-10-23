<template>
  <div class="room-photo-editor" role="group" aria-label="房源照片">
    <div v-if="photos.length" class="photo-grid">
      <figure v-for="(photo, index) in photos" :key="`${photo.fileUrl}-${index}`" class="photo-tile">
        <ProtectedImage :url="photo.thumbnail || photo.fileUrl" :label="`查看房源照片 ${index + 1}`" />
        <span v-if="index === 0" class="photo-cover">封面</span>
        <div class="photo-actions">
          <button
            type="button"
            :disabled="index === 0"
            :aria-label="`把照片 ${index + 1} 前移`"
            @click="move(index, index - 1)"
          >
            <el-icon><ArrowLeft /></el-icon>
          </button>
          <button
            type="button"
            :disabled="index === photos.length - 1"
            :aria-label="`把照片 ${index + 1} 后移`"
            @click="move(index, index + 1)"
          >
            <el-icon><ArrowRight /></el-icon>
          </button>
          <button type="button" class="photo-remove" :aria-label="`删除照片 ${index + 1}`" @click="remove(index)">
            <el-icon><Delete /></el-icon>
          </button>
        </div>
      </figure>
    </div>

    <el-upload
      v-if="photos.length < max"
      class="photo-upload"
      :show-file-list="false"
      :accept="ROOM_PHOTO_ACCEPT"
      :multiple="true"
      :disabled="uploading"
      :before-upload="beforeUpload"
      :http-request="handleUpload"
    >
      <div class="upload-tile">
        <el-icon v-if="!uploading"><Plus /></el-icon>
        <el-icon v-else class="is-loading"><Loading /></el-icon>
        <span>{{ uploading ? '上传中…' : '上传照片' }}</span>
      </div>
    </el-upload>

    <p class="photo-hint">最多 {{ max }} 张，第一张为封面；JPG / PNG / WebP，单张不超过 10MB。</p>
    <p v-if="errorText" class="photo-error" role="alert">{{ errorText }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { ElMessage } from 'element-plus';
import type { UploadRawFile, UploadRequestOptions } from 'element-plus';
import { ArrowLeft, ArrowRight, Delete, Loading, Plus } from '@element-plus/icons-vue';
import ProtectedImage from '@/components/common/ProtectedImage.vue';
import { uploadFile } from '@/api/files';
import type { RoomPhoto } from '@/types';
import {
  MAX_ROOM_PHOTOS,
  ROOM_PHOTO_ACCEPT,
  moveRoomPhoto,
  removeRoomPhotoAt,
  validateRoomPhotoFile,
} from '@/utils/roomPhotos';

const props = withDefaults(
  defineProps<{
    modelValue: RoomPhoto[];
    max?: number;
  }>(),
  { max: MAX_ROOM_PHOTOS },
);

const emit = defineEmits<{
  (e: 'update:modelValue', photos: RoomPhoto[]): void;
}>();

const uploadingCount = ref(0);
const uploading = computed(() => uploadingCount.value > 0);
const photos = computed(() => props.modelValue ?? []);
const errorText = ref('');

function move(from: number, to: number) {
  emit('update:modelValue', moveRoomPhoto(photos.value, from, to));
}

function remove(index: number) {
  emit('update:modelValue', removeRoomPhotoAt(photos.value, index));
}

function beforeUpload(file: UploadRawFile) {
  const message = validateRoomPhotoFile(file);
  if (message) {
    ElMessage.warning(message);
    return false;
  }
  if (photos.value.length + uploadingCount.value >= props.max) {
    ElMessage.warning(`房源照片最多 ${props.max} 张`);
    return false;
  }
  return true;
}

function uploadErrorMessage(error: unknown) {
  const data = (error as { response?: { data?: { message?: string | string[] } } })?.response?.data;
  const message = Array.isArray(data?.message) ? data.message.join('；') : data?.message;
  if (typeof message === 'string' && message) return message;
  return '照片上传失败，请重试';
}

async function handleUpload(options: UploadRequestOptions) {
  uploadingCount.value += 1;
  errorText.value = '';
  try {
    const uploaded = await uploadFile(options.file);
    if (!uploaded?.url) throw new Error('上传结果缺少照片地址');
    if (photos.value.length >= props.max) throw new Error(`房源照片最多 ${props.max} 张`);

    emit('update:modelValue', [
      ...photos.value,
      {
        fileUrl: uploaded.url,
        thumbnail: uploaded.thumbnail ?? null,
        fileSize: uploaded.fileSize,
      },
    ]);
    options.onSuccess(uploaded);
  } catch (error) {
    options.onError(error as Parameters<UploadRequestOptions['onError']>[0]);
    errorText.value = uploadErrorMessage(error);
    ElMessage.error(errorText.value);
  } finally {
    uploadingCount.value -= 1;
  }
}
</script>

<style scoped>
.room-photo-editor {
  width: 100%;
  min-width: 0;
}
.photo-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}
.photo-tile {
  position: relative;
  margin: 0;
  border: 1px solid var(--border);
  border-radius: 10px;
  overflow: hidden;
  background: #f1eee8;
}
.photo-tile :deep(.protected-image) {
  aspect-ratio: 4 / 3;
  border-radius: 0;
}
.photo-cover {
  position: absolute;
  top: 7px;
  left: 7px;
  padding: 2px 7px;
  border-radius: 5px;
  background: rgba(83, 91, 67, 0.9);
  color: #fffefa;
  font-size: var(--font-micro);
  line-height: 1.6;
}
.photo-actions {
  position: absolute;
  right: 5px;
  bottom: 5px;
  z-index: 2;
  display: flex;
  gap: 4px;
}
.photo-actions button {
  display: grid;
  place-items: center;
  width: 25px;
  height: 25px;
  padding: 0;
  border: 1px solid rgba(255, 255, 255, 0.55);
  border-radius: 6px;
  background: rgba(48, 47, 42, 0.65);
  color: #fffefa;
  cursor: pointer;
}
.photo-actions button:hover:not(:disabled) {
  background: rgba(48, 47, 42, 0.85);
}
.photo-actions button:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
.photo-actions .photo-remove:hover {
  background: #955245;
}
.photo-upload {
  display: block;
  width: 100%;
  margin-top: 10px;
}
.photo-upload :deep(.el-upload) {
  display: block;
  width: 100%;
}
.upload-tile {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  min-height: 58px;
  border: 1px dashed #d5d0c3;
  border-radius: 9px;
  background: #fffefa;
  color: var(--text-muted);
  font-size: 12px;
  transition: border-color 0.16s, color 0.16s, background 0.16s;
}
.upload-tile:hover {
  border-color: #b9c9aa;
  background: #f3f6ee;
  color: #445738;
}
.photo-hint {
  margin: 8px 0 0;
  color: var(--text-muted);
  font-size: var(--font-micro);
  line-height: 1.7;
}
.photo-error {
  margin: 6px 0 0;
  color: var(--error-text);
  font-size: 11px;
  line-height: 1.6;
}
</style>
