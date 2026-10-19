<template>
  <div class="qiju-dashboard" v-loading="loading">
    <div class="dashboard-intro page-intro">
      <div><span class="eyebrow">OVERVIEW / 运营总览</span><h1>{{ greeting }}，管理员</h1><p>{{ fullDate }}。每一处居所，都在有序运转。</p></div>
      <div class="dashboard-actions"><el-button @click="router.push('/bills')"><el-icon><Calendar /></el-icon>查看月度账单</el-button><el-button type="primary" @click="router.push('/rooms?action=create')"><el-icon><Plus /></el-icon>新增房源</el-button></div>
    </div>
    <el-alert v-if="error" :title="error" type="error" show-icon :closable="false" class="dashboard-error"><el-button text @click="loadDashboard">重新加载</el-button></el-alert>
    <div class="dashboard-metrics">
      <button v-for="metric in metrics" :key="metric.path" class="metric-card" @click="router.push(metric.path)">
        <span class="metric-label"><span class="metric-symbol"><el-icon><component :is="metric.icon" /></el-icon></span>{{ metric.label }}</span>
        <span class="metric-number">{{ metric.value }}<small>{{ metric.unit }}</small></span><span class="metric-bottom">{{ metric.description }}<el-icon><ArrowRight /></el-icon></span>
      </button>
    </div>
    <div class="dashboard-grid">
      <div class="dashboard-stack">
        <section class="dashboard-card">
          <div class="section-heading"><h2>运营日历</h2><router-link to="/bills">近期账单<el-icon><ArrowRight /></el-icon></router-link></div>
          <div class="calendar-layout"><div><div class="month-heading"><strong>{{ year }} 年 {{ month + 1 }} 月</strong><div><button aria-label="上个月" @click="changeMonth(-1)"><el-icon><ArrowLeft /></el-icon></button><button aria-label="下个月" @click="changeMonth(1)"><el-icon><ArrowRight /></el-icon></button></div></div>
            <div class="month-grid"><span v-for="label in weekdays" :key="label" class="weekday">{{ label }}</span>
              <template v-for="(day, index) in days" :key="index"><span v-if="!day" /><button v-else :class="['calendar-day', { selected: selectedDay === day, today: todayKey === dayKey(day) }]" :aria-label="`${month + 1}月${day}日`" :aria-pressed="selectedDay === day" @click="selectedDay = day">{{ day }}<i v-if="billDays.has(dayKey(day))" /></button></template>
            </div></div>
            <div class="day-agenda"><span class="agenda-caption">选中日期</span><div class="agenda-number">{{ selectedDay }}<small>日</small></div><span class="agenda-caption">{{ year }} 年 {{ month + 1 }} 月</span>
              <router-link v-for="bill in dayBills.slice(0, 3)" :key="bill.id" to="/bills" class="agenda-event"><strong>{{ bill.billType === 'RENT' ? '租金账单' : '费用账单' }}到期</strong><span>{{ bill.contract?.room?.roomNumber || bill.billNumber }} · {{ formatMoney(bill.amount) }}</span></router-link>
              <p v-if="!dayBills.length" class="agenda-empty">这一天没有近期账单到期。<br>片刻从容，有序生活。</p><router-link to="/bills" class="agenda-link">查看全部账单 →</router-link>
            </div>
          </div>
          <p class="calendar-note">日历展示最近 {{ calendarBills.length }} 笔账单的到期日。</p>
        </section>
        <section class="dashboard-card"><div class="section-heading"><h2>近期账单</h2><router-link to="/bills">查看全部<el-icon><ArrowRight /></el-icon></router-link></div>
          <router-link v-for="bill in calendarBills.slice(0, 4)" :key="bill.id" to="/bills" class="activity-row"><span class="activity-icon"><el-icon><Wallet /></el-icon></span><div class="activity-copy"><strong>{{ bill.contract?.room?.roomNumber || '房屋账单' }} · {{ bill.period }}</strong><span>{{ bill.contract?.tenant?.name || bill.billNumber }} · 应收 {{ formatMoney(bill.amount) }}</span></div><el-tag :type="bill.status === 'PAID' ? 'success' : bill.status === 'OVERDUE' ? 'danger' : 'warning'">{{ billStatus[bill.status] || bill.status }}</el-tag></router-link>
          <el-empty v-if="!calendarBills.length && !loading" description="暂无账单，创建后将在这里显示" :image-size="50" />
        </section>
      </div>
      <div class="dashboard-stack">
        <section class="dashboard-card"><div class="section-heading"><h2>房源运营概况</h2><router-link to="/rooms">房源管理<el-icon><ArrowRight /></el-icon></router-link></div>
          <div class="occupancy-layout"><div class="occupancy-ring" :style="{ background: occupancyGradient }"><div><strong>{{ occupancy }}<small>%</small></strong><span>当前入住率</span></div></div><div class="occupancy-legend"><div v-for="item in roomStatus" :key="item.status"><span><i :style="{ background: statusMeta[item.status]?.color || '#cac1af' }" />{{ statusMeta[item.status]?.label || item.status }}</span><strong>{{ item.count }}</strong></div><div v-if="!roomStatus.length"><span>暂无房源记录</span></div></div></div>
          <div class="overview-summary"><span>活跃合同 <b>{{ stats.activeContracts }}</b></span><span>待缴账单 <b>{{ stats.pendingBills }}</b></span></div>
        </section>
        <section class="dashboard-card"><div class="section-heading"><h2>最近动态</h2><router-link to="/notifications">通知中心<el-icon><ArrowRight /></el-icon></router-link></div>
          <router-link v-for="notice in notifications" :key="notice.id" to="/notifications" class="activity-row"><span class="activity-icon notice-icon"><el-icon><Bell /></el-icon></span><div class="activity-copy"><strong>{{ notice.title }}</strong><span>{{ notice.body }}</span></div><span class="activity-date">{{ formatDateOnly(notice.createdAt).slice(5) }}</span></router-link>
          <el-empty v-if="!notifications.length && !loading" description="暂时没有新的通知" :image-size="50" />
        </section>
      </div>
    </div>
    <!-- 水电使用概览（T171） -->
    <UtilitiesOverviewCard />

    <section class="dashboard-card revenue-card"><div class="section-heading"><h2>收入趋势</h2><router-link to="/statistics">查看统计<el-icon><ArrowRight /></el-icon></router-link></div><p class="chart-caption">近六个月 · 实收金额（元）</p><EChart :option="revenueOption" height="230px" /></section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { House, User, Wallet, Tools, Calendar, Plus, ArrowRight, ArrowLeft, Bell } from '@element-plus/icons-vue';
