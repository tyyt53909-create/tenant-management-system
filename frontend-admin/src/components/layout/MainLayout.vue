<template>
  <div class="qiju-shell">
    <a class="skip-link" href="#workspace-content">跳到页面内容</a>
    <button v-if="mobileOpen" class="nav-cover" aria-label="关闭导航" @click="mobileOpen = false" />
    <aside :class="['qiju-side', { open: mobileOpen }]">
      <router-link to="/dashboard" class="qiju-brand" @click="mobileOpen = false">
        <span class="brand-mark"><el-icon :size="22"><House /></el-icon></span>
        <span><strong>栖居管理</strong><small>PROPERTY CONSOLE</small></span>
      </router-link>
      <div class="side-label">工作空间 / WORKSPACE</div>
      <nav class="qiju-navigation" aria-label="管理导航">
        <router-link v-for="item in navigation" :key="item.path" :to="item.path"
          :class="['qiju-nav-item', { active: route.path === item.path }]"
          :aria-current="route.path === item.path ? 'page' : undefined" @click="mobileOpen = false">
          <el-icon :size="18"><component :is="item.icon" /></el-icon><span>{{ item.title }}</span>
          <span v-if="item.path === '/notifications' && notificationStore.unreadCount" class="nav-count">{{ Math.min(notificationStore.unreadCount, 99) }}</span>
          <span v-if="item.path==='/maintenance' && management.snapshot?.maintenance.submitted" class="nav-count">{{ Math.min(management.snapshot.maintenance.submitted,99) }}</span>
        </router-link>
      </nav>
      <div class="side-bottom"><div class="workspace-card"><span class="workspace-icon"><el-icon><OfficeBuilding /></el-icon></span><div><strong>租赁运营中心</strong><small>房源与服务，有序相连</small></div></div></div>
    </aside>
    <div class="qiju-main">
      <header class="qiju-topbar">
        <button class="icon-button mobile-toggle" aria-label="打开导航" :aria-expanded="mobileOpen" @click="mobileOpen = !mobileOpen"><el-icon :size="20"><Menu /></el-icon></button>
        <div class="qiju-breadcrumb"><span>运营中心</span><span>/</span><b>{{ currentPage.title }}</b></div>
        <div class="top-spacer" />
        <button class="search-trigger" @click="searchVisible = true"><el-icon><Search /></el-icon><span>搜索页面与服务…</span><kbd>⌘ K</kbd></button>
        <span class="top-date">{{ today }}</span>
        <router-link class="icon-button" to="/notifications" aria-label="通知中心"><el-icon :size="20"><Bell /></el-icon><i v-if="notificationStore.unreadCount" class="unread-dot" /></router-link>
        <el-dropdown @command="handleCommand">
          <button class="user-button"><span class="user-avatar">{{ userInitial }}</span><span class="user-label">{{ userStore.user?.email || '管理员' }}</span><el-icon><ArrowDown /></el-icon></button>
          <template #dropdown><el-dropdown-menu><el-dropdown-item command="logout">退出登录</el-dropdown-item></el-dropdown-menu></template>
        </el-dropdown>
      </header>
      <main id="workspace-content" class="qiju-content" tabindex="-1">
        <div v-if="route.path !== '/dashboard'" class="page-intro">
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
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { House, User, OfficeBuilding, Document, Wallet, Tools, Brush, Bell, TrendCharts, Tickets, Odometer, Switch, Setting, ArrowDown, ArrowRight, Search, Menu } from '@element-plus/icons-vue';
import { useUserStore } from '@/stores/user';
import { useNotificationStore } from '@/stores/notification';
import { usePreferencesStore } from '@/stores/preferences';
import { useManagementStore } from '@/stores/management';
import request from '@/utils/request';
import { stateLabel } from '@/utils/resource';

