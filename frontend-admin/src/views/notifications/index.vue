<template>
  <div class="notifications-page">
    <el-card>
      <div class="toolbar">
        <div class="toolbar-left">
          <span class="toolbar-label">未读</span>
          <el-badge
            :value="unreadCount"
            :max="99"
            :hidden="unreadCount === 0"
            type="danger"
            data-test="unread-badge"
          >
            <el-icon class="toolbar-bell"><Bell /></el-icon>
          </el-badge>
          <el-switch
            v-model="unreadOnly"
            active-text="只看未读"
            class="unread-switch"
            data-test="unread-only-switch"
            @change="handleFilterChange"
          />
        </div>
        <div class="toolbar-right">
          <el-button :loading="loading" @click="fetchData">刷新</el-button>
          <el-button
            type="primary"
            :disabled="unreadCount === 0 || loading"
            data-test="mark-all-read"
            @click="handleMarkAllRead"
          >
            全部标记已读
          </el-button>
        </div>
      </div>

      <el-table
        :data="displayData"
        v-loading="loading"
        border
        stripe
        :row-class-name="rowClassName"
        :empty-text="unreadOnly ? '暂无未读通知' : '暂无通知'"
        data-test="notification-table"
      >
        <el-table-column label="状态" width="90" align="center">
          <template #default="{ row }">
            <el-tag v-if="!row.isRead" type="danger" effect="dark" size="small">未读</el-tag>
            <el-tag v-else type="info" size="small">已读</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="优先级" width="90" align="center">
          <template #default="{ row }">
            <el-tag :type="row.priority === 'URGENT' ? 'danger' : 'info'" size="small">
              {{ priorityMap[row.priority] || row.priority }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="title" label="标题" min-width="180" show-overflow-tooltip />
        <el-table-column prop="body" label="正文" min-width="300" show-overflow-tooltip />
        <el-table-column label="时间" width="180">
          <template #default="{ row }">{{ formatTime(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="220" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="handleDetail(row)">查看</el-button>
            <el-button link type="primary" :disabled="row.isRead" @click="handleMarkRead(row)">
              标记已读
            </el-button>
            <el-button link type="danger" @click="handleDelete(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>

      <div class="pagination">
        <el-pagination
          v-model:current-page="pagination.page"
          v-model:page-size="pagination.limit"
          :total="pagination.total"
          :page-sizes="[10, 20, 50]"
          layout="total, sizes, prev, pager, next"
          @current-change="fetchData"
          @size-change="handleSizeChange"
        />
      </div>
    </el-card>

    <el-dialog v-model="detailVisible" title="通知详情" width="560px">
      <div v-if="current" class="detail">
        <div class="detail-row">
          <span class="detail-label">标题</span>
          <span class="detail-value">{{ current.title }}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">优先级</span>
          <el-tag :type="current.priority === 'URGENT' ? 'danger' : 'info'" size="small">
            {{ priorityMap[current.priority] || current.priority }}
          </el-tag>
        </div>
        <div class="detail-row">
          <span class="detail-label">时间</span>
          <span class="detail-value">{{ formatTime(current.createdAt) }}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">状态</span>
          <span class="detail-value">{{ current.isRead ? '已读' : '未读' }}</span>
        </div>
        <div class="detail-body">{{ current.body }}</div>
      </div>
      <template #footer>
        <el-button @click="detailVisible = false">关闭</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Bell } from '@element-plus/icons-vue';
