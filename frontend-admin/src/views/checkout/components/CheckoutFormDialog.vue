<template>
  <el-dialog
    :model-value="modelValue"
    :title="isEdit ? '编辑退租记录' : '新增退租记录'"
    width="920px"
    top="5vh"
    :close-on-click-modal="false"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <el-form ref="formRef" :model="formData" :rules="rules" label-width="110px">
      <el-row :gutter="16">
        <el-col :span="12">
          <el-form-item label="关联合同" prop="contractId">
            <EntitySelect
              v-model="formData.contractId"
              resource="contracts"
              @selected="(row) => { if (row) formData.roomId = row.roomId; }"
            />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="退租房源" prop="roomId">
            <EntitySelect v-model="formData.roomId" resource="rooms" />
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
          <el-form-item label="处理人" prop="processedBy">
            <el-input :model-value="userStore.user?.email || '当前登录管理者'" disabled />
          </el-form-item>
        </el-col>
        <el-col v-if="isEdit" :span="12">
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

      <div class="items-editor">
        <div class="items-editor__toolbar">
          <el-button type="primary" plain size="small" @click="addItem">+ 添加明细行</el-button>
          <el-button type="danger" plain size="small" @click="addDeductionItem">+ 添加押金扣除项</el-button>
          <span class="items-editor__tip">
            <template v-if="formData.items.length">
              退还合计 {{ formatMoney(formRefundTotal) }}，扣除合计
              <b class="amount-deduction">{{ formatMoney(formDeductionTotal) }}</b>，净额
              {{ formatMoney(formRefundTotal - formDeductionTotal) }}
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
      <el-button @click="$emit('update:modelValue', false)">取消</el-button>
      <el-button type="primary" :loading="submitLoading" @click="handleSubmit">确定</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch, nextTick } from 'vue';
import { ElMessage } from 'element-plus';
import type { FormInstance } from 'element-plus';
import EntitySelect from '@/components/common/EntitySelect.vue';
import { createCheckout, updateCheckout, getCheckoutById } from '@/api/checkout';
import { useUserStore } from '@/stores/user';
import type {
  CheckoutItem,
  CheckoutItemPayload,
  CheckoutItemType,
  CheckoutPayload,
  CheckoutRecord,
} from '@/types';
import { centsToYuan, formatMoney } from '@/utils/money';

interface ItemTypeMeta {
  label: string;
  tagType: 'primary' | 'success' | 'warning' | 'danger' | 'info';
  isDeduction: boolean;
}

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

const props = defineProps<{
  modelValue: boolean;
  editRecord?: CheckoutRecord | null;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', val: boolean): void;
  (e: 'success', createdRecord?: CheckoutRecord): void;
}>();

const userStore = useUserStore();
const formRef = ref<FormInstance>();
const submitLoading = ref(false);

const isEdit = computed(() => !!props.editRecord?.id);

const todayStr = () => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const formData = reactive({
  contractId: '',
  roomId: '',
  checkoutDate: todayStr(),
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
  totalRefund: [{ required: true, type: 'number', message: '请输入退款金额', trigger: 'change' }],
  processedBy: [{ required: true, message: '请输入处理人ID', trigger: 'blur' }],
};

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

const yuanToCents = (yuan?: number) =>
  typeof yuan === 'number' && !Number.isNaN(yuan) ? Math.round(yuan * 100) : 0;

const isDeduction = (itemType: CheckoutItemType | '') =>
  !!itemType && ITEM_TYPE_META[itemType as CheckoutItemType]?.isDeduction === true;

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

const toFormItem = (item: CheckoutItem): CheckoutItemForm => ({
  itemType: item.itemType,
  amount: typeof item.amount === 'number' ? centsToYuan(item.amount) : undefined,
  description: item.description || '',
});

function resetForm() {
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
}

watch(
  () => [props.modelValue, props.editRecord] as const,
  async ([visible, record]) => {
    if (!visible) return;
    if (record) {
      let items = record.items;
      if (!items) {
        try {
          const detail = await getCheckoutById(record.id);
          items = detail?.items;
        } catch {
          // Handled by request interceptor
        }
      }
      Object.assign(formData, {
        contractId: record.contractId,
        roomId: record.roomId,
        checkoutDate: record.checkoutDate.split('T')[0],
        totalRefund: centsToYuan(record.totalRefund),
        processedBy: record.processedBy,
        status: record.status,
        notes: record.notes || '',
        items: (items ?? []).map(toFormItem),
      });
    } else {
      resetForm();
    }
    await nextTick();
    formRef.value?.clearValidate();
  },
  { immediate: true },
);

const addItem = () => {
  formData.items.push(createEmptyItem());
};

const addDeductionItem = () => {
  formData.items.push(createEmptyItem('DEPOSIT_DEDUCTION'));
};

const removeItem = (index: number) => {
  formData.items.splice(index, 1);
};

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

  const itemError = validateItems();
  if (itemError) {
    ElMessage.error(itemError);
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

    if (props.editRecord?.id) {
      payload.status = formData.status;
      await updateCheckout(props.editRecord.id, payload);
      ElMessage.success('更新成功');
      emit('update:modelValue', false);
      emit('success');
    } else {
      const created = await createCheckout(payload);
      ElMessage.success('创建成功');
      emit('update:modelValue', false);
      emit('success', created);
    }
  } catch {
    // Handled by request interceptor
  } finally {
    submitLoading.value = false;
  }
};
</script>

<style scoped>
.items-editor__toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}

.items-editor__tip {
  margin-left: auto;
  color: var(--text-muted);
  font-size: 12px;
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
  color: var(--error-text);
  font-weight: 600;
}

:deep(.is-deduction-row) > td.el-table__cell {
  background-color: #fef0f0 !important;
}

:deep(.cell-form-item .el-form-item__content) {
  margin-left: 0 !important;
}
</style>
