<template>
  <el-dialog
    v-model="dialogVisible"
    title="⚡ 虚拟水电表模拟器 (方案 A - 模拟接入与自检)"
    width="780px"
    destroy-on-close
    @closed="handleClose"
  >
    <el-alert
      title="无需物理硬件设备，即可模拟生成真实波峰波谷用量、跨月时序演进，并可一键运行攻防异常防御自检。"
      type="info"
      :closable="false"
      show-icon
      style="margin-bottom: 20px"
    />

    <el-form :model="form" label-width="120px" :disabled="loading">
      <el-form-item label="模拟场景">
        <el-radio-group v-model="form.scenario" class="scenario-group">
          <el-radio-button value="DAILY_HOURLY">
            📈 24小时日曲线 (逐时波峰波谷)
          </el-radio-button>
          <el-radio-button value="TIME_TRAVEL_MONTH">
            🚀 30天时间穿梭 (月度递增)
          </el-radio-button>
          <el-radio-button value="ANOMALY_TEST">
            🛡️ 异常防御自检 (4大攻防专项)
          </el-radio-button>
        </el-radio-group>
      </el-form-item>

      <div class="scenario-desc">
        <div v-if="form.scenario === 'DAILY_HOURLY'">
          💡 <strong>24小时日曲线</strong>：按早高峰（07:00-09:00）、晚高峰（18:00-23:00）及夜间基底负荷，为目标表计生成 24 个拟真小时读数点位。
        </div>
        <div v-else-if="form.scenario === 'TIME_TRAVEL_MONTH'">
          💡 <strong>30天时间穿梭</strong>：快速向后推进生成 30 天递增读数（包含周末用量上浮），一键为月度水电账单与批量结算准备好未结算用量。
        </div>
        <div v-else>
          💡 <strong>异常防御自检</strong>：自动对目标表计执行消息幂等（重复 messageId）、时间戳防重、延迟乱序入库（[OUT_OF_ORDER]）与矛盾倒走拦截（400）四大攻防验证。
        </div>
      </div>

      <el-form-item label="目标表计">
        <el-select
          v-model="form.meterId"
          placeholder="请选择指定表计（留空则对全部激活表计生效）"
          clearable
          style="width: 100%"
        >
          <el-option
            v-for="m in activeMeters"
            :key="m.id"
            :label="`${m.meterNumber} (${m.meterType === 'ELECTRICITY' ? '电表' : '水表'} - ${m.room?.roomNumber || '公共区域'})`"
            :value="m.id"
          />
        </el-select>
      </el-form-item>

      <el-form-item v-if="form.scenario === 'TIME_TRAVEL_MONTH'" label="穿梭天数">
        <el-input-number v-model="form.days" :min="1" :max="90" />
        <span style="margin-left: 10px; color: #909399; font-size: 13px">天（建议 30 天）</span>
      </el-form-item>

      <el-form-item v-if="form.scenario !== 'ANOMALY_TEST'" label="结算模式">
        <el-checkbox v-model="form.autoSettle">
          开启自动实时扣费（未勾选时仅作为未结算用量留存，用于测试待结预览与周期批量结算）
        </el-checkbox>
      </el-form-item>

      <el-form-item v-if="form.scenario !== 'ANOMALY_TEST'" label="随机波动">
        <el-slider v-model="variancePercent" :min="5" :max="40" :format-tooltip="(v: number) => `±${v}%`" style="width: 300px" />
        <span style="margin-left: 15px; color: #909399; font-size: 13px">±{{ variancePercent }}% 随机扰动</span>
      </el-form-item>
    </el-form>

    <!-- 运行结果展示区 -->
    <div v-if="result" class="simulation-result">
      <el-divider content-position="left">⚡ 模拟执行结果</el-divider>

      <el-alert
        :title="result.message"
        :type="result.success ? 'success' : 'error'"
        show-icon
        :closable="false"
        style="margin-bottom: 16px"
      />

      <!-- 攻防测试结果 -->
      <div v-if="result.scenario === 'ANOMALY_TEST' && result.anomalyResults" class="anomaly-report">
        <div class="report-meta">
          <span>🎯 测试表号: <strong>{{ result.anomalyResults.meterNumber }}</strong></span>
          <span>🧪 测试项: <strong>{{ result.anomalyResults.totalTests }} 项</strong></span>
          <span style="color: #67c23a">🟢 通过: <strong>{{ result.anomalyResults.passedCount }}</strong></span>
          <span :style="{ color: result.anomalyResults.failedCount > 0 ? '#f56c6c' : '#909399' }">
            🔴 失败: <strong>{{ result.anomalyResults.failedCount }}</strong>
          </span>
        </div>

        <el-table :data="result.anomalyResults.testCases" size="small" border style="margin-top: 10px">
          <el-table-column prop="name" label="测试项" width="220" />
          <el-table-column prop="status" label="判定" width="90">
            <template #default="{ row }">
              <el-tag :type="row.status === 'PASSED' ? 'success' : 'danger'" size="small">
                {{ row.status === 'PASSED' ? '通过' : '失败' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="detail" label="验证细节与防护说明" />
        </el-table>
      </div>

      <!-- 时序用量结果 -->
      <div v-else-if="result.meterResults && result.meterResults.length" class="metrics-report">
        <div class="summary-cards">
          <div class="summary-card">
            <div class="card-label">涉及表计</div>
            <div class="card-val">{{ result.totalMeters }} 只</div>
          </div>
          <div class="summary-card">
            <div class="card-label">生成读数点</div>
            <div class="card-val">{{ result.totalReadings }} 条</div>
          </div>
          <div class="summary-card">
            <div class="card-label">数据状态</div>
            <div class="card-val" style="color: #409eff">
              {{ form.autoSettle ? '已自动扣费' : '未结算待结' }}
            </div>
          </div>
        </div>

        <el-table :data="result.meterResults" size="small" border max-height="240" style="margin-top: 12px">
          <el-table-column prop="meterNumber" label="表号" width="130" />
          <el-table-column prop="roomNumber" label="房间" width="100" />
          <el-table-column prop="meterType" label="类型" width="90">
            <template #default="{ row }">
              <el-tag size="small" :type="row.meterType === 'ELECTRICITY' ? 'warning' : 'primary'">
                {{ row.meterType === 'ELECTRICITY' ? '电表' : '水表' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="pointsCount" label="生成点数" width="90" />
          <el-table-column prop="startReading" label="起步读数" width="100" />
          <el-table-column prop="endReading" label="截止读数" width="100" />
          <el-table-column prop="totalUsage" label="仿真用量">
            <template #default="{ row }">
              <strong>{{ row.totalUsage }}</strong>
              {{ row.meterType === 'ELECTRICITY' ? ' kWh' : ' m³' }}
            </template>
          </el-table-column>
        </el-table>
      </div>
    </div>

    <template #footer>
      <div class="dialog-footer">
        <el-button @click="handleClose">关闭</el-button>
        <el-button
          type="primary"
          :loading="loading"
          @click="handleRun"
        >
          🚀 启动模拟运行
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { runMeterSimulator, type SimulationResultResponse } from '@/api/meters';
import type { Meter } from '@/types';

const props = defineProps<{
  visible: boolean;
  meters: Meter[];
}>();

const emit = defineEmits<{
  (e: 'update:visible', value: boolean): void;
  (e: 'success'): void;
}>();

const dialogVisible = computed({
  get: () => props.visible,
  set: (val) => emit('update:visible', val),
});

const activeMeters = computed(() => {
  return props.meters.filter((m) => m.isActive);
});

const loading = ref(false);
const variancePercent = ref(15);
const result = ref<SimulationResultResponse | null>(null);

const form = ref<{
  scenario: 'DAILY_HOURLY' | 'TIME_TRAVEL_MONTH' | 'ANOMALY_TEST';
  meterId?: string;
  days: number;
  autoSettle: boolean;
}>({
  scenario: 'DAILY_HOURLY',
  meterId: undefined,
  days: 30,
  autoSettle: false,
});

watch(
  () => props.visible,
  (val) => {
    if (val) {
      result.value = null;
    }
  }
);

const handleClose = () => {
  dialogVisible.value = false;
};

const handleRun = async () => {
  loading.value = true;
  result.value = null;

  try {
    const payload = {
      scenario: form.value.scenario,
      meterId: form.value.meterId || undefined,
      days: form.value.scenario === 'TIME_TRAVEL_MONTH' ? form.value.days : undefined,
      autoSettle: form.value.autoSettle,
      variance: variancePercent.value / 100,
    };

    const res = await runMeterSimulator(payload);
    result.value = res;
    ElMessage.success(res.message || '模拟运行完成');
    emit('success');
  } catch (err: any) {
    ElMessage.error(err.response?.data?.message || err.message || '模拟运行失败');
  } finally {
    loading.value = false;
  }
};
</script>

<style scoped>
.scenario-group {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.scenario-desc {
  background-color: #f4f6f8;
  border-radius: 6px;
  padding: 10px 14px;
  font-size: 13px;
  color: #555;
  margin-bottom: 18px;
  line-height: 1.5;
}

.simulation-result {
  margin-top: 20px;
}

.report-meta {
  display: flex;
  gap: 20px;
  font-size: 13px;
  background-color: #fafafa;
  padding: 8px 12px;
  border-radius: 4px;
}

.summary-cards {
  display: flex;
  gap: 16px;
  margin-top: 10px;
}

.summary-card {
  flex: 1;
  background-color: #f8fafc;
  border: 1px solid #ebeef5;
  border-radius: 6px;
  padding: 10px 14px;
  text-align: center;
}

.card-label {
  font-size: 12px;
  color: #909399;
  margin-bottom: 4px;
}

.card-val {
  font-size: 18px;
  font-weight: 600;
  color: #303133;
}
</style>