import {
  deleteNotification,
  getNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '@/api/notifications';
import { useNotificationStore } from '@/stores/notification';
import type { Notification } from '@/types';

const notificationStore = useNotificationStore();

const loading = ref(false);
const unreadOnly = ref(false);
const tableData = ref<Notification[]>([]);
const detailVisible = ref(false);
const current = ref<Notification | null>(null);

const pagination = reactive({ page: 1, limit: 20, total: 0 });
const unreadCount = computed(() => notificationStore.unreadCount);

const priorityMap: Record<string, string> = {
  NORMAL: '普通',
  URGENT: '紧急',
};

/** 未读优先展示：同页内未读置顶；sort 稳定，组内保持后端的时间倒序 */
const displayData = computed(() =>
  [...tableData.value].sort((a, b) => Number(a.isRead) - Number(b.isRead))
);

const formatTime = (value?: string | null) =>
  value ? new Date(value).toLocaleString('zh-CN') : '-';

const rowClassName = ({ row }: { row: Notification }) => (row.isRead ? '' : 'row-unread');

const fetchData = async () => {
  loading.value = true;
  try {
    const response = await getNotifications({
      page: pagination.page,
      limit: pagination.limit,
      // 后端 unreadOnly 为 @Type(() => Boolean)：取消筛选时必须省略参数（传 false 会被当成 true）
      unreadOnly: unreadOnly.value ? true : undefined,
    });
    tableData.value = response.data ?? [];
    pagination.total = response.meta?.total ?? 0;
    notificationStore.setUnreadCount(response.meta?.unreadCount ?? 0);
  } catch {
    // HTTP 错误提示由 request 拦截器统一弹出，这里只保证 loading 归位
  } finally {
    loading.value = false;
  }
};

const handleFilterChange = () => {
  pagination.page = 1;
  fetchData();
};

const handleSizeChange = () => {
  pagination.page = 1;
  fetchData();
};

/** 单条标记已读；成功后就地刷新列表与未读数 */
const handleMarkRead = async (row: Notification) => {
  try {
    await markNotificationRead(row.id);
    ElMessage.success('已标记为已读');
    await fetchData();
  } catch {
    /* 错误提示由拦截器处理 */
  }
};

const handleMarkAllRead = async () => {
  try {
    await ElMessageBox.confirm('确定将全部未读通知标记为已读？', '提示', { type: 'warning' });
  } catch {
    return; // 用户取消
  }
  try {
    const res = await markAllNotificationsRead();
    ElMessage.success(`已标记 ${res?.count ?? 0} 条通知为已读`);
    await fetchData();
  } catch {
    /* 错误提示由拦截器处理 */
  }
};

const handleDelete = async (row: Notification) => {
  try {
    await ElMessageBox.confirm('确定要删除该通知吗？', '提示', { type: 'warning' });
  } catch {
    return; // 用户取消
  }
  try {
    await deleteNotification(row.id);
    ElMessage.success('通知已删除');
    // 删掉当前页最后一条时回退一页，避免停在空页
    if (tableData.value.length === 1 && pagination.page > 1) {
      pagination.page -= 1;
    }
    await fetchData();
  } catch {
    /* 错误提示由拦截器处理 */
  }
};

/** 查看详情：未读的先自动标记已读，再展示最新状态 */
const handleDetail = async (row: Notification) => {
  if (!row.isRead) {
    try {
      await markNotificationRead(row.id);
      await fetchData();
    } catch {
      /* 标记失败仍允许查看详情 */
    }
  }
  current.value = tableData.value.find((item) => item.id === row.id) ?? row;
  detailVisible.value = true;
};

onMounted(fetchData);
</script>

<style scoped>
.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
  gap: 12px;
  flex-wrap: wrap;
}

.toolbar-left,
.toolbar-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.toolbar-label {
  color: #606266;
  font-size: 14px;
}

.toolbar-bell {
  font-size: 18px;
  color: #606266;
}

.unread-switch {
  margin-left: 8px;
}

.pagination {
  margin-top: 20px;
  text-align: right;
}

:deep(.row-unread) {
  font-weight: 600;
  background-color: #fff8f8;
}

.detail-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 0;
  font-size: 14px;
}

.detail-label {
  color: #909399;
  width: 64px;
  flex: none;
}

.detail-value {
  color: #303133;
  word-break: break-all;
}

.detail-body {
  margin-top: 12px;
  padding: 12px;
  background-color: #f5f7fa;
  border-radius: 4px;
  color: #303133;
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.6;
}
</style>
