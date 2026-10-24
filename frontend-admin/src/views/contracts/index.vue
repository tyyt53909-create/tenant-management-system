<template>
  <div class="contracts-page">
    <ManagementMetrics resource="contracts" />
    <ResourcePanel title="合同档案" :count="pagination.total" :loading="loading" :error="loadError" @retry="fetchData"><template #actions><ExportCurrent resource="contracts" :rows="tableData" /><el-button type="primary" @click="handleCreate">＋ 新增合同</el-button></template>
      <el-form :inline="true" :model="queryForm">
        <el-form-item label="合同编号">
          <el-input v-model="queryForm.contractNumber" placeholder="请输入合同编号" clearable @keyup.enter="handleQuery" />
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
        </el-form-item>
      </el-form>

      <el-table
        :data="tableData"
        v-loading="loading"
        @row-dblclick="openDetail"
        :row-class-name="({row}:any)=>detailVisible && row.id===detailId ? 'detail-selected-row' : ''"
        :empty-text="emptyText"
        :default-sort="{ prop: 'endDate', order: 'descending' }"
      >
        <el-table-column prop="contractNumber" label="合同 / 签约人" min-width="260" sortable>
          <template #default="{ row }">
            <button class="record-cell" @click="openDetail(row as Contract)">
              <span class="record-glyph"><el-icon><Document /></el-icon></span>
              <span>
                <strong :title="row.contractNumber">{{ row.contractNumber }}</strong>
                <small :title="`${row.room?.roomNumber || '未关联房源'} · ${row.tenant?.name || '未关联租客'}`">
                  {{ row.room?.roomNumber || '未关联房源' }} · {{ row.tenant?.name || '未关联租客' }}
                </small>
              </span>
            </button>
          </template>
        </el-table-column>

        <el-table-column prop="endDate" label="合同期限 / 付款" width="150" sortable>
          <template #default="{ row }">
            <div class="contract-term">
              <strong>{{ formatDateOnly(row.startDate) }}</strong>
              <small>至 {{ formatDateOnly(row.endDate) }} · {{ paymentCycleMap[row.paymentCycle] }}</small>
            </div>
          </template>
        </el-table-column>

        <el-table-column prop="rentAmount" sort-by="rentAmount" label="租金 / 押金" width="140" sortable>
          <template #default="{ row }">
            <div class="contract-money">
              <strong>{{ formatMoney(row.rentAmount) }}</strong>
              <small>押金 {{ formatMoney(row.depositAmount) }}</small>
            </div>
          </template>
        </el-table-column>

        <el-table-column prop="status" label="状态" width="150">
          <template #default="{ row }">
            <div class="contract-status">
              <el-tag :type="statusTypeMap[row.status]">{{ statusMap[row.status] }}</el-tag>
              <el-tooltip
                v-if="row.status === 'RENEWED' || row.renewedFromId"
                placement="top"
                :content="row.status === 'RENEWED' ? '本合同已被新合同替代，可用「续签」查看链路' : '本合同由上一份合同续签而来'"
              >
                <el-tag type="info" size="small" effect="plain">
                  {{ row.status === 'RENEWED' ? '已续签' : '续签而来' }}
                </el-tag>
              </el-tooltip>
            </div>
          </template>
        </el-table-column>

        <el-table-column label="操作" width="120" fixed="right">
          <template #default="{ row }">
            <div class="table-actions">
              <el-button class="table-action" @click="openDetail(row as Contract)">详情</el-button>
              <el-dropdown trigger="click" @command="handleContractCommand($event, row as Contract)">
                <el-button class="table-action table-action--icon" aria-label="更多合同操作">
                  <el-icon><MoreFilled /></el-icon>
                </el-button>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item command="renew" :disabled="!canRenew(row as Contract)">发起续签</el-dropdown-item>
                    <el-dropdown-item command="edit">编辑合同</el-dropdown-item>
                    <el-dropdown-item command="delete" divided style="color: var(--error-text)">删除合同</el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
            </div>
          </template>
        </el-table-column>
      </el-table>

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
    <PropertyDetailPanel ref="detailPanel" v-model="detailVisible" kind="contracts" :id="detailId" :can-renew="row=>canRenew(row as Contract)" @edit="handleEdit($event as any)" @renew="handleRenew($event as any)" />

    <el-dialog v-model="dialogVisible" :title="dialogTitle" width="600px">
      <el-form ref="formRef" :model="formData" :rules="rules" label-width="100px">
        <el-form-item label="楼栋" prop="buildingId">
          <EntitySelect v-model="formData.buildingId" resource="buildings" />
        </el-form-item>
        <el-form-item label="房源" prop="roomId">
          <EntitySelect v-model="formData.roomId" resource="rooms" @selected="row => {if(row) formData.buildingId=row.buildingId}" />
        </el-form-item>
        <el-form-item label="租客" prop="tenantId">
          <EntitySelect v-model="formData.tenantId" resource="tenants" />
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
          原租金 {{ formatMoney(renewSource.rentAmount) }} · 原押金 {{ formatMoney(renewSource.depositAmount) }}<br />
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
import { ref, reactive, computed, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { formatDateOnly } from '@/utils/table';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Document, MoreFilled } from '@element-plus/icons-vue';
import ResourcePanel from '@/components/common/ResourcePanel.vue';
import ManagementMetrics from '@/components/common/ManagementMetrics.vue';
import ExportCurrent from '@/components/common/ExportCurrent.vue';
import PropertyDetailPanel from '@/components/common/PropertyDetailPanel.vue';
import EntitySelect from '@/components/common/EntitySelect.vue';
import type { FormInstance } from 'element-plus';
import {
  getContracts,
  createContract,
  updateContract,
  deleteContract,
  renewContract,
} from '@/api/contracts';
import type { Contract } from '@/types';
import { centsToYuan, formatMoney } from '@/utils/money';

