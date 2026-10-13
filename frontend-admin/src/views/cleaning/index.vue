<template>
  <div class="cleaning-page">
    <!-- 保洁概览 -->
    <el-row :gutter="16" class="cleaning-stats">
      <el-col :span="8">
        <el-card shadow="never" class="stat-card stat-card--pending">
          <div class="stat-label">待清洁</div>
          <div class="stat-value">{{ stats.PENDING_CLEAN }}</div>
        </el-card>
      </el-col>
      <el-col :span="8">
        <el-card shadow="never" class="stat-card stat-card--cleaning">
          <div class="stat-label">清洁中</div>
          <div class="stat-value">{{ stats.CLEANING }}</div>
        </el-card>
      </el-col>
      <el-col :span="8">
        <el-card shadow="never" class="stat-card stat-card--clean">
          <div class="stat-label">已清洁</div>
          <div class="stat-value">{{ stats.CLEAN }}</div>
        </el-card>
      </el-col>
    </el-row>

    <el-card>
      <el-form :inline="true" :model="queryForm">
        <el-form-item label="清洁状态">
          <el-select v-model="queryForm.cleanStatus" placeholder="请选择清洁状态" clearable>
            <el-option label="待处理（待清洁 + 清洁中）" value="NEEDS_CLEANING" />
            <el-option
              v-for="item in CLEAN_STATUS_OPTIONS"
              :key="item.value"
              :label="item.label"
              :value="item.value"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="楼栋">
          <el-select v-model="queryForm.buildingId" placeholder="全部楼栋" clearable>
            <el-option
              v-for="item in buildingOptions"
              :key="item.id"
              :label="item.name"
              :value="item.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="房间号">
          <el-input v-model="queryForm.roomNumber" placeholder="请输入房间号" clearable />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="handleQuery">查询</el-button>
          <el-button @click="handleReset">重置</el-button>
          <el-button :loading="loading" @click="fetchData">刷新</el-button>
        </el-form-item>
      </el-form>

      <el-alert
        v-if="truncated"
        class="cleaning-tip"
        type="warning"
        :closable="false"
        show-icon
        :title="`房源总数超过 ${ALL_ROOMS_LIMIT} 条，仅加载前 ${ALL_ROOMS_LIMIT} 条，统计与列表可能不完整`"
      />
      <el-alert
        v-else
        class="cleaning-tip"
        type="info"
        :closable="false"
        show-icon
        title="后端 GET /rooms 暂不支持 cleanStatus 查询参数，本页已加载全部房源并在前端过滤"
      />

      <el-table
        :data="pagedRooms"
        v-loading="loading"
        border
        stripe
        empty-text="暂无符合条件的房源"
      >
        <el-table-column label="楼栋" width="150">
          <template #default="{ row }">
            {{ row.building?.name || row.buildingId }}
          </template>
        </el-table-column>
        <el-table-column prop="roomNumber" label="房间号" width="140" />
        <el-table-column prop="floor" label="楼层" width="80" />
        <el-table-column label="房态" width="100">
          <template #default="{ row }">
            <el-tag :type="roomStatusTagType(row.status)">{{ roomStatusLabel(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="清洁状态" width="120">
          <template #default="{ row }">
            <el-tag :type="cleanStatusTagType(row.cleanStatus)" effect="light">
              {{ cleanStatusLabel(row.cleanStatus) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="最后更新" width="180">
          <template #default="{ row }">
            {{ formatTime(row.updatedAt) }}
          </template>
        </el-table-column>
        <el-table-column label="操作" width="200" fixed="right">
          <template #default="{ row }">
            <el-button
              v-if="row.cleanStatus === 'PENDING_CLEAN'"
              type="primary"
              link
              :loading="actingId === row.id"
              @click="handleStartCleaning(row)"
            >
              开始清洁
            </el-button>
            <el-button
              v-else-if="row.cleanStatus === 'CLEANING'"
              type="success"
              link
              :loading="actingId === row.id"
              @click="handleFinishCleaning(row)"
            >
              完成清洁
            </el-button>
            <span v-else class="no-action">无需保洁</span>
          </template>
        </el-table-column>
      </el-table>

      <div style="margin-top: 20px; text-align: right">
        <el-pagination
          v-model:current-page="pagination.page"
          v-model:page-size="pagination.limit"
          :total="filteredRooms.length"
          :page-sizes="[10, 20, 50, 100]"
          layout="total, sizes, prev, pager, next"
          @size-change="handleSizeChange"
        />
      </div>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { ALL_ROOMS_LIMIT, fetchAllRooms, updateRoomStatus } from '@/api/rooms';
import type { CleanStatus, Room } from '@/types';
import {
  CLEAN_STATUS_OPTIONS,
  cleanStatusLabel,
  cleanStatusTagType,
  needsCleaning,
  roomStatusLabel,
  roomStatusTagType,
} from '@/utils/roomStatus';

/** 清洁状态筛选：空 = 全部；NEEDS_CLEANING = 待清洁 + 清洁中 */
type CleanFilter = '' | 'NEEDS_CLEANING' | CleanStatus;

const loading = ref(false);
const actingId = ref('');
const allRooms = ref<Room[]>([]);
const truncated = ref(false);

const queryForm = reactive<{
  cleanStatus: CleanFilter;
  buildingId: string;
  roomNumber: string;
}>({
  cleanStatus: 'NEEDS_CLEANING',
  buildingId: '',
  roomNumber: '',
});

const pagination = reactive({
  page: 1,
  limit: 20,
});

/** 清洁状态统计（后端无聚合接口，基于全量房源本地统计） */
const stats = computed<Record<CleanStatus, number>>(() => {
  const result: Record<CleanStatus, number> = { CLEAN: 0, PENDING_CLEAN: 0, CLEANING: 0 };
  for (const room of allRooms.value) {
    if (room.cleanStatus) result[room.cleanStatus] += 1;
  }
  return result;
});

/** 楼栋下拉：从已加载房源中提取（避免额外接口依赖） */
const buildingOptions = computed(() => {
  const map = new Map<string, string>();
  for (const room of allRooms.value) {
    const building = room.building;
    if (building && !map.has(building.id)) map.set(building.id, building.name);
  }
  return [...map.entries()].map(([id, name]) => ({ id, name }));
});

const filteredRooms = computed(() => {
  const keyword = queryForm.roomNumber.trim().toLowerCase();
  return allRooms.value.filter((room) => {
    if (queryForm.buildingId && room.buildingId !== queryForm.buildingId) return false;
    if (keyword && !(room.roomNumber || '').toLowerCase().includes(keyword)) return false;
    if (queryForm.cleanStatus === 'NEEDS_CLEANING') return needsCleaning(room.cleanStatus);
    if (queryForm.cleanStatus) return room.cleanStatus === queryForm.cleanStatus;
    return true;
  });
});

const pagedRooms = computed(() => {
  const start = (pagination.page - 1) * pagination.limit;
  return filteredRooms.value.slice(start, start + pagination.limit);
});

const formatTime = (value?: string) => (value ? new Date(value).toLocaleString('zh-CN') : '—');

const fetchData = async () => {
  loading.value = true;
  try {
    const result = await fetchAllRooms();
    allRooms.value = result.data;
    truncated.value = result.truncated;
  } catch (error) {
    ElMessage.error('获取保洁数据失败');
  } finally {
    loading.value = false;
  }
};

const handleQuery = () => {
  pagination.page = 1;
};

const handleReset = () => {
  queryForm.cleanStatus = 'NEEDS_CLEANING';
  queryForm.buildingId = '';
  queryForm.roomNumber = '';
  handleQuery();
};

const handleSizeChange = () => {
  pagination.page = 1;
};

/** 流转清洁状态（乐观锁：携带 version，冲突由后端返回 409） */
const changeCleanStatus = async (row: Room, cleanStatus: CleanStatus, successText: string) => {
  actingId.value = row.id;
  try {
    await updateRoomStatus(row.id, { cleanStatus, version: row.version });
    ElMessage.success(successText);
  } catch (error) {
    // 409 版本冲突 / 400 非法流转：请求拦截器已提示，下面刷新以同步最新状态
  } finally {
    actingId.value = '';
  }
  await fetchData();
};

const handleStartCleaning = async (row: Room) => {
  try {
    await ElMessageBox.confirm(`确认开始清洁「${row.roomNumber}」吗？`, '开始清洁', { type: 'info' });
  } catch (error) {
    return;
  }
  await changeCleanStatus(row, 'CLEANING', '已开始清洁');
};

const handleFinishCleaning = async (row: Room) => {
  try {
    await ElMessageBox.confirm(`确认「${row.roomNumber}」已完成清洁吗？`, '完成清洁', {
      type: 'success',
    });
  } catch (error) {
    return;
  }
  await changeCleanStatus(row, 'CLEAN', '已标记为已清洁');
};

onMounted(() => {
  fetchData();
});
</script>

<style scoped>
.cleaning-page {
  padding: 0;
}

.cleaning-stats {
  margin-bottom: 16px;
}

.stat-card {
  border-left: 4px solid #dcdfe6;
}

.stat-card--pending {
  border-left-color: #e6a23c;
}

.stat-card--cleaning {
  border-left-color: #409eff;
}

.stat-card--clean {
  border-left-color: #67c23a;
}

.stat-label {
  color: #909399;
  font-size: 14px;
}

.stat-value {
  margin-top: 8px;
  font-size: 28px;
  font-weight: 600;
  color: #303133;
}

.cleaning-tip {
  margin-bottom: 12px;
}

.no-action {
  color: #909399;
  font-size: 13px;
}
</style>
