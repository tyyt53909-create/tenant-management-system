<template>
  <div class="qiju-shell">
    <a class="skip-link" href="#workspace-content">跳到页面内容</a>
    <button v-if="mobileOpen" :class="['nav-cover', { 'nav-cover--hover': navHoverOpen }]" aria-label="关闭导航" @click="closeNav" />
    <aside :class="['qiju-side', { open: mobileOpen }]" @mouseenter="cancelNavClose" @mouseleave="scheduleNavClose">
      <router-link to="/dashboard" class="qiju-brand" @click="closeNav">
        <span class="brand-mark"><el-icon :size="22"><House /></el-icon></span>
        <span><strong>栖居管理</strong><small>PROPERTY CONSOLE</small></span>
      </router-link>
      <div class="side-label">工作空间 / WORKSPACE</div>
      <nav class="qiju-navigation" aria-label="管理导航">
        <router-link v-for="item in navigation" :key="item.path" :to="item.path"
          :class="['qiju-nav-item', { active: route.path === item.path }]"
          :aria-current="route.path === item.path ? 'page' : undefined" @click="closeNav">
          <el-icon :size="18"><component :is="item.icon" /></el-icon><span>{{ item.title }}</span>
          <span v-if="item.path === '/notifications' && notificationStore.unreadCount" class="nav-count">{{ Math.min(notificationStore.unreadCount, 99) }}</span>
          <span v-if="item.path==='/maintenance' && management.snapshot?.maintenance.submitted" class="nav-count">{{ Math.min(management.snapshot.maintenance.submitted,99) }}</span>
        </router-link>
      </nav>
      <div class="side-bottom">
        <div class="side-account">
          <span class="user-avatar">{{ userInitial }}</span>
          <div class="side-account-copy">
            <strong>{{ userStore.user?.email || '管理员' }}</strong>
            <small>{{ roleLabel }}</small>
          </div>
          <button class="side-logout" type="button" title="退出登录" aria-label="退出登录" @click="handleLogout">
            <el-icon :size="14"><SwitchButton /></el-icon>
          </button>
        </div>
      </div>
    </aside>
    <div class="qiju-main">
      <header class="qiju-topbar">
        <button class="icon-button mobile-toggle" aria-label="打开导航" :aria-expanded="mobileOpen" @mouseenter="scheduleNavOpen" @mouseleave="scheduleNavClose" @click="toggleNav"><el-icon :size="20"><Menu /></el-icon></button>
        <div class="qiju-breadcrumb"><span>运营中心</span><span>/</span><b>{{ currentPage.title }}</b></div>
        <div class="top-spacer" />
        <button class="voucher-trigger" title="识别并核销租客缴费单据 (⌘ V)" @click="voucherVisible = true"><el-icon><Ticket /></el-icon><span>单据识别入账</span><kbd>⌘ V</kbd></button>
        <button class="search-trigger" @click="searchVisible = true"><el-icon><Search /></el-icon><span>搜索页面与服务…</span><kbd>⌘ K</kbd></button>
        <span class="top-date">{{ today }}</span>
        <router-link class="icon-button" to="/notifications" aria-label="通知中心"><el-icon :size="20"><Bell /></el-icon><i v-if="notificationStore.unreadCount" class="unread-dot" /></router-link>
      </header>
      <main id="workspace-content" class="qiju-content" tabindex="-1">
        <div v-if="route.path !== '/dashboard' && route.path !== '/space/editor'" class="page-intro">
          <div><span class="eyebrow">{{ currentPage.label }}</span><h1>{{ currentPage.title }}</h1><p>{{ currentPage.description }}</p></div><div id="page-head-actions" class="page-head-actions" />
        </div>
        <router-view />
        <footer class="workspace-footer"><span>栖居 · 每一处居所，都在有序运转</span><span>PROPERTY MANAGEMENT</span></footer>
      </main>
    </div>
    <el-dialog v-model="searchVisible" title="前往页面" width="min(480px, calc(100vw - 32px))">
      <el-input v-model="searchQuery" placeholder="搜索管理页面，或输入至少 2 字查找业务记录…" :maxlength="100" clearable autofocus aria-label="搜索管理页面与业务记录" />
      <div class="command-list"><button v-for="item in searchResults" :key="item.path" @click="openPage(item.path)"><el-icon><component :is="item.icon" /></el-icon><span>{{ item.title }}</span><el-icon><ArrowRight /></el-icon></button></div>
      <section v-if="searchQuery.trim().length>=2" class="record-search"><h3>业务记录 <small>每类最多 5 条</small></h3><el-skeleton v-if="recordSearchLoading" :rows="3" animated /><p v-else-if="recordSearchError" class="pane-error" role="alert">{{ recordSearchError }}</p><div v-else class="record-search-results"><button v-for="item in recordSearchResults" :key="`${item.kind}-${item.id}`" @click="openRecord(item)"><span class="record-glyph"><el-icon><component :is="recordIcons[item.kind]" /></el-icon></span><span><strong>{{ item.title }}</strong><small>{{ recordKinds[item.kind] }} · {{ item.subtitle }}{{ item.status ? ` · ${stateLabel(item.status)}` : '' }}</small></span><el-icon><ArrowRight /></el-icon></button><p v-if="!recordSearchResults.length">没有匹配的业务记录。</p></div></section>
    </el-dialog>
    <VoucherRecognitionModal v-model="voucherVisible" :initial-text="voucherInitialText" @settled="handleGlobalVoucherSettled" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { House, User, OfficeBuilding, Document, Wallet, Tools, Brush, Bell, TrendCharts, Tickets, Ticket, Odometer, Switch, SwitchButton, Setting, ArrowRight, Search, Menu, Grid, ChatDotSquare } from '@element-plus/icons-vue';
