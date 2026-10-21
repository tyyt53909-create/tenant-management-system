<template>
  <div class="buildings-page">
    <ResourcePanel title="楼栋管理" description="维护楼栋档案与租客端联系卡片信息" :count="pagination.total" :loading="loading" :error="loadError || undefined" @retry="fetchData">
      <template #actions><el-button @click="router.push('/space')">空间模型</el-button><el-button type="primary" @click="handleCreate">新增楼栋</el-button></template>
      <el-table :data="tableData" v-loading="loading" :empty-text="emptyText">
        <el-table-column prop="name" label="楼栋 / 地址" min-width="240" sortable>
          <template #default="{ row }">
            <div class="building-identity">
              <strong :title="row.name">{{ row.name }}</strong>
              <small :title="row.address || '未填写地址'">{{ row.address || '未填写地址' }}</small>
            </div>
          </template>
        </el-table-column>

        <el-table-column label="楼层 / 状态" width="110">
          <template #default="{ row }">
            <div class="building-state">
              <strong>{{ row.floors || row.totalFloors || '-' }} 层</strong>
              <el-tag :type="row.isActive ? 'success' : 'danger'" size="small">
                {{ row.isActive ? '启用' : '停用' }}
              </el-tag>
            </div>
          </template>
        </el-table-column>

        <el-table-column label="管家 / 房东联系" min-width="200">
          <template #default="{ row }">
            <div class="building-contact">
              <template v-if="row.metadata?.landlordName || row.metadata?.landlordPhone">
                <strong>{{ row.metadata.landlordName || '专属管家' }}</strong>
                <small>{{ row.metadata.landlordPhone || '未登记电话' }}</small>
                <small v-if="row.metadata?.landlordWechat" :title="row.metadata.landlordWechat">微信 {{ row.metadata.landlordWechat }}</small>
              </template>
              <span v-else class="building-empty">默认管家服务</span>
            </div>
          </template>
        </el-table-column>

        <el-table-column prop="createdAt" label="创建时间" width="150">
          <template #default="{ row }">
            {{ new Date(row.createdAt).toLocaleString('zh-CN') }}
          </template>
        </el-table-column>

        <el-table-column label="操作" width="120" fixed="right">
          <template #default="{ row }">
            <div class="table-actions">
              <el-button class="table-action" @click="handleEdit(row)">编辑</el-button>
              <el-button class="table-action table-action--danger" @click="handleDelete(row as Building)">删除</el-button>
            </div>
          </template>
        </el-table-column>
      </el-table>

      <div>
        <el-pagination
          v-model:current-page="pagination.page"
          v-model:page-size="pagination.limit"
          :total="pagination.total"
          layout="total, prev, pager, next"
          @current-change="fetchData"
        />
      </div>
    </ResourcePanel>

    <el-dialog v-model="dialogVisible" :title="dialogTitle" width="560px">
      <el-form ref="formRef" :model="formData" :rules="rules" label-width="110px">
        <el-form-item label="楼栋名称" prop="name">
          <el-input v-model="formData.name" placeholder="请输入楼栋名称" />
        </el-form-item>
        <el-form-item label="地址" prop="address">
          <el-input v-model="formData.address" placeholder="请输入地址" />
        </el-form-item>
        <el-form-item label="总楼层" prop="totalFloors">
          <el-input-number v-model="formData.totalFloors" :min="1" />
        </el-form-item>
        <el-form-item label="状态" prop="isActive">
          <el-switch v-model="formData.isActive" />
        </el-form-item>

        <el-divider content-position="left">管家与房东联系信息（租客端联系卡片）</el-divider>
        <el-form-item label="管家/房东姓名">
          <el-input v-model="formData.landlordName" placeholder="例如：陈管家 / 李房东" />
        </el-form-item>
        <el-form-item label="联系电话">
          <el-input v-model="formData.landlordPhone" placeholder="例如：13800138000" />
        </el-form-item>
        <el-form-item label="微信号">
          <el-input v-model="formData.landlordWechat" placeholder="例如：qiju_service（租客可一键复制）" />
        </el-form-item>
        <el-form-item label="服务时间">
          <el-input v-model="formData.serviceHours" placeholder="例如：09:00 - 21:00" />
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
import { ref, reactive, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import type { FormInstance } from 'element-plus';
import { getBuildings, createBuilding, updateBuilding, deleteBuilding } from '@/api/buildings';
import type { Building } from '@/types';
import { usePagedTable } from '@/composables';
import ResourcePanel from '@/components/common/ResourcePanel.vue';

const router = useRouter();
const { loading, loadError, tableData, pagination, fetchData } = usePagedTable<Building>({
  fetchApi: (params) => getBuildings(params),
});
const emptyText = '暂无楼栋，点击右上角「新增楼栋」开始录入';

const submitLoading = ref(false);
const dialogVisible = ref(false);
const dialogTitle = ref('新增楼栋');
const formRef = ref<FormInstance>();
const currentEditId = ref('');

const formData = reactive({
  name: '',
  address: '',
  totalFloors: 1,
  isActive: true,
  landlordName: '',
  landlordPhone: '',
  landlordWechat: '',
  serviceHours: '',
});

const rules = {
  name: [{ required: true, message: '请输入楼栋名称', trigger: 'blur' }],
  address: [{ required: true, message: '请输入地址', trigger: 'blur' }],
  totalFloors: [{ required: true, message: '请输入总楼层', trigger: 'blur' }],
};

const handleCreate = () => {
  dialogTitle.value = '新增楼栋';
  currentEditId.value = '';
  Object.assign(formData, {
    name: '',
    address: '',
    totalFloors: 1,
    isActive: true,
    landlordName: '',
    landlordPhone: '',
    landlordWechat: '',
    serviceHours: '09:00 - 21:00',
  });
  dialogVisible.value = true;
};

const handleEdit = (row: any) => {
  dialogTitle.value = '编辑楼栋';
  currentEditId.value = row.id;
  const meta = row.metadata || {};
  Object.assign(formData, {
    name: row.name,
    address: row.address,
    totalFloors: row.floors || row.totalFloors || 1,
    isActive: row.isActive !== false,
    landlordName: meta.landlordName || '',
    landlordPhone: meta.landlordPhone || '',
    landlordWechat: meta.landlordWechat || '',
    serviceHours: meta.serviceHours || '09:00 - 21:00',
  });
  dialogVisible.value = true;
};

const handleDelete = async (row: Building) => {
  try {
    await ElMessageBox.confirm(
      `确定删除楼栋「${row.name || row.id}」吗？删除后不可恢复。\n若该楼栋下仍有房源，删除会被后端拒绝。`,
      '删除楼栋',
      { type: 'warning', confirmButtonText: '确定删除', cancelButtonText: '取消' },
    );
    await deleteBuilding(row.id);
    ElMessage.success('删除成功');
    fetchData();
  } catch (error: any) {
    if (error !== 'cancel') ElMessage.error('删除失败');
  }
};

const handleSubmit = async () => {
  if (!formRef.value) return;
  await formRef.value.validate(async (valid) => {
    if (!valid) return;
    submitLoading.value = true;
    try {
      const payload: any = {
        name: formData.name,
        address: formData.address,
        floors: Number(formData.totalFloors || 1),
        isActive: formData.isActive,
        metadata: {
          landlordName: formData.landlordName || '专属管家',
          landlordPhone: formData.landlordPhone || '13800138000',
          landlordWechat: formData.landlordWechat || 'qiju_service',
          serviceHours: formData.serviceHours || '09:00 - 21:00',
          notice: '紧急设施问题（漏水、断电、门锁等）请直接拨打电话，一般咨询可添加微信留言。',
        },
      };

      if (currentEditId.value) {
        await updateBuilding(currentEditId.value, payload);
        ElMessage.success('更新成功');
      } else {
        await createBuilding(payload);
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

onMounted(fetchData);
</script>

<style scoped>
.buildings-page { padding: 0; }

.building-identity strong,
.building-contact strong,
.building-state strong {
  display: block;
  overflow: hidden;
  color: var(--text-primary);
  font-size: 12px;
  font-weight: 650;
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.building-identity small,
.building-contact small {
  display: block;
  margin-top: 4px;
  overflow: hidden;
  color: var(--text-muted);
  font-size: var(--font-micro);
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.building-state {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 5px;
}
.building-state :deep(.el-tag) {
  height: 18px;
  padding: 0 5px;
  font-size: var(--font-micro);
}
.building-empty {
  color: var(--text-muted);
  font-size: var(--font-micro);
}
</style>
