<template>
  <div class="rooms-page">
    <ManagementMetrics resource="rooms" />
    <ResourcePanel title="房源档案" :count="pagination.total" :loading="loading" :error="loadError" @retry="fetchData">
      <template #actions><ExportCurrent resource="rooms" :rows="tableData" /><el-button @click="goCleaning">保洁工作台</el-button><el-button type="primary" @click="handleCreate">＋ 新增房源</el-button></template>
      <div class="resource-tabs"><button :class="{active:!queryForm.status}" @click="queryForm.status='';handleQuery()">全部房源</button><button v-for="option in ROOM_STATUS_OPTIONS" :key="option.value" :class="{active:queryForm.status===option.value}" @click="queryForm.status=option.value;handleQuery()">{{ option.label }}</button></div>
      <!-- 搜索区域 -->
      <el-form :inline="true" :model="queryForm">
        <el-form-item label="房间号">
          <el-input v-model="queryForm.roomNumber" placeholder="请输入房间号" clearable @keyup.enter="handleQuery" />
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
        @row-dblclick="openDetail"
        :row-class-name="({row}:any)=>detailVisible && row.id===detailId ? 'detail-selected-row' : ''"
        :empty-text="emptyText"
      >
        <el-table-column prop="roomNumber" label="房源 / 户型" min-width="245" sortable>
          <template #default="{ row }">
            <button class="record-cell" @click="openDetail(row as Room)">
              <span class="record-glyph"><el-icon><House /></el-icon></span>
              <span>
                <strong>{{ row.roomNumber }}</strong>
                <small :title="roomSubtitle(row as Room)">{{ roomSubtitle(row as Room) }}</small>
              </span>
            </button>
          </template>
        </el-table-column>

        <el-table-column label="租约 / 租客" min-width="200">
          <template #default="{ row }">
            <div class="room-lease">
              <strong>{{ leaseOf(row as Room)?.tenant?.name || '暂无当前租客' }}</strong>
              <small v-if="leaseOf(row as Room)">
                {{ formatMoney(leaseOf(row as Room)!.rentAmount) }} / 月<template v-if="leaseOf(row as Room)?.status==='DRAFT'"> · 预订关联草稿</template>
              </small>
              <small v-else>未关联生效租约</small>
            </div>
          </template>
        </el-table-column>

        <el-table-column label="房态 / 清洁" width="150">
          <template #default="{ row }">
            <div class="room-state">
              <el-tag :type="roomStatusTagType(row.status)">{{ roomStatusLabel(row.status) }}</el-tag>
              <el-tag :type="cleanStatusTagType(row.cleanStatus)" effect="light">{{ cleanStatusLabel(row.cleanStatus) }}</el-tag>
            </div>
          </template>
        </el-table-column>

        <el-table-column label="最近待收" width="125">
          <template #default="{ row }">
            <div class="room-due">
              <strong>{{ leaseOf(row as Room)?.bills?.[0]?.dueDate?.slice(0,10) || '—' }}</strong>
              <small v-if="leaseOf(row as Room) && !leaseOf(row as Room)?.bills?.length">无未缴清账单</small>
            </div>
          </template>
        </el-table-column>

        <el-table-column label="操作" width="110" fixed="right">
          <template #default="{ row }">
            <div class="table-actions">
              <el-button class="table-action" @click="openDetail(row as Room)">详情</el-button>
              <el-dropdown trigger="click" @command="handleRoomCommand($event, row as Room)">
                <el-button class="table-action table-action--icon" aria-label="更多房源操作">
                  <el-icon><MoreFilled /></el-icon>
                </el-button>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item command="status">房态变更</el-dropdown-item>
                    <el-dropdown-item command="edit">编辑房源</el-dropdown-item>
                    <el-dropdown-item command="delete" divided style="color: var(--error-text)">删除房源</el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
            </div>
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
          @current-change="fetchData"
        />
      </div>
    </ResourcePanel>
    <PropertyDetailPanel ref="detailPanel" v-model="detailVisible" kind="rooms" :id="detailId" @edit="handleEdit($event as any)" @status="handleStatus($event as any)" />

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
          <EntitySelect v-model="formData.buildingId" resource="buildings" />
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
        <el-form-item label="房源照片">
          <div v-loading="editLoading" class="room-photo-field">
            <RoomPhotoEditor v-model="formData.photos" />
          </div>
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitLoading" :disabled="editLoading" @click="handleSubmit">
          确定
        </el-button>
      </template>
    </el-dialog>

    <!-- 房态流转（乐观锁） -->
    <RoomStatusDialog
      v-model="statusDialogVisible"
      :room="statusRow"
      @success="handleStatusSuccess"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, reactive, onMounted, watch } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { House, MoreFilled } from '@element-plus/icons-vue';
