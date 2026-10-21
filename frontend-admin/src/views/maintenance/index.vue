<template>
  <div class="maintenance-page">
    <ManagementMetrics resource="maintenance" />
    <ResourcePanel title="报修工单" :count="pagination.total" :loading="loading" :error="loadError" @retry="fetchData"><template #actions><ExportCurrent resource="maintenance" :rows="tableData" /><el-button :loading="loading" @click="fetchData">刷新工单</el-button></template>
      <div class="resource-tabs"><button v-for="tab in [{value:'',label:'全部工单'},{value:'SUBMITTED',label:'待受理'},{value:'IN_PROGRESS',label:'处理中'},{value:'PENDING_CONFIRM',label:'待确认'},{value:'COMPLETED',label:'已完成'}]" :key="tab.value" :class="{active:queryForm.status===tab.value}" @click="queryForm.status=tab.value;handleQuery()">{{ tab.label }}</button></div>
      <el-form :inline="true" :model="queryForm">
        <el-form-item label="状态">
          <el-select v-model="queryForm.status" placeholder="请选择状态" clearable>
            <el-option label="已提交" value="SUBMITTED" />
            <el-option label="已受理" value="ACKNOWLEDGED" />
            <el-option label="已派单" value="ASSIGNED" />
            <el-option label="维修中" value="IN_PROGRESS" />
            <el-option label="待确认" value="PENDING_CONFIRM" />
            <el-option label="已完成" value="COMPLETED" />
            <el-option label="已取消" value="CANCELLED" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="handleQuery">查询</el-button>
          <el-button @click="handleReset">重置</el-button>
        </el-form-item>
      </el-form>

      <div class="repair-grid"><article v-for="row in tableData" :key="row.id" :class="['repair-work-card',{'repair-with-photo':row.photos?.length}]">
        <div v-if="row.photos?.length" class="repair-card-photo"><ProtectedImage :url="row.photos[0].fileUrl" /><span class="repair-photo-count">{{ row._count?.photos ?? row.photos.length }} 张照片</span></div>
        <div class="repair-card-content">
          <div class="repair-work-top"><span class="record-glyph"><el-icon><Tools /></el-icon></span><span>{{ categoryMap[row.category] }}问题</span><el-tag :type="priorityTypeMap[row.priority]">{{ priorityMap[row.priority] }}</el-tag></div>
          <button class="repair-title" @click="openDetail(row)">{{ row.title }}</button>
          <p class="repair-work-description">{{ row.description }}</p>
          <div class="repair-work-meta"><span>{{ row.room?.roomNumber || '未关联房源' }} · {{ row.tenant?.name || '物业记录' }}</span><time>{{ formatDateTime(row.createdAt) }}</time></div>
        </div>
        <div class="repair-work-footer">
          <el-tag :type="statusTypeMap[row.status]">{{ displayStatus(row) }}</el-tag>
          <div><el-button text @click="openDetail(row)">查看详情</el-button><el-button type="primary" plain @click="handleEdit(row)">处理工单</el-button><el-dropdown><el-button text aria-label="更多工单操作">···</el-button><template #dropdown><el-dropdown-menu><el-dropdown-item @click="handleDelete(row)">删除工单</el-dropdown-item></el-dropdown-menu></template></el-dropdown></div>
        </div>
      </article></div>
      <el-empty v-if="!tableData.length && !loading && !loadError" :description="emptyText" :image-size="64"><p class="empty-guide">新工单提交后会显示在这里，可以按处理阶段筛选。</p></el-empty>

      <div style="margin-top: 20px; text-align: right">
        <el-pagination
          v-model:current-page="pagination.page"
          v-model:page-size="pagination.limit"
          :total="pagination.total"
          layout="total, prev, pager, next"
          @current-change="fetchData"
        />
      </div>
    </ResourcePanel>
    <ResourceDrawer v-model="detailVisible" resource="maintenance" :id="detailId" @edit="handleEdit($event as any)" />

    <el-dialog v-model="dialogVisible" title="处理报修" width="500px">
      <el-form :model="formData" label-width="100px">
        <el-form-item label="状态">
          <el-select v-model="formData.status">
            <el-option label="已受理" value="ACKNOWLEDGED" />
            <el-option label="已派单" value="ASSIGNED" />
            <el-option label="维修中" value="IN_PROGRESS" />
            <el-option label="待确认" value="PENDING_CONFIRM" />
            <el-option label="已完成" value="COMPLETED" />
            <el-option label="已取消" value="CANCELLED" />
          </el-select>
        </el-form-item>
        <el-form-item label="处理人">
          <el-select v-model="formData.assignedTo" clearable placeholder="放入公共池或选择维修人员">
            <el-option label="公共工单池（维修人员先接先得）" value="" />
            <el-option
              v-for="assignee in assignees"
              :key="assignee.id"
              :value="assignee.id"
              :label="`维修人员 · ${assignee.email || assignee.id}`"
            />
            <el-option
              v-if="keepCurrentAssignee"
              :value="formData.assignedTo"
              label="保持当前指派人员"
            />
            <el-option v-if="userStore.user" :value="userStore.user.id" :label="`由我跟进 · ${userStore.user.email}`" />
          </el-select>
        </el-form-item>
        <el-form-item label="解决方案">
          <el-input v-model="formData.resolution" type="textarea" :rows="4" placeholder="请输入解决方案" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitLoading" @click="handleSubmit">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted,watch } from 'vue';
