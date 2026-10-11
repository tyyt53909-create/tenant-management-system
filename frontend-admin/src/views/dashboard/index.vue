<template>
  <div class="dashboard">
    <!-- 统计卡片 -->
    <el-row :gutter="20">
      <el-col :span="6">
        <el-card shadow="hover" class="stat-card" @click="handleCardClick('/rooms')">
          <div class="stat-content">
            <div class="stat-icon" style="background-color: #409eff">
              <el-icon size="40"><House /></el-icon>
            </div>
            <div class="stat-info">
              <div class="stat-value">{{ stats.totalRooms || 0 }}</div>
              <div class="stat-label">总房源数</div>
            </div>
          </div>
        </el-card>
      </el-col>

      <el-col :span="6">
        <el-card shadow="hover" class="stat-card" @click="handleCardClick('/tenants')">
          <div class="stat-content">
            <div class="stat-icon" style="background-color: #67c23a">
              <el-icon size="40"><User /></el-icon>
            </div>
            <div class="stat-info">
              <div class="stat-value">{{ stats.totalTenants || 0 }}</div>
              <div class="stat-label">租客数量</div>
            </div>
          </div>
        </el-card>
      </el-col>

      <el-col :span="6">
        <el-card shadow="hover" class="stat-card" @click="handleCardClick('/contracts')">
          <div class="stat-content">
            <div class="stat-icon" style="background-color: #e6a23c">
              <el-icon size="40"><Document /></el-icon>
            </div>
            <div class="stat-info">
              <div class="stat-value">{{ stats.activeContracts || 0 }}</div>
              <div class="stat-label">活跃合同</div>
            </div>
          </div>
        </el-card>
      </el-col>

      <el-col :span="6">
        <el-card shadow="hover" class="stat-card" @click="handleCardClick('/bills')">
          <div class="stat-content">
            <div class="stat-icon" style="background-color: #f56c6c">
              <el-icon size="40"><Tickets /></el-icon>
            </div>
            <div class="stat-info">
              <div class="stat-value">{{ stats.pendingBills || 0 }}</div>
              <div class="stat-label">待缴账单</div>
            </div>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <!-- 图表区域 -->
    <el-row :gutter="20" style="margin-top: 20px">
      <el-col :span="16">
        <el-card v-loading="loading">
          <template #header>
            <span>收入趋势（近6个月）</span>
          </template>
          <EChart :option="revenueChartOption" height="350px" />
        </el-card>
      </el-col>

      <el-col :span="8">
        <el-card v-loading="loading">
          <template #header>
            <span>房源状态分布</span>
          </template>
          <EChart :option="roomStatusChartOption" height="350px" />
        </el-card>
      </el-col>
    </el-row>

    <!-- 快速操作和最近记录 -->
    <el-row :gutter="20" style="margin-top: 20px">
      <el-col :span="12">
        <el-card>
          <template #header>
            <span>快速操作</span>
          </template>
          <div class="quick-actions">
            <el-button type="primary" @click="$router.push('/rooms?action=create')">
              <el-icon><Plus /></el-icon>
              新增房源
            </el-button>
            <el-button type="success" @click="$router.push('/tenants?action=create')">
              <el-icon><Plus /></el-icon>
              新增租客
            </el-button>
            <el-button type="warning" @click="$router.push('/contracts?action=create')">
              <el-icon><Plus /></el-icon>
              新增合同
            </el-button>
            <el-button type="info" @click="$router.push('/bills?action=create')">
              <el-icon><Plus /></el-icon>
              新增账单
            </el-button>
          </div>
        </el-card>
      </el-col>

      <el-col :span="12">
        <el-card>
          <template #header>
            <span>系统概览</span>
          </template>
          <el-descriptions :column="2" border>
            <el-descriptions-item label="空置房源">
              {{ stats.vacantRooms || 0 }} 间
            </el-descriptions-item>
            <el-descriptions-item label="已租房源">
              {{ stats.occupiedRooms || 0 }} 间
            </el-descriptions-item>
            <el-descriptions-item label="待处理报修">
              {{ stats.maintenanceRequests || 0 }} 条
            </el-descriptions-item>
            <el-descriptions-item label="入住率">
              {{ occupancyRate }}%
            </el-descriptions-item>
          </el-descriptions>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { House, User, Document, Tickets, Plus } from '@element-plus/icons-vue';
