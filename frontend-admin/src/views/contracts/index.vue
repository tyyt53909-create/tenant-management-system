<template>
  <div class="contracts-page">
    <el-card>
      <el-form :inline="true" :model="queryForm">
        <el-form-item label="合同编号">
          <el-input v-model="queryForm.contractNumber" placeholder="请输入合同编号" clearable />
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="queryForm.status" placeholder="请选择状态" clearable>
            <el-option label="草稿" value="DRAFT" />
            <el-option label="生效中" value="ACTIVE" />
            <el-option label="已过期" value="EXPIRED" />
            <el-option label="已终止" value="TERMINATED" />
            <el-option label="已续签" value="RENEWED" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="handleQuery">查询</el-button>
          <el-button @click="handleReset">重置</el-button>
          <el-button type="primary" @click="handleCreate">新增合同</el-button>
        </el-form-item>
      </el-form>

      <el-table :data="tableData" v-loading="loading" border stripe>
        <el-table-column prop="contractNumber" label="合同编号" width="180" />
        <el-table-column prop="startDate" label="开始日期" width="120">
          <template #default="{ row }">
            {{ row.startDate.split('T')[0] }}
          </template>
        </el-table-column>
        <el-table-column prop="endDate" label="结束日期" width="120">
          <template #default="{ row }">
            {{ row.endDate.split('T')[0] }}
          </template>
        </el-table-column>
        <el-table-column prop="rentAmount" label="租金" width="120">
          <template #default="{ row }">
            ¥{{ (row.rentAmount / 100).toFixed(2) }}
          </template>
        </el-table-column>
        <el-table-column prop="depositAmount" label="押金" width="120">
          <template #default="{ row }">
            ¥{{ (row.depositAmount / 100).toFixed(2) }}
          </template>
        </el-table-column>
        <el-table-column prop="paymentCycle" label="付款周期" width="100">
          <template #default="{ row }">
            {{ paymentCycleMap[row.paymentCycle] }}
          </template>
        </el-table-column>
        <el-table-column prop="status" label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="statusTypeMap[row.status]">
              {{ statusMap[row.status] }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="续签" width="110">
          <template #default="{ row }">
            <el-tag v-if="row.renewedFromId" type="info" size="small">已续签他人</el-tag>
            <el-tag v-else-if="row.status === 'RENEWED'" type="info" size="small">已续签</el-tag>
            <span v-else class="muted">—</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="240" fixed="right">
          <template #default="{ row }">
            <el-button
              type="success"
              link
              :disabled="!canRenew(row)"
              :title="canRenew(row) ? '基于本合同生成续签草稿' : '仅生效中或已过期的合同可续签'"
              @click="handleRenew(row)"
            >续签</el-button>
            <el-button type="primary" link @click="handleEdit(row)">编辑</el-button>
            <el-button type="danger" link @click="handleDelete(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>

      <div style="margin-top: 20px; text-align: right">
        <el-pagination
          v-model:current-page="pagination.page"
          v-model:page-size="pagination.limit"
          :total="pagination.total"
          layout="total, prev, pager, next"
          @current-change="handleQuery"
        />
      </div>
    </el-card>

    <el-dialog v-model="dialogVisible" :title="dialogTitle" width="600px">
      <el-form ref="formRef" :model="formData" :rules="rules" label-width="100px">
        <el-form-item label="楼栋ID" prop="buildingId">
          <el-input v-model="formData.buildingId" placeholder="building-001" />
        </el-form-item>
        <el-form-item label="房间ID" prop="roomId">
          <el-input v-model="formData.roomId" placeholder="请输入房间ID" />
        </el-form-item>
        <el-form-item label="租客ID" prop="tenantId">
          <el-input v-model="formData.tenantId" placeholder="请输入租客ID" />
        </el-form-item>
        <el-form-item label="开始日期" prop="startDate">
          <el-date-picker v-model="formData.startDate" type="date" placeholder="选择日期" value-format="YYYY-MM-DD" />
        </el-form-item>
        <el-form-item label="结束日期" prop="endDate">
          <el-date-picker v-model="formData.endDate" type="date" placeholder="选择日期" value-format="YYYY-MM-DD" />
        </el-form-item>
        <el-form-item label="租金(元)" prop="rentAmount">
          <el-input-number v-model="formData.rentAmount" :min="0" :precision="2" />
        </el-form-item>
        <el-form-item label="押金(元)" prop="depositAmount">
          <el-input-number v-model="formData.depositAmount" :min="0" :precision="2" />
        </el-form-item>
        <el-form-item label="付款周期" prop="paymentCycle">
          <el-select v-model="formData.paymentCycle">
            <el-option label="月付" value="MONTHLY" />
            <el-option label="季付" value="QUARTERLY" />
            <el-option label="半年付" value="SEMI_ANNUAL" />
            <el-option label="年付" value="ANNUAL" />
          </el-select>
        </el-form-item>
        <el-form-item label="付款日" prop="paymentDay">
          <el-input-number v-model="formData.paymentDay" :min="1" :max="28" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitLoading" @click="handleSubmit">确定</el-button>
      </template>
    </el-dialog>

    <!-- 续签（T154）：复制原合同生成续签草稿，保留全部历史 -->
    <el-dialog v-model="renewVisible" title="合同续签" width="620px">
      <el-alert
        v-if="renewSource"
        type="info"
        :closable="false"
        show-icon
        style="margin-bottom: 16px"
      >
        <template #title>
          原合同 {{ renewSource.contractNumber }}（{{ renewSource.startDate.split('T')[0] }} ~
          {{ renewSource.endDate.split('T')[0] }}）
        </template>
        <div style="margin-top: 6px; line-height: 1.7">
          原租金 ¥{{ (renewSource.rentAmount / 100).toFixed(2) }} · 原押金 ¥{{
            (renewSource.depositAmount / 100).toFixed(2)
          }}<br />
          续签将新建一份<b>草稿</b>合同并关联本份合同，原合同记录完整保留。
        </div>
      </el-alert>

      <el-form ref="renewFormRef" :model="renewForm" :rules="renewRules" label-width="110px">
        <el-form-item label="新起始日" prop="startDate">
          <el-date-picker
            v-model="renewForm.startDate"
            type="date"
            placeholder="默认取原到期日次日"
            value-format="YYYY-MM-DD"
          />
        </el-form-item>
        <el-form-item label="新到期日" prop="endDate">
          <el-date-picker
            v-model="renewForm.endDate"
            type="date"
            placeholder="必填"
            value-format="YYYY-MM-DD"
          />
        </el-form-item>
        <el-form-item label="新租金(元)" prop="rentAmount">
          <el-input-number v-model="renewForm.rentAmount" :min="0" :precision="2" />
          <span class="hint">默认沿用原租金</span>
        </el-form-item>
        <el-form-item label="新押金(元)" prop="depositAmount">
          <el-input-number v-model="renewForm.depositAmount" :min="0" :precision="2" />
          <span class="hint">默认沿用原押金</span>
        </el-form-item>
        <el-form-item label="付款周期" prop="paymentCycle">
          <el-select v-model="renewForm.paymentCycle">
            <el-option label="月付" value="MONTHLY" />
            <el-option label="季付" value="QUARTERLY" />
            <el-option label="半年付" value="SEMI_ANNUAL" />
            <el-option label="年付" value="ANNUAL" />
          </el-select>
        </el-form-item>
        <el-form-item label="付款日" prop="paymentDay">
          <el-input-number v-model="renewForm.paymentDay" :min="1" :max="31" />
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="renewVisible = false">取消</el-button>
        <el-button type="primary" :loading="renewLoading" @click="handleRenewSubmit">
          生成续签草稿
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import type { FormInstance } from 'element-plus';
import {
  getContracts,
  createContract,
  updateContract,
  deleteContract,
  renewContract,
} from '@/api/contracts';
import type { Contract } from '@/types';

const loading = ref(false);
const submitLoading = ref(false);
const dialogVisible = ref(false);
const dialogTitle = ref('新增合同');
const formRef = ref<FormInstance>();
const tableData = ref<Contract[]>([]);
const currentEditId = ref('');

const queryForm = reactive({ contractNumber: '', status: '' });
const pagination = reactive({ page: 1, limit: 20, total: 0 });
const formData = reactive({
  buildingId: 'building-001',
  roomId: '',
  tenantId: '',
  startDate: '',
  endDate: '',
  rentAmount: 0,
  depositAmount: 0,
  paymentCycle: 'MONTHLY',
  paymentDay: 1,
});

const rules = {
  buildingId: [{ required: true, message: '请输入楼栋ID', trigger: 'blur' }],
  roomId: [{ required: true, message: '请输入房间ID', trigger: 'blur' }],
  tenantId: [{ required: true, message: '请输入租客ID', trigger: 'blur' }],
  startDate: [{ required: true, message: '请选择开始日期', trigger: 'change' }],
  endDate: [{ required: true, message: '请选择结束日期', trigger: 'change' }],
  rentAmount: [{ required: true, message: '请输入租金', trigger: 'blur' }],
  depositAmount: [{ required: true, message: '请输入押金', trigger: 'blur' }],
};

const paymentCycleMap: Record<string, string> = {
  MONTHLY: '月付',
  QUARTERLY: '季付',
  SEMI_ANNUAL: '半年付',
  ANNUAL: '年付',
};

const statusMap: Record<string, string> = {
  DRAFT: '草稿',
  ACTIVE: '生效中',
  EXPIRED: '已过期',
  TERMINATED: '已终止',
  RENEWED: '已续签',
};

const statusTypeMap: Record<string, any> = {
  DRAFT: 'info',
  ACTIVE: 'success',
  EXPIRED: 'warning',
  TERMINATED: 'danger',
  RENEWED: 'info',
};

/** 续签可用性：已终止 / 已被续签的合同不可再续（后端亦会 400/409 拦截） */
const canRenew = (row: Contract) =>
  !row.renewedFromId && row.status !== 'RENEWED' && row.status !== 'TERMINATED';

const fetchData = async () => {
  loading.value = true;
  try {
    const response = await getContracts({ page: pagination.page, limit: pagination.limit, ...queryForm });
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
  queryForm.contractNumber = '';
  queryForm.status = '';
  handleQuery();
};

const handleCreate = () => {
  dialogTitle.value = '新增合同';
  currentEditId.value = '';
  dialogVisible.value = true;
};

const handleEdit = (row: Contract) => {
  dialogTitle.value = '编辑合同';
  currentEditId.value = row.id;
  Object.assign(formData, {
    buildingId: row.buildingId,
    roomId: row.roomId,
    tenantId: row.tenantId,
    startDate: row.startDate.split('T')[0],
    endDate: row.endDate.split('T')[0],
    rentAmount: row.rentAmount / 100,
    depositAmount: row.depositAmount / 100,
    paymentCycle: row.paymentCycle,
    paymentDay: row.paymentDay,
  });
  dialogVisible.value = true;
};

const handleDelete = async (row: Contract) => {
  try {
    await ElMessageBox.confirm('确定要删除吗？', '提示', { type: 'warning' });
    await deleteContract(row.id);
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
      const data: any = {
        ...formData,
        rentAmount: Math.round(formData.rentAmount * 100),
        depositAmount: Math.round(formData.depositAmount * 100),
      };
      if (currentEditId.value) {
        await updateContract(currentEditId.value, data);
        ElMessage.success('更新成功');
      } else {
        await createContract(data);
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

/* ---------------- 续签（T154） ---------------- */
const renewVisible = ref(false);
const renewLoading = ref(false);
const renewFormRef = ref<FormInstance>();
const renewSource = ref<Contract | null>(null);
const renewForm = reactive({
  startDate: '',
  endDate: '',
  rentAmount: 0,
  depositAmount: 0,
  paymentCycle: 'MONTHLY' as Contract['paymentCycle'],
  paymentDay: 1,
});

const renewRules = {
  endDate: [{ required: true, message: '请选择新到期日', trigger: 'change' }],
};

/** 原到期日次日（YYYY-MM-DD） */
const dayAfter = (dateStr: string) => {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
};

const handleRenew = (row: Contract) => {
  renewSource.value = row;
  renewForm.startDate = dayAfter(row.endDate);
  // 默认续一年，便于管理者微调
  const end = new Date(renewForm.startDate);
  end.setFullYear(end.getFullYear() + 1);
  end.setDate(end.getDate() - 1);
  renewForm.endDate = end.toISOString().slice(0, 10);
  renewForm.rentAmount = row.rentAmount / 100;
  renewForm.depositAmount = row.depositAmount / 100;
  renewForm.paymentCycle = row.paymentCycle;
  renewForm.paymentDay = row.paymentDay;
  renewVisible.value = true;
};

const handleRenewSubmit = async () => {
  if (!renewFormRef.value || !renewSource.value) return;

  // 前端先拦一次日期顺序，避免无谓请求（后端亦会 400）
  if (renewForm.startDate && renewForm.endDate <= renewForm.startDate) {
    ElMessage.error('新到期日必须晚于起始日');
    return;
  }

  await renewFormRef.value.validate(async (valid) => {
    if (!valid) return;
    renewLoading.value = true;
    try {
      const created = await renewContract(renewSource.value!.id, {
        startDate: renewForm.startDate || undefined,
        endDate: renewForm.endDate,
        rentAmount: Math.round(renewForm.rentAmount * 100),
        depositAmount: Math.round(renewForm.depositAmount * 100),
        paymentCycle: renewForm.paymentCycle,
        paymentDay: renewForm.paymentDay,
      });
      ElMessage.success(`续签草稿已生成：${(created as any).contractNumber || ''}`);
      renewVisible.value = false;
      fetchData();
    } catch (error: any) {
      // 409（已续签）/ 400（已终止、日期非法）由拦截器统一提示
    } finally {
      renewLoading.value = false;
    }
  });
};

onMounted(fetchData);
</script>

<style scoped>
.contracts-page { padding: 0; }
.muted { color: #c0c4cc; }
.hint { margin-left: 8px; color: #909399; font-size: 12px; }
</style>