import { useRoute } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Tools } from '@element-plus/icons-vue';
import { formatDateTime } from '@/utils/table';
import { useUserStore } from '@/stores/user';
import ResourcePanel from '@/components/common/ResourcePanel.vue';
import ManagementMetrics from '@/components/common/ManagementMetrics.vue';
import ExportCurrent from '@/components/common/ExportCurrent.vue';
import ResourceDrawer from '@/components/common/ResourceDrawer.vue';
import ProtectedImage from '@/components/common/ProtectedImage.vue';
import { getMaintenanceList, getMaintenanceAssignees, updateMaintenance, deleteMaintenance } from '@/api/maintenance';
import type { Maintenance } from '@/types';
import type { MaintenanceAssignee } from '@/api/maintenance';

const loading = ref(false);
const route=useRoute();
const userStore=useUserStore();const loadError=ref('');const detailVisible=ref(false);const detailId=ref('');
function openDetail(row:Maintenance){detailId.value=row.id;detailVisible.value=true;}
const submitLoading = ref(false);
const dialogVisible = ref(false);
const tableData = ref<Maintenance[]>([]);
const currentEditId = ref('');
const assignees = ref<MaintenanceAssignee[]>([]);

/** 已指派人员不在候选列表时保留原值，避免编辑时被静默清空 */
const keepCurrentAssignee = computed(() =>
  Boolean(
    formData.assignedTo &&
      formData.assignedTo !== userStore.user?.id &&
      !assignees.value.some((item) => item.id === formData.assignedTo),
  ),
);

/** ASSIGNED 且无指派人 = 公共池待接单 */
const displayStatus = (row: Maintenance) =>
  row.status === 'ASSIGNED' && !row.assignedTo ? '待接单（公共池）' : statusMap[row.status];

const queryForm = reactive({ status: '' });

/** 区分「系统暂无数据」与「筛选无结果」 */
const emptyText = computed(() =>
  queryForm.status ? '没有符合条件的报修，试试调整状态筛选' : '暂无报修记录',
);
const pagination = reactive({ page: 1, limit: 20, total: 0 });
const formData = reactive({
  status: '',
  assignedTo: '',
  resolution: '',
});

