<template>
  <div class="checkout-page">
    <el-card>
      <el-form :inline="true" :model="queryForm">
        <el-form-item label="状态">
          <el-select v-model="queryForm.status" placeholder="请选择状态" clearable>
            <el-option label="草稿" value="DRAFT" />
            <el-option label="待处理" value="PENDING" />
            <el-option label="已完成" value="COMPLETED" />
            <el-option label="已取消" value="CANCELLED" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="handleQuery">查询</el-button>
          <el-button @click="handleReset">重置</el-button>
          <el-button type="primary" @click="handleCreate">新增退租记录</el-button>
        </el-form-item>
      </el-form>

      <el-table
        ref="tableRef"
        :data="tableData"
        v-loading="loading"
        border
        stripe
        row-key="id"
        :empty-text="emptyText"
        @expand-change="handleExpandChange"
      >
        <!-- 展开行：查看该退租记录的结算明细（明细由详情接口返回） -->
        <el-table-column type="expand" width="46">
          <template #default="{ row }">
            <div class="items-panel" v-loading="!!detailLoading[row.id]">
              <div class="items-panel__inner">
                <template v-if="itemsOf(row).length">
                  <div class="items-panel__head">
                    <span>结算明细（{{ itemsOf(row).length }} 项）</span>
                    <span class="items-panel__sum">
                      退还合计
                      <b class="amount-refund">¥{{ formatMoney(refundTotalOf(row)) }}</b>
                      ｜扣除合计
                      <b class="amount-deduction">¥{{ formatMoney(deductionTotalOf(row)) }}</b>
                      ｜净额
                      <b>¥{{ formatMoney(refundTotalOf(row) - deductionTotalOf(row)) }}</b>
                    </span>
                  </div>
                  <el-table :data="itemsOf(row)" size="small" border>
                    <el-table-column label="类别" width="150">
                      <template #default="{ row: item }">
                        <el-tag
                          :type="itemTypeMeta(item.itemType).tagType"
                          :effect="isDeduction(item.itemType) ? 'dark' : 'light'"
                          size="small"
                        >
                          {{ itemTypeMeta(item.itemType).label }}
                        </el-tag>
                      </template>
                    </el-table-column>
                    <el-table-column prop="description" label="说明" min-width="260" show-overflow-tooltip />
                    <el-table-column label="金额" width="150" align="right">
                      <template #default="{ row: item }">
                        <span :class="{ 'amount-deduction': isDeduction(item.itemType) }">
                          {{ isDeduction(item.itemType) ? '-' : '+' }}¥{{ formatMoney(item.amount) }}
                        </span>
                      </template>
                    </el-table-column>
                  </el-table>
                </template>
                <el-empty v-else :image-size="50" description="该退租记录暂无结算明细" />
              </div>
            </div>
          </template>
        </el-table-column>

        <el-table-column prop="contractId" label="合同ID" width="180" show-overflow-tooltip />
        <el-table-column prop="roomId" label="房间ID" width="180" show-overflow-tooltip />
        <el-table-column prop="checkoutDate" label="退租日期" width="120">
          <template #default="{ row }">
            {{ row.checkoutDate.split('T')[0] }}
          </template>
        </el-table-column>
        <el-table-column prop="totalRefund" label="退款金额" width="120">
          <template #default="{ row }">
            ¥{{ (row.totalRefund / 100).toFixed(2) }}
          </template>
        </el-table-column>
        <el-table-column prop="status" label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="statusTypeMap[row.status]">
              {{ statusMap[row.status] }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="processedBy" label="处理人ID" width="180" show-overflow-tooltip />
        <el-table-column prop="notes" label="备注" min-width="180" show-overflow-tooltip />
        <el-table-column label="结算明细" width="100" align="center">
          <template #default="{ row }">
            <el-button type="primary" link @click="toggleDetail(row)">查看明细</el-button>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="140" fixed="right">
          <template #default="{ row }">
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
          @current-change="fetchData"
        />
      </div>
    </el-card>

    <el-dialog
      v-model="dialogVisible"
      :title="dialogTitle"
      width="920px"
      top="5vh"
      :close-on-click-modal="false"
    >
      <el-form ref="formRef" :model="formData" :rules="rules" label-width="110px">
        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="合同ID" prop="contractId">
              <el-input v-model="formData.contractId" placeholder="请输入合同ID" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="房间ID" prop="roomId">
              <el-input v-model="formData.roomId" placeholder="请输入房间ID" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="退租日期" prop="checkoutDate">
              <el-date-picker
                v-model="formData.checkoutDate"
                type="date"
                placeholder="选择日期"
                value-format="YYYY-MM-DD"
                style="width: 100%"
              />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="退款金额(元)" prop="totalRefund">
              <el-input-number
                v-model="formData.totalRefund"
                :min="0"
                :precision="2"
                :step="100"
                :controls="false"
                placeholder="0.00"
                style="width: 100%"
              />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="处理人ID" prop="processedBy">
              <el-input v-model="formData.processedBy" placeholder="默认为当前登录管理员" />
            </el-form-item>
          </el-col>
          <el-col v-if="currentEditId" :span="12">
            <el-form-item label="状态" prop="status">
              <el-select v-model="formData.status" style="width: 100%">
                <el-option label="草稿" value="DRAFT" />
                <el-option label="待处理" value="PENDING" />
                <el-option label="已完成" value="COMPLETED" />
                <el-option label="已取消" value="CANCELLED" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="24">
            <el-form-item label="备注" prop="notes">
              <el-input v-model="formData.notes" type="textarea" :rows="2" placeholder="请输入备注" />
            </el-form-item>
          </el-col>
        </el-row>

        <el-divider content-position="left">结算明细（押金扣除依据）</el-divider>

        <el-alert
          v-if="currentEditId"
          type="warning"
          :closable="false"
          show-icon
          class="items-editor__warn"
          title="当前后端更新接口不会保存结算明细变更：如需调整明细，请删除该记录后重新录入。"
        />

        <div class="items-editor">
          <div class="items-editor__toolbar">
            <el-button type="primary" plain size="small" @click="addItem">+ 添加明细行</el-button>
            <el-button type="danger" plain size="small" @click="addDeductionItem">+ 添加押金扣除项</el-button>
            <span class="items-editor__tip">
              <template v-if="formData.items.length">
                退还合计 ¥{{ formatMoney(formRefundTotal) }}，扣除合计
                <b class="amount-deduction">¥{{ formatMoney(formDeductionTotal) }}</b>，净额
                ¥{{ formatMoney(formRefundTotal - formDeductionTotal) }}
              </template>
              <template v-else>未录入结算明细时，无法体现押金扣除依据；每条明细均需填写类别、金额、说明</template>
            </span>
          </div>

          <el-table
            v-if="formData.items.length"
            :data="formData.items"
            size="small"
            border
            :row-class-name="itemRowClass"
          >
            <el-table-column label="类别（必填）" width="185">
              <template #default="{ row, $index }">
                <el-form-item
                  :prop="`items.${$index}.itemType`"
                  :rules="itemRules.itemType"
                  class="cell-form-item"
                >
                  <el-select v-model="row.itemType" placeholder="请选择类别" style="width: 100%">
                    <el-option
                      v-for="opt in ITEM_TYPE_OPTIONS"
                      :key="opt.value"
                      :label="opt.label"
                      :value="opt.value"
                    >
                      <span>{{ opt.label }}</span>
                      <el-tag v-if="opt.isDeduction" type="danger" size="small" effect="dark" class="opt-tag">
                        扣款
                      </el-tag>
                    </el-option>
                  </el-select>
                </el-form-item>
                <el-tag
                  v-if="row.itemType === 'DEPOSIT_DEDUCTION'"
                  type="danger"
                  effect="dark"
                  size="small"
                  class="deduction-flag"
                >
                  押金扣除
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="金额(元)（必填）" width="160">
              <template #default="{ row, $index }">
                <el-form-item
                  :prop="`items.${$index}.amount`"
                  :rules="itemRules.amount"
                  class="cell-form-item"
                >
                  <el-input-number
                    v-model="row.amount"
                    :min="0"
                    :precision="2"
                    :step="10"
                    :controls="false"
                    placeholder="0.00"
                    style="width: 100%"
                  />
                </el-form-item>
              </template>
            </el-table-column>
            <el-table-column label="说明（必填）" min-width="250">
              <template #default="{ row, $index }">
                <el-form-item
                  :prop="`items.${$index}.description`"
                  :rules="itemRules.description"
                  class="cell-form-item"
                >
                  <el-input
                    v-model="row.description"
                    maxlength="500"
                    placeholder="押金扣除请写明扣款依据，如：墙面破损修补"
                  />
                </el-form-item>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="80" align="center">
              <template #default="{ $index }">
                <el-button type="danger" link @click="removeItem($index)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>
          <el-empty v-else :image-size="50" description="暂无结算明细，点击上方按钮添加" />
        </div>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitLoading" @click="handleSubmit">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import type { FormInstance, TableInstance } from 'element-plus';
import { createCheckout, deleteCheckout, getCheckoutById, getCheckoutRecords, updateCheckout } from '@/api/checkout';
import { useUserStore } from '@/stores/user';
import type {
  CheckoutItem,
  CheckoutItemPayload,
  CheckoutItemType,
  CheckoutPayload,
  CheckoutRecord,
} from '@/types';

interface ItemTypeMeta {
  label: string;
  tagType: 'primary' | 'success' | 'warning' | 'danger' | 'info';
  /** 是否为扣减项（从应退金额中扣除，需重点核对依据） */
  isDeduction: boolean;
}

/** 结算项类别元数据：与后端 CheckoutItemType 六个枚举值一一对应 */
const ITEM_TYPE_META: Record<CheckoutItemType, ItemTypeMeta> = {
  RENT_REFUND: { label: '租金退还', tagType: 'success', isDeduction: false },
  DEPOSIT_REFUND: { label: '押金退还', tagType: 'primary', isDeduction: false },
  DEPOSIT_DEDUCTION: { label: '押金扣除', tagType: 'danger', isDeduction: true },
  UTILITY_REFUND: { label: '水电余额退还', tagType: 'success', isDeduction: false },
  OTHER_FEE: { label: '其他费用', tagType: 'warning', isDeduction: true },
  OTHER_REFUND: { label: '其他退款', tagType: 'info', isDeduction: false },
};

const ITEM_TYPE_OPTIONS = (Object.keys(ITEM_TYPE_META) as CheckoutItemType[]).map((value) => ({
  value,
  ...ITEM_TYPE_META[value],
}));

/** 弹窗中的明细行（金额为元，提交前转分） */
interface CheckoutItemForm {
  itemType: CheckoutItemType | '';
  amount: number | undefined;
  description: string;
}

const createEmptyItem = (itemType: CheckoutItemType | '' = ''): CheckoutItemForm => ({
  itemType,
  amount: undefined,
  description: '',
});

const userStore = useUserStore();

const loading = ref(false);
const submitLoading = ref(false);
const dialogVisible = ref(false);
const dialogTitle = ref('新增退租记录');
const formRef = ref<FormInstance>();
const tableRef = ref<TableInstance>();
const tableData = ref<CheckoutRecord[]>([]);
const currentEditId = ref('');
/** 详情缓存（列表接口不返回 items，展开行/编辑时按 id 拉取详情） */
const detailMap = ref<Record<string, CheckoutRecord>>({});
const detailLoading = ref<Record<string, boolean>>({});

const queryForm = reactive({ status: '' });

/** 区分「系统暂无数据」与「筛选无结果」 */
const emptyText = computed(() =>
  queryForm.status ? '没有符合条件的退租记录，试试调整状态筛选' : '暂无退租记录',
);
const pagination = reactive({ page: 1, limit: 20, total: 0 });
const formData = reactive({
  contractId: '',
  roomId: '',
  checkoutDate: '',
  totalRefund: 0,
  processedBy: '',
  status: 'DRAFT' as CheckoutRecord['status'],
  notes: '',
  items: [] as CheckoutItemForm[],
});

const rules = {
  contractId: [{ required: true, message: '请输入合同ID', trigger: 'blur' }],
  roomId: [{ required: true, message: '请输入房间ID', trigger: 'blur' }],
  checkoutDate: [{ required: true, message: '请选择退租日期', trigger: 'change' }],
  // 金额为 number，必须显式声明 type: 'number'，否则会被 async-validator 当作字符串校验
  totalRefund: [{ required: true, type: 'number', message: '请输入退款金额', trigger: 'change' }],
  processedBy: [{ required: true, message: '请输入处理人ID', trigger: 'blur' }],
};

/** 明细行内联校验：类别/金额/说明三者缺一即报错 */
const itemRules = {
  itemType: [{ required: true, message: '请选择类别', trigger: 'change' }],
  amount: [
    {
      validator: (_rule: unknown, value: unknown, callback: (error?: Error) => void) => {
        if (value === undefined || value === null || value === '') callback(new Error('请填写金额'));
        else if (typeof value !== 'number' || Number.isNaN(value)) callback(new Error('金额格式不正确'));
        else if (value < 0) callback(new Error('金额不能为负数'));
        else callback();
      },
      trigger: 'change',
    },
  ],
  description: [{ required: true, message: '请填写说明', trigger: 'blur' }],
};

const statusMap: Record<string, string> = {
  DRAFT: '草稿',
  PENDING: '待处理',
  COMPLETED: '已完成',
  CANCELLED: '已取消',
};

const statusTypeMap: Record<string, any> = {
  DRAFT: 'info',
  PENDING: 'warning',
  COMPLETED: 'success',
  CANCELLED: 'danger',
};

const formatMoney = (cents?: number | null) =>
  ((typeof cents === 'number' && !Number.isNaN(cents) ? cents : 0) / 100).toFixed(2);

const yuanToCents = (yuan?: number) =>
  typeof yuan === 'number' && !Number.isNaN(yuan) ? Math.round(yuan * 100) : 0;

const itemTypeMeta = (itemType: CheckoutItemType): ItemTypeMeta =>
  ITEM_TYPE_META[itemType] ?? { label: String(itemType), tagType: 'info', isDeduction: false };

const isDeduction = (itemType: CheckoutItemType | '') =>
  !!itemType && ITEM_TYPE_META[itemType as CheckoutItemType]?.isDeduction === true;

const todayStr = () => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const itemsOf = (row: CheckoutRecord): CheckoutItem[] => detailMap.value[row.id]?.items ?? [];

const sumByKind = (items: CheckoutItem[], deduction: boolean) =>
  items.reduce(
    (acc, item) => (isDeduction(item.itemType) === deduction ? acc + (Number(item.amount) || 0) : acc),
    0,
  );

const refundTotalOf = (row: CheckoutRecord) => sumByKind(itemsOf(row), false);
const deductionTotalOf = (row: CheckoutRecord) => sumByKind(itemsOf(row), true);

const formRefundTotal = computed(() =>
  formData.items.reduce(
    (acc, item) => (item.itemType && !isDeduction(item.itemType) ? acc + yuanToCents(item.amount) : acc),
    0,
  ),
);
const formDeductionTotal = computed(() =>
  formData.items.reduce(
    (acc, item) => (item.itemType && isDeduction(item.itemType) ? acc + yuanToCents(item.amount) : acc),
    0,
  ),
);

const itemRowClass = ({ row }: { row: CheckoutItemForm }) =>
  row.itemType === 'DEPOSIT_DEDUCTION' ? 'is-deduction-row' : '';

const resetForm = () => {
  Object.assign(formData, {
    contractId: '',
    roomId: '',
    checkoutDate: todayStr(),
    totalRefund: 0,
    processedBy: userStore.user?.id || '',
    status: 'DRAFT',
    notes: '',
    items: [],
  });
};

const fetchData = async () => {
  loading.value = true;
  try {
    // 状态为空时必须省略该参数：后端 status 校验为 @IsEnum，传空串会 400
    const response = await getCheckoutRecords({
      page: pagination.page,
      limit: pagination.limit,
      ...(queryForm.status ? { status: queryForm.status } : {}),
    });
    tableData.value = response.data;
    pagination.total = response.meta.total;
  } catch (error) {
    ElMessage.error('获取数据失败');
  } finally {
    loading.value = false;
  }
};

const fetchDetail = async (id: string): Promise<CheckoutRecord | null> => {
  detailLoading.value[id] = true;
  try {
    const detail = await getCheckoutById(id);
    if (detail) detailMap.value[id] = detail;
    return detail ?? null;
  } catch {
    return null;
  } finally {
    detailLoading.value[id] = false;
  }
};

const loadDetail = async (row: CheckoutRecord) => {
  if (detailMap.value[row.id] || detailLoading.value[row.id]) return;
  await fetchDetail(row.id);
};

const handleExpandChange = (row: CheckoutRecord, expanded: unknown) => {
  const isExpanded = Array.isArray(expanded)
    ? expanded.some((item: CheckoutRecord) => item.id === row.id)
    : expanded === true;
  if (isExpanded) void loadDetail(row);
};

const toggleDetail = (row: CheckoutRecord) => {
  tableRef.value?.toggleRowExpansion(row, true);
};

const handleQuery = () => {
  pagination.page = 1;
  fetchData();
};

const handleReset = () => {
  queryForm.status = '';
  handleQuery();
};

const handleCreate = async () => {
  dialogTitle.value = '新增退租记录';
  currentEditId.value = '';
  resetForm();
  dialogVisible.value = true;
  await nextTick();
  formRef.value?.clearValidate();
};

const toFormItem = (item: CheckoutItem): CheckoutItemForm => ({
  itemType: item.itemType,
  amount: typeof item.amount === 'number' ? item.amount / 100 : undefined,
  description: item.description || '',
});

const handleEdit = async (row: CheckoutRecord) => {
  dialogTitle.value = '编辑退租记录';
  currentEditId.value = row.id;
  const detail = detailMap.value[row.id] ?? (await fetchDetail(row.id)) ?? row;
  Object.assign(formData, {
    contractId: row.contractId,
    roomId: row.roomId,
    checkoutDate: row.checkoutDate.split('T')[0],
    totalRefund: row.totalRefund / 100,
    processedBy: row.processedBy,
    status: row.status,
    notes: row.notes || '',
    items: (detail.items ?? []).map(toFormItem),
  });
  dialogVisible.value = true;
  await nextTick();
  formRef.value?.clearValidate();
};

const handleDelete = async (row: CheckoutRecord) => {
  try {
    await ElMessageBox.confirm('确定要删除吗？', '提示', { type: 'warning' });
    await deleteCheckout(row.id);
    delete detailMap.value[row.id];
    ElMessage.success('删除成功');
    fetchData();
  } catch (error: any) {
    if (error !== 'cancel') ElMessage.error('删除失败');
  }
};

const addItem = () => {
  formData.items.push(createEmptyItem());
};

/** 快捷添加「押金扣除」行（扣款必须有类别/金额/说明） */
const addDeductionItem = () => {
  formData.items.push(createEmptyItem('DEPOSIT_DEDUCTION'));
};

const removeItem = (index: number) => {
  formData.items.splice(index, 1);
};

/** 明细校验：类别/金额/说明三者缺一不允许提交，返回第一条错误提示 */
const validateItems = (): string | null => {
  for (let index = 0; index < formData.items.length; index += 1) {
    const item = formData.items[index];
    const rowNo = index + 1;
    if (!item.itemType) return `第 ${rowNo} 行结算明细：请选择类别`;
    if (item.amount === undefined || item.amount === null || (item.amount as unknown) === '') {
      return `第 ${rowNo} 行结算明细：请填写金额`;
    }
    if (typeof item.amount !== 'number' || Number.isNaN(item.amount)) {
      return `第 ${rowNo} 行结算明细：金额格式不正确`;
    }
    if (item.amount < 0) return `第 ${rowNo} 行结算明细：金额不能为负数`;
    if (item.amount > 0 && yuanToCents(item.amount) === 0) {
      return `第 ${rowNo} 行结算明细：金额过小，最小 0.01 元`;
    }
    const description = String(item.description ?? '').trim();
    if (!description) {
      return `第 ${rowNo} 行结算明细：请填写说明（押金扣除需写明扣款依据）`;
    }
    if (description.length > 500) {
      return `第 ${rowNo} 行结算明细：说明不能超过 500 字`;
    }
  }
  return null;
};

const buildItemsPayload = (): CheckoutItemPayload[] =>
  formData.items.map((item) => ({
    itemType: item.itemType as CheckoutItemType,
    description: String(item.description ?? '').trim(),
    amount: yuanToCents(item.amount),
  }));

const handleSubmit = async () => {
  if (!formRef.value) return;

  // 先做明细业务校验，提示比表单项校验更明确（类别/金额/说明三者缺一不可）
  const itemError = validateItems();
  if (itemError) {
    ElMessage.error(itemError);
    // 同时点亮行内错误提示（表单项级别）
    formRef.value.validate().catch(() => undefined);
    return;
  }

  let valid = false;
  try {
    valid = await formRef.value.validate();
  } catch {
    valid = false;
  }
  if (!valid) {
    ElMessage.error('请完整填写退租记录必填项');
    return;
  }

  submitLoading.value = true;
  try {
    const payload: CheckoutPayload = {
      contractId: formData.contractId.trim(),
      roomId: formData.roomId.trim(),
      checkoutDate: formData.checkoutDate,
      totalRefund: yuanToCents(formData.totalRefund),
      processedBy: formData.processedBy.trim(),
      notes: formData.notes?.trim() ? formData.notes.trim() : undefined,
    };
    if (formData.items.length) payload.items = buildItemsPayload();

    if (currentEditId.value) {
      // status 仅更新接口接受（新增接口 forbidNonWhitelisted，传 status 会 400）
      payload.status = formData.status;
      await updateCheckout(currentEditId.value, payload);
      // 更新响应不含 items，清掉缓存以便下次展开重新拉取
      delete detailMap.value[currentEditId.value];
      ElMessage.success('更新成功');
    } else {
      const created = await createCheckout(payload);
      ElMessage.success('创建成功');
      dialogVisible.value = false;
      await fetchData();
      // 新增响应含 items，直接入缓存，展开行可立即看到明细
      if (created?.id) detailMap.value[created.id] = created;
      return;
    }
    dialogVisible.value = false;
    await fetchData();
  } catch {
    // 请求拦截器已弹出后端错误信息，此处不再重复提示
  } finally {
    submitLoading.value = false;
  }
};

onMounted(fetchData);
</script>

<style scoped>
.checkout-page {
  padding: 0;
}

.items-panel {
  padding: 8px 12px 4px 12px;
  background-color: #fafafa;
}

/* 外层表格存在横向滚动 + 右侧固定列：明细区吸左并限宽，保证任何滚动位置下都能完整查看 */
.items-panel__inner {
  position: sticky;
  left: 0;
  max-width: 820px;
}

.items-panel__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
  color: #606266;
}

.items-editor__toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}

.items-editor__tip {
  margin-left: auto;
  color: #909399;
  font-size: 12px;
}

.items-editor__warn {
  margin-bottom: 10px;
}

.cell-form-item {
  margin-bottom: 0;
}

.deduction-flag {
  margin-top: 4px;
}

.opt-tag {
  float: right;
}

.amount-deduction {
  color: #f56c6c;
  font-weight: 600;
}

.amount-refund {
  color: #67c23a;
  font-weight: 600;
}

/* 押金扣除行整体高亮，便于管理者核对扣款依据 */
:deep(.is-deduction-row) > td.el-table__cell {
  background-color: #fef0f0 !important;
}

:deep(.cell-form-item .el-form-item__content) {
  margin-left: 0 !important;
}
</style>