const loading = ref(false);
const loadError=ref('');const detailVisible=ref(false);const detailId=ref('');
const detailPanel=ref<InstanceType<typeof PropertyDetailPanel>>();
const route=useRoute();
const router=useRouter();
function openDetail(row:{id:string}){detailId.value=row.id;detailVisible.value=true;if(route.query.detail!==row.id)void router.replace({query:{...route.query,detail:row.id}});}
const submitLoading = ref(false);
const dialogVisible = ref(false);
const dialogTitle = ref('新增合同');
const formRef = ref<FormInstance>();
const tableData = ref<Contract[]>([]);
const currentEditId = ref('');

const queryForm = reactive({ contractNumber: '', status: '' });

/** 区分「系统暂无数据」与「筛选无结果」 */
const emptyText = computed(() =>
  queryForm.contractNumber || queryForm.status
    ? '没有符合条件的合同，试试调整合同编号或状态'
    : '暂无合同，点击右上角「新增合同」开始录入',
);
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
  buildingId: [{ required: true, message: '请选择楼栋', trigger: 'change' }],
  roomId: [{ required: true, message: '请选择房源', trigger: 'change' }],
  tenantId: [{ required: true, message: '请选择租客', trigger: 'change' }],
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
  loadError.value='';
  try {
    const response = await getContracts({ page: pagination.page, limit: pagination.limit, ...queryForm });
    // 派生「仅日期」字段用于排序（与表头显示值一致）
    tableData.value = (response.data as Contract[]).map((c) => ({
      ...c,
      startDateOnly: c.startDate ? String(c.startDate).split('T')[0] : '',
      endDateOnly: c.endDate ? String(c.endDate).split('T')[0] : '',
    })) as Contract[];
    pagination.total = response.meta.total;
  } catch (error) {
    loadError.value='合同列表未能更新，请检查连接后重试。';
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
  Object.assign(formData,{buildingId:'',roomId:'',tenantId:'',startDate:'',endDate:'',rentAmount:0,depositAmount:0,paymentCycle:'MONTHLY',paymentDay:1});
  formRef.value?.clearValidate();
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
    rentAmount: centsToYuan(row.rentAmount),
    depositAmount: centsToYuan(row.depositAmount),
    paymentCycle: row.paymentCycle,
    paymentDay: row.paymentDay,
  });
  dialogVisible.value = true;
};

const handleDelete = async (row: Contract) => {
  try {
    await ElMessageBox.confirm(
      `确定删除合同「${row.contractNumber || row.id}」吗？删除后不可恢复。`,
      '删除合同',
      { type: 'warning', confirmButtonText: '确定删除', cancelButtonText: '取消' },
    );
    await deleteContract(row.id);
    ElMessage.success('删除成功');
    fetchData();
  } catch (error: any) {
    if (error !== 'cancel') ElMessage.error('删除失败');
  }
};

function handleContractCommand(command: string, row: Contract) {
  if (command === 'renew') handleRenew(row);
  else if (command === 'edit') handleEdit(row);
  else if (command === 'delete') void handleDelete(row);
}

const handleSubmit = async () => {
  if (!formRef.value) return;
  await formRef.value.validate(async (valid) => {
    if (!valid) return;
    if(submitLoading.value)return;
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
      void detailPanel.value?.reload();
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
  renewForm.rentAmount = centsToYuan(row.rentAmount);
  renewForm.depositAmount = centsToYuan(row.depositAmount);
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
      void detailPanel.value?.reload();
    } catch (error: any) {
      // 409（已续签）/ 400（已终止、日期非法）由拦截器统一提示
    } finally {
      renewLoading.value = false;
    }
  });
};

onMounted(()=>{void fetchData();if(typeof route.query.detail==='string')openDetail({id:route.query.detail});});
watch(()=>route.query.detail,id=>{if(typeof id==='string')openDetail({id});else detailVisible.value=false;});
watch(detailVisible,open=>{if(!open&&route.query.detail===detailId.value)void router.replace({query:{...route.query,detail:undefined}});});
</script>

<style scoped>
.contracts-page { padding: 0; }
.muted { color: var(--text-muted); }
.hint { margin-left: 8px; color: var(--text-muted); font-size: 12px; }

.contract-term strong,
.contract-money strong {
  display: block;
  color: var(--text-primary);
  font-size: 12px;
  font-weight: 650;
  line-height: 1.4;
}
.contract-term small,
.contract-money small {
  display: block;
  margin-top: 4px;
  overflow: hidden;
  color: var(--text-muted);
  font-size: var(--font-micro);
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.contract-status {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
}
.contract-status :deep(.el-tag) {
  height: 18px;
  padding: 0 5px;
  font-size: var(--font-micro);
}
</style>