const categoryMap: Record<string, string> = {
  PLUMBING: '水管',
  ELECTRICAL: '电路',
  APPLIANCE: '家电',
  FURNITURE: '家具',
  DOOR_WINDOW: '门窗',
  OTHER: '其他',
};

const priorityMap: Record<string, string> = {
  LOW: '低',
  NORMAL: '普通',
  URGENT: '紧急',
};

const priorityTypeMap: Record<string, any> = {
  LOW: 'info',
  NORMAL: 'primary',
  URGENT: 'danger',
};

const statusMap: Record<string, string> = {
  SUBMITTED: '已提交',
  ACKNOWLEDGED: '已受理',
  ASSIGNED: '已派单',
  IN_PROGRESS: '维修中',
  PENDING_CONFIRM: '待确认',
  COMPLETED: '已完成',
  CANCELLED: '已取消',
};

const statusTypeMap: Record<string, any> = {
  SUBMITTED: 'warning',
  ACKNOWLEDGED: 'info',
  ASSIGNED: 'info',
  IN_PROGRESS: 'primary',
  PENDING_CONFIRM: 'warning',
  COMPLETED: 'success',
  CANCELLED: 'info',
};

const fetchData = async () => {
  loading.value = true;
  loadError.value='';
  try {
    const response = await getMaintenanceList({ page: pagination.page, limit: pagination.limit, ...queryForm });
    tableData.value = response.data;
    pagination.total = response.meta.total;
  } catch (error) {
    loadError.value='工单列表未能加载，已保留上一次记录。请重试。';
  } finally {
    loading.value = false;
  }
};

const handleQuery = () => {
  pagination.page = 1;
  fetchData();
};

const handleReset = () => {
  queryForm.status = '';
  handleQuery();
};

const handleEdit = (row: Maintenance) => {
  currentEditId.value = row.id;
  formData.status = row.status;
  formData.assignedTo = row.assignedTo || '';
  formData.resolution = row.resolution || '';
  dialogVisible.value = true;
};

const handleDelete = async (row: Maintenance) => {
  try {
    await ElMessageBox.confirm(
      `确定删除报修「${row.title || row.id}」吗？删除后不可恢复。`,
      '删除报修',
      { type: 'warning', confirmButtonText: '确定删除', cancelButtonText: '取消' },
    );
    await deleteMaintenance(row.id);
    ElMessage.success('删除成功');
    fetchData();
  } catch (error: any) {
    if (error !== 'cancel') ElMessage.error('删除失败');
  }
};

const handleSubmit = async () => {
  if (
    ['IN_PROGRESS', 'PENDING_CONFIRM'].includes(formData.status) &&
    !formData.assignedTo
  ) {
    ElMessage.warning('请先指派维修人员，再进入维修中');
    return;
  }
  submitLoading.value = true;
  try {
    // 只有派单状态才允许提交空值（公共池）；其他状态若带指派人则一并保存。
    const data: any = { status: formData.status, resolution: formData.resolution };
    if (formData.status === 'ASSIGNED') data.assignedTo = formData.assignedTo || '';
    else if (formData.assignedTo) data.assignedTo = formData.assignedTo;
    await updateMaintenance(currentEditId.value, data);
    ElMessage.success('更新成功');
    dialogVisible.value = false;
    fetchData();
  } catch (error) {
    ElMessage.error('操作失败');
  } finally {
    submitLoading.value = false;
  }
};

const loadAssignees = async () => {
  try {
    assignees.value = await getMaintenanceAssignees();
  } catch {
    // 候选人加载失败不阻断工单列表；仍可选公共池或自己
    assignees.value = [];
  }
};

onMounted(()=>{void fetchData();void loadAssignees();if(typeof route.query.detail==='string'){detailId.value=route.query.detail;detailVisible.value=true;}});
watch(()=>route.query.detail,id=>{if(typeof id==='string'){detailId.value=id;detailVisible.value=true;}});
</script>

<style scoped>
.maintenance-page { padding: 0; }
</style>