import VoucherRecognitionModal from '@/components/common/VoucherRecognitionModal.vue';
import { useUserStore } from '@/stores/user';
import { useNotificationStore } from '@/stores/notification';
import { createNotificationSocket } from '@/utils/notificationSocket';
import type { Socket } from 'socket.io-client';
import { usePreferencesStore } from '@/stores/preferences';
import { useManagementStore } from '@/stores/management';
import request from '@/utils/request';
import { stateLabel } from '@/utils/resource';
import { filterNavigation, roleLabel as roleLabelOf } from '@/utils/access';

const route = useRoute();
const router = useRouter();
const userStore = useUserStore();
const notificationStore = useNotificationStore();
const preferences=usePreferencesStore();
const management=useManagementStore();
watch(()=>[preferences.compact,preferences.reduceMotion],()=>{document.documentElement.classList.toggle('qiju-compact',preferences.compact);document.documentElement.classList.toggle('qiju-reduce-motion',preferences.reduceMotion);},{immediate:true});
const mobileOpen = ref(false);
const navHoverOpen = ref(false);
let navOpenTimer: ReturnType<typeof setTimeout> | null = null;
let navCloseTimer: ReturnType<typeof setTimeout> | null = null;
const searchVisible = ref(false);
const searchQuery = ref('');
interface RecordSearchResult{kind:'rooms'|'tenants'|'contracts'|'maintenance';id:string;title:string;subtitle:string;status?:string}
const recordSearchResults=ref<RecordSearchResult[]>([]);const recordSearchLoading=ref(false);const recordSearchError=ref('');
const recordKinds={rooms:'房源',tenants:'租客',contracts:'合同',maintenance:'工单'};
const recordIcons={rooms:House,tenants:User,contracts:Document,maintenance:Tools};
let searchTimer:ReturnType<typeof setTimeout>|null=null;let searchController:AbortController|null=null;let searchGeneration=0;
watch(searchQuery,value=>{
  if(searchTimer)clearTimeout(searchTimer);searchController?.abort();const current=++searchGeneration;
  recordSearchResults.value=[];recordSearchError.value='';recordSearchLoading.value=false;
  const keyword=value.trim();if(keyword.length<2||!searchVisible.value)return;
  recordSearchLoading.value=true;
  searchTimer=setTimeout(async()=>{searchController=new AbortController();try{const rows:any=await request.get('/dashboard/search',{params:{q:keyword},signal:searchController.signal,silentError:true});if(current===searchGeneration)recordSearchResults.value=rows;}catch{if(current===searchGeneration)recordSearchError.value='业务记录未能加载，请检查连接后重试。';}finally{if(current===searchGeneration)recordSearchLoading.value=false;}},250);
});
watch(searchVisible,open=>{if(!open){searchGeneration++;searchController?.abort();if(searchTimer)clearTimeout(searchTimer);recordSearchLoading.value=false;}});
function openRecord(item:RecordSearchResult){searchVisible.value=false;searchQuery.value='';void router.push({path:`/${item.kind}`,query:{detail:item.id}});}
const allNavigation = [
  { path: '/dashboard', title: '工作台', icon: House, label: 'OVERVIEW / 运营总览', description: '', roles: ['ADMIN'] as const },
  { path: '/rooms', title: '房源管理', icon: OfficeBuilding, label: 'SPACES / 房源档案', description: '把状态、租金和入住关系放在一眼能看懂的位置。', roles: ['ADMIN', 'CLEANER'] as const },
  { path: '/space', title: '房源模型', icon: Grid, label: 'SPACE MODEL / 楼栋空间', description: '用 2D 剖面和 3D 等轴模型，查看一栋楼的真实占用状态。', roles: ['ADMIN', 'CLEANER'] as const },
  { path: '/tenants', title: '租客档案', icon: User, label: 'RESIDENTS / 租客资料', description: '从租客本人出发，快速关联房源、合同与收款。' },
  { path: '/contracts', title: '合同管理', icon: Document, label: 'AGREEMENTS / 租赁关系', description: '租赁期限、每月应收和续约提醒，在同一行核对。' },
  { path: '/expenses', title: '支出记录', icon: Wallet, label: 'FINANCE / 支出记录', description: '记录已发生的支出及付款凭证。', roles: ['ADMIN', 'FINANCIAL'] as const },
  { path: '/bills', title: '账单与收款', icon: Wallet, label: 'FINANCE / 账务管理', description: '应收、已收和剩余欠款，放在清楚可核对的位置。' },
  { path: '/maintenance', title: '报修工单', icon: Tools, label: 'SERVICE / 报修协同', description: '按紧急程度和处理进度安排任务，让每个工单都有明确下一步。' },
  { path: '/cleaning', title: '保洁任务', icon: Brush, label: 'HOUSEKEEPING / 现场工作', description: '按空置房源的真实清洁状态组织工作，保留开始与完成操作。', roles: ['ADMIN', 'CLEANER'] as const },
  { path: '/notifications', title: '通知中心', icon: Bell, label: 'INBOX / 通知', description: '重要提醒与服务进展，都汇集在这里。' },
  { path: '/announcements', title: '公告管理', icon: ChatDotSquare, label: 'BROADCAST / 公告', description: '把停水停电、缴费提醒与规则变更，定向送达需要知道的租客。' },
  { path: '/prepay', title: '预付账户', icon: Wallet, label: 'ACCOUNTS / 预付', description: '余额、充值与扣费记录，清晰可追溯。' },
  { path: '/meters', title: '水电管理', icon: Odometer, label: 'UTILITIES / 水电', description: '记录每一次读数，核对每一笔费用。' },
  { path: '/checkout', title: '退租结算', icon: Switch, label: 'CHECKOUT / 退租', description: '从费用核对到押金结算，妥善完成最后一步。' },
  { path: '/statistics', title: '数据统计', icon: TrendCharts, label: 'INSIGHTS / 经营分析', description: '以实际统计区间和空间维度，核对经营数据。' },
  { path: '/settings', title: '系统设置', icon: Setting, label: 'PREFERENCES / 设置', description: '当前浏览器的界面偏好，不修改业务资料。' },
  { path: '/buildings', title: '楼栋管理', icon: OfficeBuilding, label: 'BUILDINGS / 楼栋', description: '管理楼栋与空间，为房源建立清晰的归属。' },
  { path: '/audit', title: '审计日志', icon: Tickets, label: 'AUDIT / 操作记录', description: '关键操作留痕，方便核查与追溯。' },
];
// 未显式声明 roles 的入口默认仅管理员（FE-01）
const allNavigationWithRoles = allNavigation.map((item) =>
  'roles' in item ? item : { ...item, roles: ['ADMIN'] as const },
);
/** 按当前账号角色过滤：保洁只看到房源/空间/保洁/通知，租客只看到通知。 */
const navigation = computed(() =>
  filterNavigation(allNavigationWithRoles, userStore.user?.role) as typeof allNavigationWithRoles,
);
const currentPage = computed(() => {
  const items = navigation.value;
  return (
    items.find((item) => item.path === route.path) ||
    items
      .filter((item) => route.path.startsWith(`${item.path}/`))
      .sort((a, b) => b.path.length - a.path.length)[0] ||
    // 无权访问 / 无任何可见入口时，顶栏仍需要一个可读标题
    { ...items[0], path: route.path, title: route.meta?.title ?? '无权访问', description: '' }
  );
});
const today = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' }).format(new Date());
const userInitial = computed(() => userStore.user?.email?.slice(0, 1).toUpperCase() || '管');
/** 侧栏账户卡的第二行：让「这个账号是谁」一眼可见，不必展开菜单 */
const roleLabel = computed(() => roleLabelOf(userStore.user?.role));
const searchResults = computed(() => navigation.value.filter((item) => `${item.title}${item.description}`.includes(searchQuery.value.trim())));
function openPage(path: string) { searchVisible.value = false; searchQuery.value = ''; router.push(path); }
function handleLogout() {
  userStore.logout();
  router.push('/login');
}