import EChart from '@/components/common/EChart.vue';
import UtilitiesOverviewCard from '@/components/dashboard/UtilitiesOverviewCard.vue';
import type { EChartsOption } from 'echarts';
import { getDashboardStats, getRevenueTrend, getRoomStatusDistribution } from '@/api/dashboard';
import type { DashboardStats, RevenueData, RoomStatusData } from '@/api/dashboard';
import { getBills } from '@/api/bills';
import { getNotifications } from '@/api/notifications';
import type { Bill, Notification } from '@/types';
import { formatMoney, formatDateOnly } from '@/utils/table';
import { calendarDays, calendarKey } from '@/utils/calendar';

const router = useRouter();
const loading = ref(true);
const error = ref('');
const now = new Date();
const year = ref(now.getFullYear());
const month = ref(now.getMonth());
const selectedDay = ref(now.getDate());
const todayKey = calendarKey(now.getFullYear(), now.getMonth(), now.getDate());
const fullDate = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }).format(now);
const greeting = now.getHours() < 12 ? '早上好' : now.getHours() < 18 ? '下午好' : '晚上好';
const weekdays = ['一', '二', '三', '四', '五', '六', '日'];
const stats = ref<DashboardStats>({ totalRooms: 0, totalTenants: 0, activeContracts: 0, pendingBills: 0, vacantRooms: 0, occupiedRooms: 0, maintenanceRequests: 0 });
const roomStatus = ref<RoomStatusData[]>([]);
const revenue = ref<RevenueData[]>([]);
type DashboardBill = Bill & { contract?: { room?: { roomNumber: string }; tenant?: { name: string } } };
const calendarBills = ref<DashboardBill[]>([]);
const notifications = ref<Notification[]>([]);
const occupancy = computed(() => stats.value.totalRooms ? (stats.value.occupiedRooms / stats.value.totalRooms * 100).toFixed(1) : '0');
const occupancyGradient = computed(() => `conic-gradient(#768168 ${occupancy.value}%, #ebe7df 0)`);
const statusMeta: Record<string, { label: string; color: string }> = { OCCUPIED: { label: '已出租', color: '#768168' }, VACANT: { label: '空置', color: '#cac1af' }, RESERVED: { label: '已预订', color: '#b87648' }, MAINTENANCE: { label: '维护中', color: '#ba6459' } };
const billStatus: Record<string, string> = { PENDING: '待缴', PAID: '已缴', PARTIAL: '部分缴纳', OVERDUE: '已逾期', CANCELLED: '已取消' };
const metrics = computed(() => [
  { path: '/rooms', icon: House, label: '房源总数', value: stats.value.totalRooms, unit: '套', description: `已出租 ${stats.value.occupiedRooms} · 空置 ${stats.value.vacantRooms}` },
  { path: '/tenants', icon: User, label: '租客档案', value: stats.value.totalTenants, unit: '人', description: `活跃合同 ${stats.value.activeContracts} 份` },
  { path: '/bills', icon: Wallet, label: '待缴账单', value: stats.value.pendingBills, unit: '笔', description: '及时跟进每一笔待收款项' },
  { path: '/maintenance', icon: Tools, label: '待处理报修', value: stats.value.maintenanceRequests, unit: '条', description: '认真回应每一次服务申请' },
]);
const days = computed(() => calendarDays(year.value, month.value));
const dayKey = (day: number) => calendarKey(year.value, month.value, day);
const billDays = computed(() => new Set(calendarBills.value.map((bill) => bill.dueDate?.slice(0, 10))));
const dayBills = computed(() => calendarBills.value.filter((bill) => bill.dueDate?.slice(0, 10) === dayKey(selectedDay.value)));
function changeMonth(delta: number) { const date = new Date(year.value, month.value + delta, 1); year.value = date.getFullYear(); month.value = date.getMonth(); selectedDay.value = 1; }
const revenueOption = computed<EChartsOption>(() => ({
  animation: true,
  animationDuration: 750,
  animationEasing: 'cubicOut',
  animationDurationUpdate: 500,
  animationEasingUpdate: 'cubicInOut',
  color: ['#768168'],
  tooltip: {
    trigger: 'axis',
    axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(118, 129, 104, 0.08)' } },
    backgroundColor: 'rgba(255, 254, 250, 0.96)',
    borderColor: '#e5e0d4',
    borderWidth: 1,
    padding: [8, 12],
    textStyle: { color: '#2c2a29' },
    extraCssText: 'box-shadow: 0 8px 24px rgba(54, 45, 26, 0.08); border-radius: 8px;',
    valueFormatter: (value) => `¥${Number(value).toLocaleString()}`,
  },
  grid: { left: 12, right: 18, top: 24, bottom: 10, containLabel: true },
  xAxis: {
    type: 'category',
    data: revenue.value.map((item) => `${Number(item.month.split('-')[1])}月`),
    axisLine: { lineStyle: { color: '#e9e5dd' } },
    axisTick: { show: false },
    axisLabel: { color: '#6f6c63' },
  },
  yAxis: {
    type: 'value',
    splitLine: { lineStyle: { color: '#f0ede5' } },
    axisLabel: { color: '#6f6c63' },
  },
  series: [
    {
      type: 'bar',
      barMaxWidth: 28,
      data: revenue.value.map((item) => item.revenue / 100),
      itemStyle: { borderRadius: [5, 5, 0, 0] },
      emphasis: {
        itemStyle: {
          color: '#5b664f',
          shadowBlur: 6,
          shadowColor: 'rgba(0, 0, 0, 0.12)',
        },
      },
    },
  ],
}));
async function loadDashboard() {
  loading.value = true; error.value = '';
  try {
    const [summary, trend, distribution, bills, notices] = await Promise.all([getDashboardStats(), getRevenueTrend(), getRoomStatusDistribution(), getBills({ page: 1, limit: 100 }), getNotifications({ page: 1, limit: 4 })]);
    stats.value = summary; revenue.value = trend; roomStatus.value = distribution; calendarBills.value = bills.data; notifications.value = notices.data;
  } catch { error.value = '运营数据暂时未能加载，请检查连接后重试。'; }
  finally { loading.value = false; }
}
onMounted(loadDashboard);
</script>

