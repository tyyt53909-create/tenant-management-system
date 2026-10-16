<template>
  <div class="group-card">
    <div class="group-title">{{ group.label }}</div>
    <div class="group-items">
      <div
        v-for="item in group.items"
        :key="item.code"
        class="capability-row"
      >
        <div class="row-info">
          <div class="name-status">
            <span class="cap-name">{{ item.name }}</span>
            <el-tag
              :type="isAllowed(item.code) ? 'success' : 'danger'"
              size="small"
            >
              {{ isAllowed(item.code) ? '预设允许' : '已屏蔽' }}
            </el-tag>
          </div>
          <div class="cap-desc">{{ item.description }}</div>

          <!-- 屏蔽原因输入（选填） -->
          <div v-if="!isAllowed(item.code)" class="reason-input-wrap">
            <el-input
              v-model="reasons[item.code]"
              placeholder="填写屏蔽原因（选填）"
              size="small"
              clearable
              maxlength="100"
            />
          </div>
        </div>

        <div class="row-switch">
          <el-switch
            :model-value="isAllowed(item.code)"
            active-text=""
            inactive-text=""
            inline-prompt
            @change="$emit('toggle', item.code, $event)"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { TenantCapabilityItem } from '@/api/tenants';

const props = defineProps<{
  group: {
    key: string;
    label: string;
    items: TenantCapabilityItem[];
  };
  deniedSet: Set<string>;
  reasons: Record<string, string>;
}>();

defineEmits<{
  (e: 'toggle', code: string, active: any): void;
}>();

function isAllowed(code: string): boolean {
  return !props.deniedSet.has(code);
}
</script>

<style scoped>
.group-card {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-card);
  overflow: hidden;
  margin-bottom: 14px;
}

.group-title {
  padding: 10px 14px;
  background: var(--bg-secondary);
  font-weight: 600;
  font-size: 13px;
  color: var(--text-primary);
  border-bottom: 1px solid var(--border);
}

.group-items {
  padding: 0 14px;
}

.capability-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 0;
  border-bottom: 1px dashed var(--border);
}

.capability-row:last-child {
  border-bottom: none;
}

.row-info {
  flex: 1;
  min-width: 0;
}

.name-status {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.cap-name {
  font-weight: 500;
  color: var(--text-primary);
}

.cap-desc {
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.4;
}

.reason-input-wrap {
  margin-top: 8px;
  max-width: 360px;
}

.row-switch {
  padding-top: 2px;
}
</style>
