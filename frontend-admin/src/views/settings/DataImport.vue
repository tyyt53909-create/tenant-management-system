<template>
  <div class="import-view">
    <p class="import-note">
      把旧系统里的资料导入本系统。顺序固定：<strong>租客 → 合同 → 账单</strong>（后一步要引用前一步的记录）。
      每一步都先预检，确认没有错误再写入；<strong>任一行有错，整份文件都不会写入</strong>。
    </p>

    <el-tabs v-model="activeEntity" class="import-tabs">
      <el-tab-pane v-for="entity in entities" :key="entity.key" :label="entity.label" :name="entity.key">
        <div class="import-panel">
          <div class="import-row">
            <el-button @click="handleTemplate(entity.key)">下载模板</el-button>
            <el-upload
              :auto-upload="false"
              :show-file-list="true"
              :limit="1"
              accept=".csv,text/csv"
              :on-change="(file: UploadFile) => handleFile(entity.key, file)"
              :on-remove="() => (files[entity.key] = undefined)"
            >
              <el-button>选择 CSV 文件</el-button>
            </el-upload>
            <el-button type="primary" :loading="busy === entity.key" @click="handlePreview(entity.key)">
              预检
            </el-button>
          </div>

          <el-alert
            v-if="results[entity.key]"
            :type="results[entity.key]!.errors.length ? 'error' : 'success'"
            :closable="false"
            show-icon
            class="import-summary"
          >
            <template #title>
              共 {{ results[entity.key]!.totalRows }} 行：可导入 {{ results[entity.key]!.imported }}，
              已存在跳过 {{ results[entity.key]!.skipped }}，
              错误 {{ results[entity.key]!.errors.length }}
            </template>
          </el-alert>

          <el-table
            v-if="results[entity.key]?.errors.length"
            :data="results[entity.key]!.errors"
            size="small"
            border
            max-height="320"
            empty-text="没有错误"
          >
            <el-table-column prop="line" label="文件行号" width="110" />
            <el-table-column prop="message" label="问题" />
          </el-table>

          <div v-if="results[entity.key] && !results[entity.key]!.errors.length" class="import-actions">
            <el-button
              type="danger"
              :loading="busy === entity.key"
              :disabled="!results[entity.key]!.imported"
              @click="handleCommit(entity.key)"
            >
              写入 {{ results[entity.key]!.imported }} 行
            </el-button>
            <span class="import-hint">写入后不可撤销，请确认文件就是最终版本。</span>
          </div>

          <el-alert
            v-if="committed[entity.key]"
            type="success"
            :closable="false"
            show-icon
            :title="`已写入 ${committed[entity.key]!.imported} 行`"
            class="import-summary"
          />
        </div>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import type { UploadFile } from 'element-plus';
import { commitImport, downloadTemplate, previewImport, type ImportEntity, type ImportResult } from '@/api/imports';
import { apiErrorMessage } from '@/utils/apiError';

const entities: { key: ImportEntity; label: string }[] = [
  { key: 'tenants', label: '① 租客' },
  { key: 'contracts', label: '② 合同' },
  { key: 'bills', label: '③ 账单' },
];

const activeEntity = ref<ImportEntity>('tenants');
const files = ref<Partial<Record<ImportEntity, File>>>({});
const results = ref<Partial<Record<ImportEntity, ImportResult>>>({});
const committed = ref<Partial<Record<ImportEntity, ImportResult>>>({});
const busy = ref<ImportEntity | ''>('');

/** el-upload 的 on-change：只接受 .csv，其余直接拒绝并提示 */
const handleFile = (entity: ImportEntity, uploadFile: UploadFile) => {
  const raw = uploadFile.raw;
  if (!raw) return;
  if (!raw.name.toLowerCase().endsWith('.csv')) {
    ElMessage.error('只支持 CSV 文件，请先下载模板另存为 CSV');
    files.value[entity] = undefined;
    return;
  }
  files.value[entity] = raw;
  results.value[entity] = undefined;
  committed.value[entity] = undefined;
};

const handleTemplate = async (entity: ImportEntity) => {
  try {
    const blob = await downloadTemplate(entity);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${entity}-template.csv`;
    link.click();
    URL.revokeObjectURL(url);
  } catch {
    ElMessage.error('模板下载失败');
  }
};

const handlePreview = async (entity: ImportEntity) => {
  const file = files.value[entity];
  if (!file) {
    ElMessage.warning('请先选择 CSV 文件');
    return;
  }
  busy.value = entity;
  committed.value[entity] = undefined;
  try {
    results.value[entity] = await previewImport(entity, file);
  } catch (error: any) {
    results.value[entity] = undefined;
    ElMessage.error(apiErrorMessage(error, '预检失败'));
  } finally {
    busy.value = '';
  }
};

const handleCommit = async (entity: ImportEntity) => {
  const file = files.value[entity];
  if (!file) return;
  try {
    await ElMessageBox.confirm('写入后不可撤销。确认这份文件已通过预检且是最新版本？', '确认写入', {
      type: 'warning',
      confirmButtonText: '确认写入',
      cancelButtonText: '再检查一下',
    });
  } catch {
    return;
  }
  busy.value = entity;
  try {
    const result = await commitImport(entity, file, { dryRun: false });
    committed.value[entity] = result;
    results.value[entity] = result;
    ElMessage.success(`已写入 ${result.imported} 行`);
  } catch (error: any) {
    ElMessage.error(apiErrorMessage(error, '写入失败，未改动任何数据'));
  } finally {
    busy.value = '';
  }
};
</script>

<style scoped>
.import-note {
  margin: 0 0 12px;
  color: var(--text-secondary, #5e6058);
  font-size: 13px;
  line-height: 1.6;
}
.import-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.import-row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.import-summary {
  margin-top: 4px;
}
.import-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}
.import-hint {
  color: var(--text-muted, #8b897f);
  font-size: 12px;
}
</style>
