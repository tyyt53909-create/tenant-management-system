<template>
  <div class="bills-page">
    <el-card>
      <el-form :inline="true" :model="queryForm">
        <el-form-item label="状态">
          <el-select v-model="queryForm.status" placeholder="请选择状态" clearable>
            <el-option label="待支付" value="PENDING" />
            <el-option label="部分支付" value="PARTIAL" />
            <el-option label="已支付" value="PAID" />
            <el-option label="已逾期" value="OVERDUE" />
            <el-option label="已取消" value="CANCELLED" />
          </el-select>
        </el-form-item>
        <el-form-item label="类型">
          <el-select v-model="queryForm.billType" placeholder="请选择类型" clearable>
            <el-option label="租金" value="RENT" />
            <el-option label="水电费" value="UTILITY" />
            <el-option label="其他" value="OTHER" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="handleQuery">查询</el-button>
          <el-button @click="handleReset">重置</el-button>
          <el-button type="primary" @click="handleCreate">新增账单</el-button>
        </el-form-item>
      </el-form>

      <el-table :data="tableData" v-loading="loading" border stripe>
        <el-table-column prop="billNumber" label="账单编号" width="180" />
        <el-table-column prop="billType" label="类型" width="100">
          <template #default="{ row }">
            <el-tag>{{ billTypeMap[row.billType] }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="period" label="账期" width="120" />
        <el-table-column prop="amount" label="应付金额" width="120">
          <template #default="{ row }">
            ¥{{ (row.amount / 100).toFixed(2) }}
          </template>
        </el-table-column>
        <el-table-column prop="paidAmount" label="已付金额" width="120">
          <template #default="{ row }">
            ¥{{ (row.paidAmount / 100).toFixed(2) }}
          </template>
        </el-table-column>
        <el-table-column prop="dueDate" label="到期日期" width="120">
          <template #default="{ row }">
            {{ row.dueDate.split('T')[0] }}
          </template>
        </el-table-column>
        <el-table-column prop="status" label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="statusTypeMap[row.status]">
              {{ statusMap[row.status] }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="240" fixed="right">
          <template #default="{ row }">
            <el-button type="success" link :disabled="!canReceive(row)" @click="handlePayment(row)">收款</el-button>
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

    <el-dialog v-model="dialogVisible" :title="dialogTitle" width="500px">
      <el-form ref="formRef" :model="formData" :rules="rules" label-width="100px">
        <el-form-item label="合同ID" prop="contractId">
          <el-input v-model="formData.contractId" placeholder="请输入合同ID" />
        </el-form-item>
        <el-form-item label="账单类型" prop="billType">
          <el-select v-model="formData.billType">
            <el-option label="租金" value="RENT" />
            <el-option label="水电费" value="UTILITY" />
            <el-option label="其他" value="OTHER" />
          </el-select>
        </el-form-item>
        <el-form-item label="账期" prop="period">
          <el-input v-model="formData.period" placeholder="例如：2026-01" />
        </el-form-item>
        <el-form-item label="金额(元)" prop="amount">
          <el-input-number v-model="formData.amount" :min="0" :precision="2" />
        </el-form-item>
        <el-form-item label="到期日期" prop="dueDate">
          <el-date-picker v-model="formData.dueDate" type="date" placeholder="选择日期" value-format="YYYY-MM-DD" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitLoading" @click="handleSubmit">确定</el-button>
      </template>
    </el-dialog>

    <!-- 收款登记对话框 -->
    <el-dialog v-model="paymentDialogVisible" title="登记收款" width="600px">
      <el-descriptions :column="3" border size="small" style="margin-bottom: 16px">
        <el-descriptions-item label="账单编号">{{ currentBill?.billNumber }}</el-descriptions-item>
        <el-descriptions-item label="应付金额">
          ¥{{ ((currentBill?.amount || 0) / 100).toFixed(2) }}
        </el-descriptions-item>
        <el-descriptions-item label="未缴金额">
          ¥{{ (((currentBill?.amount || 0) - (currentBill?.paidAmount || 0)) / 100).toFixed(2) }}
        </el-descriptions-item>
      </el-descriptions>

      <el-form ref="paymentFormRef" :model="paymentForm" :rules="paymentRules" label-width="90px">
        <el-form-item label="收款金额" prop="amount">
          <el-input-number
            v-model="paymentForm.amount"
            :min="0.01"
            :max="remainingYuan"
            :precision="2"
            :step="100"
          />
          <span class="payment-hint">元（最多可收 ¥{{ remainingYuan.toFixed(2) }}）</span>
        </el-form-item>
        <el-form-item label="收款方式" prop="paymentMethod">
          <el-select v-model="paymentForm.paymentMethod">
            <el-option
              v-for="(label, value) in paymentMethodMap"
              :key="value"
              :label="label"
              :value="value"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="交易号">
          <el-input v-model="paymentForm.transactionNumber" placeholder="选填；同一账单内不可重复" />
        </el-form-item>
        <el-form-item label="收款时间">
          <el-date-picker
            v-model="paymentForm.paidAt"
            type="datetime"
            placeholder="缺省为当前时间"
            value-format="YYYY-MM-DDTHH:mm:ss"
          />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="paymentForm.notes" placeholder="选填" />
        </el-form-item>
      </el-form>

      <el-divider content-position="left">收款记录</el-divider>
      <el-table :data="paymentRecords" size="small" v-loading="paymentLoading" border>
        <el-table-column label="收款时间" width="160">
          <template #default="{ row }">{{ formatDateTime(row.paidAt) }}</template>
        </el-table-column>
        <el-table-column label="金额" width="100">
          <template #default="{ row }">¥{{ (row.amount / 100).toFixed(2) }}</template>
        </el-table-column>
        <el-table-column label="方式" width="90">
          <template #default="{ row }">{{ paymentMethodMap[row.paymentMethod] || row.paymentMethod }}</template>
        </el-table-column>
        <el-table-column prop="transactionNumber" label="交易号" show-overflow-tooltip />
      </el-table>

      <template #footer>
        <el-button @click="paymentDialogVisible = false">关闭</el-button>
        <el-button
          type="primary"
          :loading="paymentSubmitLoading"
          :disabled="!currentBill || !canReceive(currentBill)"
          @click="handlePaymentSubmit"
        >
          确认收款
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import type { FormInstance } from 'element-plus';
import { getBills, createBill, updateBill, deleteBill, getPayments, addPayment } from '@/api/bills';
import type { PaymentRecordItem, PaymentMethod } from '@/api/bills';
import type { Bill } from '@/types';

const loading = ref(false);
const submitLoading = ref(false);
const dialogVisible = ref(false);
const dialogTitle = ref('新增账单');
const formRef = ref<FormInstance>();
const tableData = ref<Bill[]>([]);
const currentEditId = ref('');

// ── 收款登记（T135）──
const paymentDialogVisible = ref(false);
const paymentLoading = ref(false);
const paymentSubmitLoading = ref(false);
const paymentFormRef = ref<FormInstance>();
const paymentRecords = ref<PaymentRecordItem[]>([]);
const currentBill = ref<Bill | null>(null);

const paymentForm = reactive({
  amount: 0,
  paymentMethod: 'CASH' as PaymentMethod,
  transactionNumber: '',
  paidAt: '',
  notes: '',
});

const paymentRules = {
  amount: [{ required: true, message: '请输入收款金额', trigger: 'blur' }],
  paymentMethod: [{ required: true, message: '请选择收款方式', trigger: 'change' }],
};

const queryForm = reactive({ status: '', billType: '' });
const pagination = reactive({ page: 1, limit: 20, total: 0 });
const formData = reactive({
  contractId: '',
  billType: 'RENT',
  period: '',
  amount: 0,
  dueDate: '',
});

const rules = {
  contractId: [{ required: true, message: '请输入合同ID', trigger: 'blur' }],
  billType: [{ required: true, message: '请选择账单类型', trigger: 'change' }],
  period: [{ required: true, message: '请输入账期', trigger: 'blur' }],
  amount: [{ required: true, message: '请输入金额', trigger: 'blur' }],
  dueDate: [{ required: true, message: '请选择到期日期', trigger: 'change' }],
};

const billTypeMap: Record<string, string> = {
  RENT: '租金',
  UTILITY: '水电费',
  OTHER: '其他',
};

const statusMap: Record<string, string> = {
  PENDING: '待支付',
  PARTIAL: '部分支付',
  PAID: '已支付',
  OVERDUE: '已逾期',
  CANCELLED: '已取消',
};

const statusTypeMap: Record<string, any> = {
  PENDING: 'warning',
  PARTIAL: 'info',
  PAID: 'success',
  OVERDUE: 'danger',
  CANCELLED: '',
};

const paymentMethodMap: Record<string, string> = {
  CASH: '现金',
  BANK_TRANSFER: '银行转账',
  WECHAT: '微信',
  ALIPAY: '支付宝',
  OTHER: '其他',
};

// 剩余未缴金额（元）
const remainingYuan = computed(() => {
  if (!currentBill.value) return 0;
  return Math.max(0, (currentBill.value.amount - currentBill.value.paidAmount) / 100);
});

// 仅 PENDING / PARTIAL / OVERDUE 可收款（docs/04-状态机.md）
const canReceive = (bill: Bill | null) =>
  !!bill && ['PENDING', 'PARTIAL', 'OVERDUE'].includes(bill.status);

const fetchData = async () => {
  loading.value = true;
  try {
    const response = await getBills({ page: pagination.page, limit: pagination.limit, ...queryForm });
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
  queryForm.status = '';
  queryForm.billType = '';
  handleQuery();
};

const handleCreate = () => {
  dialogTitle.value = '新增账单';
  currentEditId.value = '';
  dialogVisible.value = true;
};

const handleEdit = (row: Bill) => {
  dialogTitle.value = '编辑账单';
  currentEditId.value = row.id;
  Object.assign(formData, {
    contractId: row.contractId,
    billType: row.billType,
    period: row.period,
    amount: row.amount / 100,
    dueDate: row.dueDate.split('T')[0],
  });
  dialogVisible.value = true;
};

const handleDelete = async (row: Bill) => {
  try {
    await ElMessageBox.confirm('确定要删除吗？', '提示', { type: 'warning' });
    await deleteBill(row.id);
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
        amount: Math.round(formData.amount * 100),
      };
      if (currentEditId.value) {
        await updateBill(currentEditId.value, data);
        ElMessage.success('更新成功');
      } else {
        await createBill(data);
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

// ── 收款登记（T135）──

const handlePayment = async (row: Bill) => {
  currentBill.value = row;
  paymentForm.amount = Math.max(0.01, (row.amount - row.paidAmount) / 100);
  paymentForm.paymentMethod = 'CASH';
  paymentForm.transactionNumber = '';
  paymentForm.paidAt = '';
  paymentForm.notes = '';
  paymentRecords.value = [];
  paymentDialogVisible.value = true;
  await loadPayments();
};

const loadPayments = async () => {
  if (!currentBill.value) return;
  paymentLoading.value = true;
  try {
    paymentRecords.value = await getPayments(currentBill.value.id);
  } catch {
    // 请求拦截器已弹出错误提示
  } finally {
    paymentLoading.value = false;
  }
};

const handlePaymentSubmit = async () => {
  const bill = currentBill.value;
  if (!paymentFormRef.value || !bill) return;
  await paymentFormRef.value.validate(async (valid) => {
    if (!valid) return;
    paymentSubmitLoading.value = true;
    try {
      await addPayment(bill.id, {
        amount: Math.round(paymentForm.amount * 100),
        paymentMethod: paymentForm.paymentMethod,
        transactionNumber: paymentForm.transactionNumber || undefined,
        paidAt: paymentForm.paidAt || undefined,
        notes: paymentForm.notes || undefined,
      });
      ElMessage.success('收款登记成功');
      await fetchData();
      const latest = tableData.value.find((item) => item.id === bill.id);
      if (latest) currentBill.value = latest;
      await loadPayments();
      paymentForm.amount = Math.max(0.01, remainingYuan.value);
    } catch {
      // 请求拦截器已弹出错误提示（含超额、交易号重复等业务信息）
    } finally {
      paymentSubmitLoading.value = false;
    }
  });
};

const formatDateTime = (value: string) => (value ? value.replace('T', ' ').slice(0, 19) : '-');

onMounted(fetchData);
</script>

<style scoped>
.bills-page { padding: 0; }

.payment-hint {
  margin-left: 8px;
  color: #909399;
  font-size: 12px;
}
</style>
