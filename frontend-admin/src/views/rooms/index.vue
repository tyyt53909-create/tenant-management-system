<template>
  <div class="rooms-page">
    <el-card>
      <!-- 搜索区域 -->
      <el-form :inline="true" :model="queryForm">
        <el-form-item label="房间号">
          <el-input v-model="queryForm.roomNumber" placeholder="请输入房间号" clearable @keyup.enter="handleQuery" />
        </el-form-item>
        <el-form-item label="房态">
          <el-select v-model="queryForm.status" placeholder="请选择房态" clearable style="width: 140px">
            <el-option
              v-for="item in ROOM_STATUS_OPTIONS"
              :key="item.value"
              :label="item.label"
              :value="item.value"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="清洁状态">
          <el-select
            v-model="queryForm.cleanStatus"
            placeholder="请选择清洁状态"
            clearable
            style="width: 150px"
          >
            <el-option
              v-for="item in CLEAN_STATUS_OPTIONS"
              :key="item.value"
              :label="item.label"
              :value="item.value"
            />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="handleQuery">查询</el-button>
          <el-button @click="handleReset">重置</el-button>
          <el-button :type="pendingOnly ? 'warning' : 'default'" @click="handleTogglePendingOnly">
            只看待清洁
          </el-button>
          <el-button @click="goCleaning">保洁工作台</el-button>
          <el-button type="primary" @click="handleCreate">新增房源</el-button>
        </el-form-item>
      </el-form>

      <el-alert
        v-if="localFilterActive"
        class="filter-tip"
        type="info"
        :closable="false"
        show-icon
        :title="localFilterTip"
      />

      <!-- 表格 -->
      <el-table
        :data="tableData"
        v-loading="loading"
        border
        stripe
        :empty-text="emptyText"
      >
        <el-table-column prop="roomNumber" label="房间号" width="120" sortable />
        <el-table-column prop="floor" label="楼层" width="80" sortable />
        <el-table-column prop="roomType" label="房型" width="120">
          <template #default="{ row }">
            <el-tag>{{ roomTypeMap[row.roomType] }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="area" label="面积(㎡)" width="110" sortable />
        <el-table-column prop="status" label="房态" width="100">
          <template #default="{ row }">
            <el-tag :type="roomStatusTagType(row.status)">
              {{ roomStatusLabel(row.status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="cleanStatus" label="清洁状态" width="120">
          <template #default="{ row }">
            <el-tag :type="cleanStatusTagType(row.cleanStatus)" effect="light">
              {{ cleanStatusLabel(row.cleanStatus) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="220" fixed="right">
          <template #default="{ row }">
            <el-button type="primary" link @click="handleStatus(row)">房态</el-button>
            <el-button type="primary" link @click="handleEdit(row)">编辑</el-button>
            <el-button type="danger" link @click="handleDelete(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>

      <!-- 分页 -->
      <div style="margin-top: 20px; text-align: right">
        <el-pagination
          v-model:current-page="pagination.page"
          v-model:page-size="pagination.limit"
          :total="pagination.total"
          :page-sizes="[10, 20, 50, 100]"
          layout="total, sizes, prev, pager, next, jumper"
          @size-change="handleSizeChange"
        />
      </div>
    </el-card>

    <!-- 新增/编辑对话框 -->
    <el-dialog
      v-model="dialogVisible"
      :title="dialogTitle"
      width="600px"
      @close="handleDialogClose"
    >
      <el-form
        ref="formRef"
        :model="formData"
        :rules="rules"
        label-width="100px"
      >
        <el-form-item label="楼栋" prop="buildingId">
          <el-input v-model="formData.buildingId" placeholder="请输入楼栋ID" />
        </el-form-item>
        <el-form-item label="房间号" prop="roomNumber">
          <el-input v-model="formData.roomNumber" placeholder="请输入房间号" />
        </el-form-item>
        <el-form-item label="楼层" prop="floor">
          <el-input-number v-model="formData.floor" :min="1" />
        </el-form-item>
        <el-form-item label="房型" prop="roomType">
          <el-select v-model="formData.roomType" placeholder="请选择房型">
            <el-option label="单间" value="SINGLE" />
            <el-option label="一室一厅" value="ONE_BED" />
            <el-option label="两室一厅" value="TWO_BED" />
            <el-option label="三室一厅" value="THREE_BED" />
            <el-option label="开间" value="STUDIO" />
          </el-select>
        </el-form-item>
        <el-form-item label="面积(㎡)" prop="area">
          <el-input-number v-model="formData.area" :min="1" :precision="2" />
        </el-form-item>
        <el-form-item label="设施" prop="facilities">
          <el-checkbox-group v-model="formData.facilities">
            <el-checkbox label="空调">空调</el-checkbox>
            <el-checkbox label="洗衣机">洗衣机</el-checkbox>
            <el-checkbox label="冰箱">冰箱</el-checkbox>
            <el-checkbox label="热水器">热水器</el-checkbox>
            <el-checkbox label="WiFi">WiFi</el-checkbox>
          </el-checkbox-group>
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitLoading" @click="handleSubmit">
          确定
        </el-button>
      </template>
    </el-dialog>

    <!-- 房态流转（乐观锁） -->
    <el-dialog v-model="statusDialogVisible" title="房态流转" width="460px">
      <el-descriptions :column="2" border size="small" style="margin-bottom: 16px">
        <el-descriptions-item label="房源">{{ statusRow?.roomNumber }}</el-descriptions-item>
        <el-descriptions-item label="版本号">v{{ statusRow?.version }}</el-descriptions-item>
        <el-descriptions-item label="当前房态">{{ roomStatusLabel(statusRow?.status) }}</el-descriptions-item>
        <el-descriptions-item label="当前清洁">{{ cleanStatusLabel(statusRow?.cleanStatus) }}</el-descriptions-item>
      </el-descriptions>
      <el-form label-width="110px">
        <el-form-item label="目标房态">
          <el-select v-model="statusForm.status">
            <el-option label="空置" value="VACANT" />
            <el-option label="已预订" value="RESERVED" />
            <el-option label="已租" value="OCCUPIED" />
            <el-option label="维护中" value="MAINTENANCE" />
          </el-select>
        </el-form-item>
        <el-form-item label="目标清洁状态">
          <el-select v-model="statusForm.cleanStatus">
            <el-option label="已清洁" value="CLEAN" />
            <el-option label="待清洁" value="PENDING_CLEAN" />
            <el-option label="清洁中" value="CLEANING" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="statusDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="statusSubmitting" @click="handleStatusSubmit">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, reactive, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import type { FormInstance, FormRules } from 'element-plus';
import {
  ALL_ROOMS_LIMIT,
  createRoom,
  deleteRoom,
  fetchAllRooms,
  getRooms,
  updateRoom,
  updateRoomStatus,
} from '@/api/rooms';
import type { CleanStatus, Room, RoomStatus } from '@/types';
import {
  CLEAN_STATUS_OPTIONS,
  ROOM_STATUS_OPTIONS,
  cleanStatusLabel,
  cleanStatusTagType,
  roomStatusLabel,
  roomStatusTagType,
} from '@/utils/roomStatus';

const router = useRouter();

const loading = ref(false);
const submitLoading = ref(false);
const dialogVisible = ref(false);
const dialogTitle = ref('新增房源');
const formRef = ref<FormInstance>();
const tableData = ref<Room[]>([]);
const currentEditId = ref<string>('');
const currentVersion = ref(0);

// 房态流转（乐观锁）
const statusDialogVisible = ref(false);
const statusSubmitting = ref(false);
const statusRow = ref<Room | null>(null);
const statusForm = reactive<{ status: '' | RoomStatus; cleanStatus: '' | CleanStatus }>({
  status: '',
  cleanStatus: '',
});

const queryForm = reactive<{
  roomNumber: string;
  status: '' | RoomStatus;
  cleanStatus: '' | CleanStatus;
}>({
  roomNumber: '',
  status: '',
  cleanStatus: '',
});

/** 是否处于「只看待清洁」快捷筛选 */
const pendingOnly = computed(() => queryForm.cleanStatus === 'PENDING_CLEAN');
/**
 * 仅「房号」需要本地过滤（后端 QueryRoomsDto 无 roomNumber）；
 * 清洁状态自 T157 起支持服务端过滤（cleanStatus），不再全量加载。
 */
const localFilterActive = ref(false);
const allRoomsTruncated = ref(false);

const pagination = reactive({
  page: 1,
  limit: 20,
  total: 0,
});

/** 区分「系统暂无房源」与「筛选无结果」 */
const emptyText = computed(() =>
  queryForm.roomNumber || queryForm.status || queryForm.cleanStatus
    ? '没有符合条件的房源，试试调整房号、房态或清洁状态'
    : '暂无房源，点击右上角「新增房源」开始录入',
);

const localFilterTip = computed(() => {
  const base = `房号由前端本地过滤（后端暂不支持该查询参数），当前匹配 ${pagination.total} 条`;
  return allRoomsTruncated.value
    ? `${base}；房源总数超过 ${ALL_ROOMS_LIMIT} 条，仅加载前 ${ALL_ROOMS_LIMIT} 条`
    : base;
});

const formData = reactive({
  buildingId: 'building-001',
  roomNumber: '',
  floor: 1,
  roomType: '',
  area: 0,
  facilities: [] as string[],
});

const rules: FormRules = {
  buildingId: [{ required: true, message: '请输入楼栋ID', trigger: 'blur' }],
  roomNumber: [{ required: true, message: '请输入房间号', trigger: 'blur' }],
  floor: [{ required: true, message: '请输入楼层', trigger: 'blur' }],
  roomType: [{ required: true, message: '请选择房型', trigger: 'change' }],
  area: [{ required: true, message: '请输入面积', trigger: 'blur' }],
};

const roomTypeMap: Record<string, string> = {
  SINGLE: '单间',
  ONE_BED: '一室一厅',
  TWO_BED: '两室一厅',
  THREE_BED: '三室一厅',
  STUDIO: '开间',
};

/** 本地过滤：仅房号模糊匹配（清洁状态已由服务端 cleanStatus 处理） */
const applyLocalFilters = (rooms: Room[]) => {
  const keyword = queryForm.roomNumber.trim().toLowerCase();
  return rooms.filter(
    (room) => !keyword || (room.roomNumber || '').toLowerCase().includes(keyword),
  );
};

const fetchData = async () => {
  loading.value = true;
  try {
    if (queryForm.roomNumber.trim()) {
      // 房号后端不支持：分页拉全量后本地筛选 + 本地分页
      const result = await fetchAllRooms({
        status: queryForm.status || undefined,
        cleanStatus: queryForm.cleanStatus || undefined,
      });
      const matched = applyLocalFilters(result.data);
      localFilterActive.value = true;
      allRoomsTruncated.value = result.truncated;
      pagination.total = matched.length;
      const start = (pagination.page - 1) * pagination.limit;
      tableData.value = matched.slice(start, start + pagination.limit);
    } else {
      // 服务端分页：只发送 QueryRoomsDto 白名单且非空的参数（避免 400）
      const response = await getRooms({
        page: pagination.page,
        limit: pagination.limit,
        status: queryForm.status || undefined,
        // 清洁状态服务端过滤（T157），替代原先「加载全量后本地过滤」
        cleanStatus: queryForm.cleanStatus || undefined,
      });
      localFilterActive.value = false;
      allRoomsTruncated.value = false;
      tableData.value = response.data;
      pagination.total = response.meta.total;
    }
  } catch (error) {
    ElMessage.error('获取数据失败');
  } finally {
    loading.value = false;
  }
};

const handleQuery = () => {
  pagination.page = 1;
  fetchData();
};

const handleSizeChange = () => {
  pagination.page = 1;
  fetchData();
};

const handleReset = () => {
  queryForm.roomNumber = '';
  queryForm.status = '';
  queryForm.cleanStatus = '';
  handleQuery();
};

/** 「只看待清洁」快捷筛选开关 */
const handleTogglePendingOnly = () => {
  queryForm.cleanStatus = pendingOnly.value ? '' : 'PENDING_CLEAN';
  handleQuery();
};

/** 跳转保洁工作台 */
const goCleaning = () => {
  router.push('/cleaning');
};

const handleCreate = () => {
  dialogTitle.value = '新增房源';
  currentEditId.value = '';
  dialogVisible.value = true;
};

const handleEdit = (row: Room) => {
  dialogTitle.value = '编辑房源';
  currentEditId.value = row.id;
  currentVersion.value = row.version;
  Object.assign(formData, {
    buildingId: row.buildingId,
    roomNumber: row.roomNumber,
    floor: row.floor,
    roomType: row.roomType,
    area: row.area,
    facilities: row.facilities || [],
  });
  dialogVisible.value = true;
};

// 房态流转
const handleStatus = (row: Room) => {
  statusRow.value = row;
  statusForm.status = row.status;
  statusForm.cleanStatus = row.cleanStatus;
  statusDialogVisible.value = true;
};

const handleStatusSubmit = async () => {
  const row = statusRow.value;
  if (!row) return;
  statusSubmitting.value = true;
  try {
    await updateRoomStatus(row.id, {
      status: statusForm.status || undefined,
      cleanStatus: statusForm.cleanStatus || undefined,
      version: row.version,
    });
    ElMessage.success('房态已更新');
    statusDialogVisible.value = false;
    fetchData();
  } catch {
    // 请求拦截器已提示（非法流转 400 / 版本冲突 409）
  } finally {
    statusSubmitting.value = false;
  }
};

const handleDelete = async (row: Room) => {
  try {
    await ElMessageBox.confirm(
      `确定删除房源「${row.roomNumber || row.id}」吗？\n若该房源已出租或存在历史记录，删除会被后端拒绝。`,
      '删除房源',
      { type: 'warning', confirmButtonText: '确定删除', cancelButtonText: '取消' },
    );
    await deleteRoom(row.id);
    ElMessage.success('删除成功');
    fetchData();
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error('删除失败');
    }
  }
};

const handleSubmit = async () => {
  if (!formRef.value) return;

  await formRef.value.validate(async (valid) => {
    if (!valid) return;

    submitLoading.value = true;
    try {
      const data: any = { ...formData };

      if (currentEditId.value) {
        // 乐观锁：携带版本号，冲突时后端返回 409
        await updateRoom(currentEditId.value, { ...data, version: currentVersion.value });
        ElMessage.success('更新成功');
      } else {
        await createRoom(data);
        ElMessage.success('创建成功');
      }

      dialogVisible.value = false;
      fetchData();
    } catch (error) {
      ElMessage.error('操作失败');
    } finally {
      submitLoading.value = false;
    }
  });
};

const handleDialogClose = () => {
  formRef.value?.resetFields();
  Object.assign(formData, {
    buildingId: 'building-001',
    roomNumber: '',
    floor: 1,
    roomType: '',
    area: 0,
    facilities: [],
  });
};

onMounted(() => {
  fetchData();
});
</script>

<style scoped>
.rooms-page {
  padding: 0;
}

.filter-tip {
  margin-bottom: 12px;
}
</style>
