<template>
  <div class="rooms-page">
    <el-card>
      <!-- 搜索区域 -->
      <el-form :inline="true" :model="queryForm">
        <el-form-item label="房间号">
          <el-input v-model="queryForm.roomNumber" placeholder="请输入房间号" clearable />
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="queryForm.status" placeholder="请选择状态" clearable>
            <el-option label="空置" value="VACANT" />
            <el-option label="已租" value="OCCUPIED" />
            <el-option label="维护中" value="MAINTENANCE" />
            <el-option label="已预订" value="RESERVED" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="handleQuery">查询</el-button>
          <el-button @click="handleReset">重置</el-button>
          <el-button type="primary" @click="handleCreate">新增房源</el-button>
        </el-form-item>
      </el-form>

      <!-- 表格 -->
      <el-table :data="tableData" v-loading="loading" border stripe>
        <el-table-column prop="roomNumber" label="房间号" width="120" />
        <el-table-column prop="floor" label="楼层" width="80" />
        <el-table-column prop="roomType" label="房型" width="120">
          <template #default="{ row }">
            <el-tag>{{ roomTypeMap[row.roomType] }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="area" label="面积(㎡)" width="100" />
        <el-table-column prop="monthlyRent" label="月租金" width="120">
          <template #default="{ row }">
            ¥{{ (row.monthlyRent / 100).toFixed(2) }}
          </template>
        </el-table-column>
        <el-table-column prop="status" label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="statusTypeMap[row.status]">
              {{ statusMap[row.status] }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="cleanStatus" label="清洁状态" width="120">
          <template #default="{ row }">
            <el-tag :type="cleanStatusTypeMap[row.cleanStatus]">
              {{ cleanStatusMap[row.cleanStatus] }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="180" fixed="right">
          <template #default="{ row }">
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
          @size-change="handleQuery"
          @current-change="handleQuery"
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
        <el-form-item label="月租金(元)" prop="monthlyRent">
          <el-input-number v-model="formData.monthlyRent" :min="0" :precision="2" />
        </el-form-item>
        <el-form-item label="押金(元)" prop="deposit">
          <el-input-number v-model="formData.deposit" :min="0" :precision="2" />
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
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import type { FormInstance, FormRules } from 'element-plus';
import { getRooms, createRoom, updateRoom, deleteRoom } from '@/api/rooms';
import type { Room } from '@/types';

const loading = ref(false);
const submitLoading = ref(false);
const dialogVisible = ref(false);
const dialogTitle = ref('新增房源');
const formRef = ref<FormInstance>();
const tableData = ref<Room[]>([]);
const currentEditId = ref<string>('');

const queryForm = reactive({
  roomNumber: '',
  status: '',
});

const pagination = reactive({
  page: 1,
  limit: 20,
  total: 0,
});

const formData = reactive({
  buildingId: 'building-001',
  roomNumber: '',
  floor: 1,
  roomType: '',
  area: 0,
  monthlyRent: 0,
  deposit: 0,
  facilities: [] as string[],
});

const rules: FormRules = {
  buildingId: [{ required: true, message: '请输入楼栋ID', trigger: 'blur' }],
  roomNumber: [{ required: true, message: '请输入房间号', trigger: 'blur' }],
  floor: [{ required: true, message: '请输入楼层', trigger: 'blur' }],
  roomType: [{ required: true, message: '请选择房型', trigger: 'change' }],
  area: [{ required: true, message: '请输入面积', trigger: 'blur' }],
  monthlyRent: [{ required: true, message: '请输入月租金', trigger: 'blur' }],
  deposit: [{ required: true, message: '请输入押金', trigger: 'blur' }],
};

const roomTypeMap: Record<string, string> = {
  SINGLE: '单间',
  ONE_BED: '一室一厅',
  TWO_BED: '两室一厅',
  THREE_BED: '三室一厅',
  STUDIO: '开间',
};

const statusMap: Record<string, string> = {
  VACANT: '空置',
  OCCUPIED: '已租',
  MAINTENANCE: '维护中',
  RESERVED: '已预订',
};

const statusTypeMap: Record<string, any> = {
  VACANT: 'success',
  OCCUPIED: 'warning',
  MAINTENANCE: 'danger',
  RESERVED: 'info',
};

const cleanStatusMap: Record<string, string> = {
  CLEAN: '已清洁',
  NEEDS_CLEANING: '待清洁',
  IN_CLEANING: '清洁中',
};

const cleanStatusTypeMap: Record<string, any> = {
  CLEAN: 'success',
  NEEDS_CLEANING: 'warning',
  IN_CLEANING: 'info',
};

const fetchData = async () => {
  loading.value = true;
  try {
    const params = {
      page: pagination.page,
      limit: pagination.limit,
      ...queryForm,
    };
    const response = await getRooms(params);
    tableData.value = response.data;
    pagination.total = response.meta.total;
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

const handleReset = () => {
  queryForm.roomNumber = '';
  queryForm.status = '';
  handleQuery();
};

const handleCreate = () => {
  dialogTitle.value = '新增房源';
  currentEditId.value = '';
  dialogVisible.value = true;
};

const handleEdit = (row: Room) => {
  dialogTitle.value = '编辑房源';
  currentEditId.value = row.id;
  Object.assign(formData, {
    buildingId: row.buildingId,
    roomNumber: row.roomNumber,
    floor: row.floor,
    roomType: row.roomType,
    area: row.area,
    monthlyRent: row.monthlyRent / 100,
    deposit: row.deposit / 100,
    facilities: row.facilities || [],
  });
  dialogVisible.value = true;
};

const handleDelete = async (row: Room) => {
  try {
    await ElMessageBox.confirm('确定要删除这个房源吗？', '提示', {
      type: 'warning',
    });
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
      const data: any = {
        ...formData,
        monthlyRent: Math.round(formData.monthlyRent * 100),
        deposit: Math.round(formData.deposit * 100),
      };

      if (currentEditId.value) {
        await updateRoom(currentEditId.value, data);
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
    monthlyRent: 0,
    deposit: 0,
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
</style>