import EChart from '@/components/common/EChart.vue';
import type { EChartsOption } from 'echarts';

const router = useRouter();
const loading = ref(false);

// 模拟统计数据（实际应该从后端获取）
const stats = ref({
  totalRooms: 0,
  totalTenants: 0,
  activeContracts: 0,
  pendingBills: 0,
  vacantRooms: 0,
  occupiedRooms: 0,
  maintenanceRequests: 0,
});

// 计算入住率
const occupancyRate = computed(() => {
  if (stats.value.totalRooms === 0) return 0;
  return ((stats.value.occupiedRooms / stats.value.totalRooms) * 100).toFixed(1);
});

// 收入趋势图表配置
const revenueChartOption = computed<EChartsOption>(() => ({
  tooltip: {
    trigger: 'axis',
    axisPointer: {
      type: 'shadow'
    }
  },
  grid: {
    left: '3%',
    right: '4%',
    bottom: '3%',
    containLabel: true
  },
  xAxis: {
    type: 'category',
    data: ['1月', '2月', '3月', '4月', '5月', '6月'],
    axisLine: {
      lineStyle: {
        color: '#999'
      }
    }
  },
  yAxis: {
    type: 'value',
    name: '金额（元）',
    axisLine: {
      lineStyle: {
        color: '#999'
      }
    }
  },
  series: [
    {
      name: '收入',
      type: 'bar',
      data: [45000, 52000, 48000, 61000, 59000, 63000],
      itemStyle: {
        color: '#409EFF'
      },
      label: {
        show: true,
        position: 'top',
        formatter: (params: any) => {
          return '¥' + (params.value / 1000).toFixed(1) + 'k';
        }
      }
    }
  ]
}));

// 房源状态分布饼图配置
const roomStatusChartOption = computed<EChartsOption>(() => ({
  tooltip: {
    trigger: 'item',
    formatter: '{b}: {c} ({d}%)'
  },
  legend: {
    orient: 'vertical',
    left: 'left',
    top: 'center'
  },
  series: [
    {
      name: '房源状态',
      type: 'pie',
      radius: '70%',
      center: ['60%', '50%'],
      data: [
        { value: stats.value.vacantRooms || 15, name: '空置', itemStyle: { color: '#67C23A' } },
        { value: stats.value.occupiedRooms || 35, name: '已租', itemStyle: { color: '#409EFF' } },
        { value: 3, name: '维护中', itemStyle: { color: '#F56C6C' } },
        { value: 2, name: '已预订', itemStyle: { color: '#E6A23C' } }
      ],
      emphasis: {
        itemStyle: {
          shadowBlur: 10,
          shadowOffsetX: 0,
          shadowColor: 'rgba(0, 0, 0, 0.5)'
        }
      }
    }
  ]
}));

// 获取统计数据
const fetchStats = async () => {
  loading.value = true;
  try {
    // 模拟数据（实际应该调用 API）
    // const response = await getDashboardStats();
    // stats.value = response;
    
    // 模拟数据
    setTimeout(() => {
      stats.value = {
        totalRooms: 55,
        totalTenants: 42,
        activeContracts: 38,
        pendingBills: 12,
        vacantRooms: 15,
        occupiedRooms: 35,
        maintenanceRequests: 8,
      };
      loading.value = false;
    }, 500);
  } catch (error) {
    ElMessage.error('获取统计数据失败');
    loading.value = false;
  }
};

// 卡片点击跳转
const handleCardClick = (path: string) => {
  router.push(path);
};

onMounted(() => {
  fetchStats();
});
</script>

<style scoped>
.dashboard {
  padding: 0;
}

.stat-card {
  cursor: pointer;
  transition: transform 0.3s;
}

.stat-card:hover {
  transform: translateY(-5px);
}

.stat-content {
  display: flex;
  align-items: center;
  gap: 20px;
}

.stat-icon {
  width: 80px;
  height: 80px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
}

.stat-info {
  flex: 1;
}

.stat-value {
  font-size: 32px;
  font-weight: bold;
  color: #303133;
  margin-bottom: 5px;
}

.stat-label {
  font-size: 14px;
  color: #909399;
}

.quick-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.quick-actions .el-button {
  flex: 1;
  min-width: 120px;
}
</style>