<style scoped>
.dashboard-intro{display:flex;align-items:flex-end;justify-content:space-between;gap:20px}
.dashboard-actions{display:flex;gap:8px;flex-shrink:0}
.dashboard-actions .el-button{margin:0;gap:6px;transition:all .22s cubic-bezier(.16,1,.3,1)}
.dashboard-actions .el-button:hover{transform:translateY(-1px);box-shadow:0 4px 12px rgba(54,45,26,.06)}
.dashboard-error{margin-bottom:20px}
.dashboard-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:17px;margin-bottom:22px}
.metric-card{position:relative;overflow:hidden;min-height:153px;padding:21px 22px;text-align:left;background:var(--bg-card);border:1px solid var(--border);border-radius:13px;color:var(--text-primary);box-shadow:0 18px 65px rgba(46,42,31,.043);transition:transform .28s cubic-bezier(.16,1,.3,1),border-color .25s ease,box-shadow .28s cubic-bezier(.16,1,.3,1);cursor:pointer}
.metric-card:after{content:'';position:absolute;right:-12px;top:-15px;width:58px;height:58px;border:12px solid #f6f3ec;border-radius:50%;transition:transform .3s cubic-bezier(.16,1,.3,1)}
.metric-card:hover{transform:translateY(-3px);border-color:#c9cebe;box-shadow:0 20px 48px rgba(54,45,26,.075)}
.metric-card:hover:after{transform:scale(1.1)}
.metric-label{display:flex;align-items:center;gap:10px;font-size:12px;color:var(--text-muted)}
.metric-symbol{width:31px;height:31px;display:grid;place-items:center;background:#f2eee6;border-radius:9px;color:#9b8569;transition:transform .24s cubic-bezier(.16,1,.3,1),background .2s ease}
.metric-card:hover .metric-symbol{transform:scale(1.08);background:#eae3d5}
.metric-number{display:block;font-size:34px;font-weight:550;letter-spacing:-.05em;font-variant-numeric:tabular-nums;margin:15px 0 13px}
.metric-number small{font-size:var(--font-micro);color:var(--text-subtle);letter-spacing:0;margin-left:7px;font-weight:400}
.metric-bottom{display:flex;justify-content:space-between;gap:8px;font-size:var(--font-micro);color:var(--text-subtle)}
.metric-bottom .el-icon{transition:transform .22s cubic-bezier(.16,1,.3,1)}
.metric-card:hover .metric-bottom .el-icon{transform:translateX(4px);color:#535b43}
.dashboard-grid{display:grid;grid-template-columns:1.3fr 1fr;gap:22px}
.dashboard-stack{display:flex;flex-direction:column;gap:22px;min-width:0}
.dashboard-card{padding:24px;background:var(--bg-card);border:1px solid var(--border);border-radius:13px;box-shadow:0 18px 65px rgba(46,42,31,.043)}
.section-heading{display:flex;align-items:center;justify-content:space-between;gap:14px;margin-bottom:22px}
.section-heading h2{font-size:14px;font-weight:650}
.section-heading a{display:flex;align-items:center;gap:5px;color:var(--text-muted);font-size:var(--font-micro);white-space:nowrap;transition:color .2s ease}
.section-heading a .el-icon{transition:transform .2s cubic-bezier(.16,1,.3,1)}
.section-heading a:hover{color:#535b43}
.section-heading a:hover .el-icon{transform:translateX(3px)}
.calendar-layout{display:grid;grid-template-columns:minmax(0,1fr) 170px;gap:22px}
.month-heading{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}
.month-heading strong{font-size:12px;font-weight:600}
.month-heading>div{display:flex;gap:6px}
.month-heading button{background:#f7f5ef;border:1px solid #ede8df;border-radius:6px;width:25px;height:25px;display:grid;place-items:center;color:var(--text-muted);transition:all .2s cubic-bezier(.16,1,.3,1)}
.month-heading button:hover{background:#ece7db;color:#302f2a;transform:scale(1.08)}
.month-heading button:active{transform:scale(0.94)}
.month-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:4px}
.weekday{font-size:var(--font-micro);text-align:center;color:var(--text-subtle);padding:4px 0 10px}
.calendar-day{position:relative;height:36px;border:0;border-radius:8px;background:transparent;color:#69675f;font-size:12px;transition:transform .18s cubic-bezier(.16,1,.3,1),background .18s ease;cursor:pointer}
.calendar-day:hover{background:#f1eee8;transform:scale(1.08)}
.calendar-day.today{font-weight:700;color:#535b43}
.calendar-day.selected{background:var(--primary);color:white;transform:scale(1.04)}
.calendar-day i{position:absolute;bottom:4px;left:calc(50% - 2px);width:3px;height:3px;border-radius:50%;background:#b87648}
.calendar-day.selected i{background:#ede4c8}
.day-agenda{padding-left:21px;border-left:1px solid #eeeae1}
.agenda-caption{font-size:var(--font-micro);color:var(--text-subtle)}
.agenda-number{font-size:43px;font-weight:500;letter-spacing:-.05em;margin:7px 0 5px}
.agenda-number small{font-size:12px;letter-spacing:0;margin-left:5px;color:var(--text-muted)}
.agenda-event{display:flex;flex-direction:column;gap:6px;padding:12px 8px;border-bottom:1px solid #eeeae1;border-radius:8px;margin:0 -8px;transition:background-color .2s ease,transform .2s cubic-bezier(.16,1,.3,1)}
.agenda-event:hover{background-color:#f7f4ee;transform:translateX(3px)}
.agenda-event strong{font-size:var(--font-micro);font-weight:600}
.agenda-event span{font-size:var(--font-micro);color:var(--text-muted);overflow-wrap:anywhere}
.agenda-empty{font-size:var(--font-micro);color:var(--text-muted);line-height:1.9;margin:21px 0}
.agenda-link{font-size:var(--font-micro);color:var(--text-muted);transition:all .2s ease;display:inline-block}
.agenda-link:hover{transform:translateX(3px);color:#535b43}
.calendar-note{font-size:var(--font-micro);color:var(--text-subtle);margin-top:19px}
.activity-row{display:flex;align-items:center;gap:12px;padding:12px 8px;border-bottom:1px solid #f0ede5;border-radius:8px;margin:0 -8px;transition:background-color .2s ease,transform .2s cubic-bezier(.16,1,.3,1)}
.activity-row:hover{background-color:#f7f4ee;transform:translateX(3px)}
.activity-row:last-child{border:0;padding-bottom:12px}
.activity-icon{height:35px;width:35px;display:grid;place-items:center;background:#f6eee6;color:#99745d;border-radius:10px;flex-shrink:0;transition:transform .2s ease}
.activity-row:hover .activity-icon{transform:scale(1.06)}
.notice-icon{background:#edf0e8;color:#768168}
.activity-copy{flex:1;min-width:0}
.activity-copy strong{display:block;font-size:12px;font-weight:550;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.activity-copy span{display:block;margin-top:6px;font-size:var(--font-micro);color:var(--text-subtle);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.activity-date{color:var(--text-subtle);font-size:var(--font-micro);flex-shrink:0}
.occupancy-layout{display:flex;gap:27px;align-items:center;padding:13px 0 20px}
.occupancy-ring{width:140px;height:140px;border-radius:50%;padding:13px;flex-shrink:0;transition:transform .3s cubic-bezier(.16,1,.3,1)}
.occupancy-ring:hover{transform:scale(1.03)}
.occupancy-ring>div{display:flex;align-items:center;justify-content:center;flex-direction:column;width:100%;height:100%;border-radius:50%;background:#fffefa}
.occupancy-ring strong{font-size:28px;font-weight:550;letter-spacing:-.04em}
.occupancy-ring small{font-size:var(--font-micro);margin-left:2px}
.occupancy-ring span{font-size:var(--font-micro);color:var(--text-subtle);margin-top:7px}
.occupancy-legend{flex:1;min-width:0}
.occupancy-legend>div{display:flex;justify-content:space-between;gap:13px;font-size:var(--font-micro);margin:14px 0;color:var(--text-muted);padding:4px 6px;border-radius:6px;transition:background-color .2s ease}
.occupancy-legend>div:hover{background-color:#f7f4ee}
.occupancy-legend strong{color:#302f2a;font-weight:600}
.occupancy-legend i{display:inline-block;width:6px;height:6px;border-radius:50%;margin-right:7px}
.overview-summary{display:flex;justify-content:space-between;gap:20px;padding-top:16px;border-top:1px solid #f0ede5;font-size:var(--font-micro);color:var(--text-muted)}
.overview-summary b{margin-left:10px;color:#535b43}
.revenue-card{margin-top:22px}
.chart-caption{color:var(--text-subtle);font-size:var(--font-micro);margin-top:-10px;margin-bottom:10px}
@media(min-width:1600px){.dashboard-grid{grid-template-columns:1.5fr 1fr}}@media(max-width:1150px){.dashboard-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.dashboard-grid{grid-template-columns:1fr}.dashboard-intro{align-items:flex-start;flex-direction:column}.occupancy-layout{justify-content:flex-start}.occupancy-legend{max-width:260px}}@media(max-width:600px){.dashboard-metrics{gap:9px}.metric-card{min-height:134px;padding:16px}.metric-number{font-size:28px}.metric-label{font-size:var(--font-micro);gap:7px}.metric-bottom{font-size:var(--font-micro)}.dashboard-card{padding:19px 16px}.calendar-layout{grid-template-columns:1fr}.day-agenda{border-left:0;border-top:1px solid #eeeae1;padding:16px 0 0;display:none}.calendar-note{margin-top:13px}.dashboard-actions{flex-wrap:wrap}.occupancy-ring{width:125px;height:125px}}
</style>
<style scoped>
@media(max-width:600px){.day-agenda{display:block}}
</style>