/* 窄视窗导航：鼠标靠近按钮时展开，移开侧栏后收回；点击则固定打开。 */
function isNarrowNav() {
  return window.matchMedia('(max-width: 1100px)').matches;
}
function clearNavTimers() {
  if (navOpenTimer) { clearTimeout(navOpenTimer); navOpenTimer = null; }
  if (navCloseTimer) { clearTimeout(navCloseTimer); navCloseTimer = null; }
}
function scheduleNavOpen() {
  if (!isNarrowNav() || mobileOpen.value) return;
  clearNavTimers();
  navOpenTimer = setTimeout(() => {
    navHoverOpen.value = true;
    mobileOpen.value = true;
    navOpenTimer = null;
  }, 140);
}
function cancelNavClose() {
  if (navCloseTimer) { clearTimeout(navCloseTimer); navCloseTimer = null; }
}
function scheduleNavClose() {
  if (!isNarrowNav() || !navHoverOpen.value) return;
  clearNavTimers();
  navCloseTimer = setTimeout(() => {
    mobileOpen.value = false;
    navHoverOpen.value = false;
    navCloseTimer = null;
  }, 320);
}
function closeNav() {
  clearNavTimers();
  mobileOpen.value = false;
  navHoverOpen.value = false;
}
function toggleNav() {
  clearNavTimers();
  if (mobileOpen.value) {
    if (navHoverOpen.value) {
      navHoverOpen.value = false;
      return;
    }
    mobileOpen.value = false;
    return;
  }
  navHoverOpen.value = false;
  mobileOpen.value = true;
}