import { formatMoney } from '@/utils/table';
import ResourcePanel from '@/components/common/ResourcePanel.vue';
import ManagementMetrics from '@/components/common/ManagementMetrics.vue';
import ExportCurrent from '@/components/common/ExportCurrent.vue';
import PropertyDetailPanel from '@/components/common/PropertyDetailPanel.vue';
import EntitySelect from '@/components/common/EntitySelect.vue';
import RoomStatusDialog from './components/RoomStatusDialog.vue';
import RoomPhotoEditor from './components/RoomPhotoEditor.vue';
import type { FormInstance, FormRules } from 'element-plus';
import {
  ALL_ROOMS_LIMIT,
  createRoom,
  deleteRoom,
  fetchAllRooms,
  getRoomById,
  getRooms,
  updateRoom,
} from '@/api/rooms';
import type { CleanStatus, Room, RoomPhoto, RoomStatus } from '@/types';
import { toRoomPhotoPayload } from '@/utils/roomPhotos';
import {
  CLEAN_STATUS_OPTIONS,
  ROOM_STATUS_OPTIONS,
  cleanStatusLabel,
  cleanStatusTagType,
  roomStatusLabel,
  roomStatusTagType,
} from '@/utils/roomStatus';

const router = useRouter();
const route = useRoute();

const loading = ref(false);
const loadError = ref('');
const detailVisible=ref(false);const detailId=ref('');
const detailPanel=ref<InstanceType<typeof PropertyDetailPanel>>();
function openDetail(row:Room){detailId.value=row.id;detailVisible.value=true;if(route.query.detail!==row.id)void router.replace({query:{...route.query,detail:row.id}});}
const submitLoading = ref(false);
const editLoading = ref(false);
const dialogVisible = ref(false);
const dialogTitle = ref('新增房源');
const formRef = ref<FormInstance>();
const tableData = ref<Room[]>([]);
const currentEditId = ref<string>('');
const currentVersion = ref(0);

// 房态流转（乐观锁）
const statusDialogVisible = ref(false);
const statusRow = ref<Room | null>(null);

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