const route = useRoute();
const router = useRouter();
const userStore = useUserStore();
const notificationStore = useNotificationStore();
const preferences=usePreferencesStore();
const management=useManagementStore();
watch(()=>[preferences.compact,preferences.reduceMotion],()=>{document.documentElement.classList.toggle('qiju-compact',preferences.compact);document.documentElement.classList.toggle('qiju-reduce-motion',preferences.reduceMotion);},{immediate:true});
const mobileOpen = ref(false);
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
const navigation = [
  { path: '/dashboard', title: '工作台', icon: House, label: 'OVERVIEW / 运营总览', description: '' },
  { path: '/rooms', title: '房源管理', icon: OfficeBuilding, label: 'SPACES / 房源档案', description: '把状态、租金和入住关系放在一眼能看懂的位置。' },
  { path: '/tenants', title: '租客档案', icon: User, label: 'RESIDENTS / 租客资料', description: '从租客本人出发，快速关联房源、合同与收款。' },
  { path: '/contracts', title: '合同管理', icon: Document, label: 'AGREEMENTS / 租赁关系', description: '租赁期限、每月应收和续约提醒，在同一行核对。' },
  { path: '/bills', title: '账单与收款', icon: Wallet, label: 'FINANCE / 账务管理', description: '应收、已收和剩余欠款，放在清楚可核对的位置。' },
  { path: '/maintenance', title: '报修工单', icon: Tools, label: 'SERVICE / 报修协同', description: '按紧急程度和处理进度安排任务，让每个工单都有明确下一步。' },
  { path: '/cleaning', title: '保洁任务', icon: Brush, label: 'HOUSEKEEPING / 现场工作', description: '按空置房源的真实清洁状态组织工作，保留开始与完成操作。' },
  { path: '/notifications', title: '通知中心', icon: Bell, label: 'INBOX / 通知', description: '重要提醒与服务进展，都汇集在这里。' },
  { path: '/prepay', title: '预付账户', icon: Wallet, label: 'ACCOUNTS / 预付', description: '余额、充值与扣费记录，清晰可追溯。' },
  { path: '/meters', title: '水电管理', icon: Odometer, label: 'UTILITIES / 水电', description: '记录每一次读数，核对每一笔费用。' },
  { path: '/checkout', title: '退租结算', icon: Switch, label: 'CHECKOUT / 退租', description: '从费用核对到押金结算，妥善完成最后一步。' },
  { path: '/statistics', title: '数据统计', icon: TrendCharts, label: 'INSIGHTS / 经营分析', description: '以实际统计区间和空间维度，核对经营数据。' },
  { path: '/settings', title: '系统设置', icon: Setting, label: 'PREFERENCES / 设置', description: '当前浏览器的界面偏好，不修改业务资料。' },
  { path: '/buildings', title: '楼栋管理', icon: OfficeBuilding, label: 'BUILDINGS / 楼栋', description: '管理楼栋与空间，为房源建立清晰的归属。' },
  { path: '/audit', title: '审计日志', icon: Tickets, label: 'AUDIT / 操作记录', description: '关键操作留痕，方便核查与追溯。' },
];
const currentPage = computed(() => navigation.find((item) => item.path === route.path) || navigation[0]!);
const today = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' }).format(new Date());
const userInitial = computed(() => userStore.user?.email?.slice(0, 1).toUpperCase() || '管');
const searchResults = computed(() => navigation.filter((item) => `${item.title}${item.description}`.includes(searchQuery.value.trim())));
function openPage(path: string) { searchVisible.value = false; searchQuery.value = ''; router.push(path); }
function handleCommand(command: string) { if (command === 'logout') { userStore.logout(); router.push('/login'); } }
function keyboard(event: KeyboardEvent) {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); searchVisible.value = !searchVisible.value; }
  if (event.key === 'Escape') mobileOpen.value = false;
}
onMounted(() => { void notificationStore.fetchUnreadCount();void management.load();window.addEventListener('keydown', keyboard); });
onUnmounted(() => {window.removeEventListener('keydown', keyboard);searchGeneration++;searchController?.abort();if(searchTimer)clearTimeout(searchTimer);});
watch(() => route.path, () => { mobileOpen.value = false; void notificationStore.fetchUnreadCount(); });
</script>
<style src="@/styles/optimized-ui.css" />