const voucherVisible = ref(false);
const voucherInitialText = ref('');
function handleGlobalVoucherSettled(payload: any) {
  window.dispatchEvent(new CustomEvent('bill-settled', { detail: payload }));
}
function handleGlobalPaste(event: ClipboardEvent) {
  const target = event.target as HTMLElement | null;
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || (target as any).isContentEditable)) {
    return;
  }
  const text = event.clipboardData?.getData('text/plain') || '';
  if (text && text.trim()) {
    if (text.includes('[VOUCHER:') || text.includes('BILL-') || text.includes('缴费凭单') || text.includes('账单编号')) {
      event.preventDefault();
      voucherInitialText.value = text.trim();
      voucherVisible.value = true;
    }
  }
}

function keyboard(event: KeyboardEvent) {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); searchVisible.value = !searchVisible.value; }
  if (event.key === 'Escape') closeNav();
}
let notificationSocket: Socket | null = null;
let unreadPollTimer: ReturnType<typeof setInterval> | null = null;
function startUnreadPolling() {
  if (unreadPollTimer) return;
  unreadPollTimer = setInterval(() => void notificationStore.fetchUnreadCount(), 30_000);
}
function stopUnreadPolling() {
  if (unreadPollTimer) clearInterval(unreadPollTimer);
  unreadPollTimer = null;
}
onMounted(() => {
  void notificationStore.fetchUnreadCount();
  const token = localStorage.getItem('access_token');
  if (token) {
    notificationSocket = createNotificationSocket(() => localStorage.getItem('access_token'));
    notificationSocket.on('notification', () => void notificationStore.fetchUnreadCount());
    notificationSocket.on('connect', stopUnreadPolling);
    notificationSocket.on('connect_error', startUnreadPolling);
    notificationSocket.on('disconnect', startUnreadPolling);
  } else {
    startUnreadPolling();
  }
  void management.load();
  window.addEventListener('keydown', keyboard);
  window.addEventListener('paste', handleGlobalPaste);
});
onUnmounted(() => {
  notificationSocket?.disconnect();
  notificationSocket = null;
  stopUnreadPolling();
  window.removeEventListener('keydown', keyboard);
  window.removeEventListener('paste', handleGlobalPaste);
  searchGeneration++;
  searchController?.abort();
  if (searchTimer) clearTimeout(searchTimer);
  clearNavTimers();
});
watch(() => route.path, () => { closeNav(); void notificationStore.fetchUnreadCount(); });
</script>
<style src="@/styles/optimized-ui.css" />