const formData = reactive<{
  buildingId: string;
  roomNumber: string;
  floor: number;
  roomType: string;
  area: number;
  facilities: string[];
  photos: RoomPhoto[];
}>({
  buildingId: 'building-001',
  roomNumber: '',
  floor: 1,
  roomType: '',
  area: 0,
  facilities: [],
  photos: [],
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
function leaseOf(row:Room){return row.contracts?.find(contract=>contract.status===(row.status==='RESERVED'?'DRAFT':'ACTIVE'));}
function roomSubtitle(row: Room) {
  const area = row.area == null ? '面积未记录' : `${row.area} m²`;
  return `${roomTypeMap[row.roomType]} · ${area} · ${row.building?.name || '未关联楼栋'} / ${row.floor} 楼`;
}

/** 本地过滤：仅房号模糊匹配（清洁状态已由服务端 cleanStatus 处理） */
const applyLocalFilters = (rooms: Room[]) => {
  const keyword = queryForm.roomNumber.trim().toLowerCase();
  return rooms.filter(
    (room) => !keyword || (room.roomNumber || '').toLowerCase().includes(keyword),
  );
};

const fetchData = async () => {
  loading.value = true;
  loadError.value='';
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
    loadError.value='房源列表未能更新，已保留上一次记录。请重试。';
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
  handleDialogClose();
  dialogTitle.value = '新增房源';
  currentEditId.value = '';
  editLoading.value = false;
  dialogVisible.value = true;
};

const handleEdit = async (row: Room) => {
  handleDialogClose();
  dialogTitle.value = '编辑房源';
  currentEditId.value = row.id;
  currentVersion.value = row.version;
  Object.assign(formData, {
    buildingId: row.buildingId,
    roomNumber: row.roomNumber,
    floor: row.floor,
    roomType: row.roomType,
    area: Number(row.area || 0),
    facilities: row.facilities || [],
    photos: row.photos || [],
  });
  dialogVisible.value = true;
  editLoading.value = true;

  try {
    // 列表接口不带照片，编辑必须以详情为准；加载失败则不打开保存，避免误删已有照片。
    const detail = await getRoomById(row.id);
    if (currentEditId.value !== row.id) return;
    Object.assign(formData, {
      photos: detail.photos || [],
    });
    currentVersion.value = detail.version;
  } catch {
    if (currentEditId.value === row.id) {
      dialogVisible.value = false;
      ElMessage.error('房源详情加载失败，请刷新后重试');
    }
  } finally {
    if (currentEditId.value === row.id) editLoading.value = false;
  }
};

// 房态流转
const handleStatus = (row: Room) => {
  statusRow.value = row;
  statusDialogVisible.value = true;
};

const handleStatusSuccess = () => {
  fetchData();
  void detailPanel.value?.reload();
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

function handleRoomCommand(command: string, row: Room) {
  if (command === 'status') handleStatus(row);
  else if (command === 'edit') handleEdit(row);
  else if (command === 'delete') void handleDelete(row);
}

const handleSubmit = async () => {
  if (!formRef.value) return;

  await formRef.value.validate(async (valid) => {
    if (!valid) return;

    submitLoading.value = true;
    try {
      const data: any = { ...formData, photos: toRoomPhotoPayload(formData.photos) };

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
      void detailPanel.value?.reload();
    } catch (error) {
      ElMessage.error('操作失败');
    } finally {
      submitLoading.value = false;
    }
  });
};

const handleDialogClose = () => {
  formRef.value?.resetFields();
  editLoading.value = false;
  Object.assign(formData, {
    buildingId: 'building-001',
    roomNumber: '',
    floor: 1,
    roomType: '',
    area: 0,
    facilities: [],
    photos: [],
  });
};

onMounted(() => {
  fetchData();
  if (route.query.action === 'create') handleCreate();
  if(typeof route.query.detail==='string')openDetail({id:route.query.detail} as Room);
});

watch(() => route.query.action, (action) => { if (action === 'create') handleCreate(); });
watch(()=>route.query.detail,id=>{if(typeof id==='string')openDetail({id} as Room);else detailVisible.value=false;});
watch(detailVisible,open=>{if(!open&&route.query.detail===detailId.value)void router.replace({query:{...route.query,detail:undefined}});});
</script>

<style scoped>
.rooms-page {
  padding: 0;
}

.filter-tip {
  margin-bottom: 12px;
}

.room-lease strong,
.room-due strong {
  display: block;
  overflow: hidden;
  color: var(--text-primary);
  font-size: 12px;
  font-weight: 650;
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.room-lease small,
.room-due small {
  display: block;
  margin-top: 4px;
  overflow: hidden;
  color: var(--text-muted);
  font-size: var(--font-micro);
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.room-state {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
}
.room-state :deep(.el-tag) {
  height: 18px;
  padding: 0 5px;
  font-size: var(--font-micro);
}
.room-photo-field {
  width: 100%;
  min-height: 58px;
}
</style>
